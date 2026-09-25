import { useEffect } from 'react';
import type { Building, Config } from '../model/types';
import { fetchSwisstopoBuildings } from '../model/buildingSources';
import {
  findOwnBuilding,
  hasImportEdits,
  horizonScores,
  importCandidate,
  IMPORT_MAX_BUILDINGS,
  IMPORT_MAX_VERTICES,
  localIsoDate,
  planImport,
  pruneHeights,
  pruneStations,
  reanchorFootprint,
  type ImportCandidate,
  type PruneStation,
} from '../model/buildings';
import { facadeToEnu, lonLatToEnu } from '../model/enu';
import { floorPlacements } from '../model/geometry';
import { MAX_BUILDINGS, MAX_TOTAL_BUILDING_VERTICES } from '../model/share';
import { OWN_BUILDING_EXCLUSION } from '../model/surroundings';
import { cmToM } from '../model/units';
import {
  INITIAL_BUILDING_IMPORT,
  requestSitePlan,
  useBuildingImportStore,
  type BuildingImportRequest,
  type BuildingImportSummary,
} from '../state/buildingImportStore';
import { useConfigStore } from '../state/configStore';
import { useUiStore, type SurroundingsImportRequest } from '../state/uiStore';

// ─────────────────────────────────────────────
// SWISSTOPO BUILDING IMPORT (owned by the buildings feature, docs/ARCHITECTURE.md "Umgebung")
// After an address pick (uiStore.requestSurroundingsImport → useBuildingImportLoader, mounted once in
// <DataLoader/>) or «Gebäude laden» (BuildingList): fetch the building parts within surfaceModel.radius
// (model/buildingSources.ts), identify the own building (part containing the address point, else the nearest
// within 25 m; for «Gebäude laden» first the part behind the facade origin), keep the buildings that set the
// horizon of any candidate facade plus the own building, its adjoining parts and near context within the caps
// (model/buildings.ts planImport), and store them with the anchor. A re-import replaces the imported buildings
// and keeps the manual ones (moved to the new anchor). An address pick also switches the laser scan on and
// asks the site plan to open. The import runs outside React (one at a time, a new one aborts the running
// one): the state lives in state/buildingImportStore.ts. Never throws.
// ─────────────────────────────────────────────

/** Injectable dependencies (tests). */
export interface BuildingImportDeps {
  fetchBuildings?: typeof fetchSwisstopoBuildings;
  fetchImpl?: typeof fetch;
  /** Awaited between the selection steps (default: a macrotask, keeps the page responsive). */
  pause?: () => Promise<void>;
  /** Import date (default: now). */
  now?: () => number;
}

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

let controller: AbortController | null = null;
let runId = 0;

const setState = useBuildingImportStore.setState;

/** Stops a running import; the stored buildings stay as they were. */
export function abortBuildingImport(): void {
  if (!controller) return;
  controller.abort();
  controller = null;
  runId++;
  const { summary } = useBuildingImportStore.getState();
  setState({ status: summary ? 'ready' : 'idle', progress: null });
}

/** Back to the initial state, aborting a running import (tests). */
export function resetBuildingImport(): void {
  controller?.abort();
  controller = null;
  runId++;
  useBuildingImportStore.setState(INITIAL_BUILDING_IMPORT);
}

/**
 * Asks for an import around (latitude, longitude). When the imported buildings carry changes (removed or
 * edited) that the import would discard, it waits for confirmBuildingImport (pendingConfirm) instead: always
 * for «Gebäude laden», after an address pick only when the address lies within the previous import's radius
 * (the same neighbourhood; farther away the old buildings belong to another site and are replaced). An
 * address pick turns the laser scan on right away then, whatever the answer («Behalten» keeps the buildings).
 */
export function requestBuildingImport(request: BuildingImportRequest, deps: BuildingImportDeps = {}): void {
  const req = { ...request, latitude: round6(request.latitude), longitude: round6(request.longitude) };
  const { horizon } = useConfigStore.getState().config;
  if (hasImportEdits(horizon.buildings)) {
    const anchor = horizon.buildingImport;
    const [e, n] = anchor ? lonLatToEnu(anchor, req.latitude, req.longitude) : [Infinity, Infinity];
    const near = anchor !== null && Math.hypot(e, n) <= Math.max(anchor.radius, 1);
    if (req.reason === 'manual' || near) {
      setState({ pendingConfirm: req });
      if (req.reason === 'address') {
        useUiStore.getState().setSectionOpen('horizon', true);
        finishAddress(req);
      }
      return;
    }
  }
  void startBuildingImport(req, deps);
}

/** Runs the import waiting for confirmation (discarding the changes to imported buildings). */
export function confirmBuildingImport(deps: BuildingImportDeps = {}): void {
  const req = useBuildingImportStore.getState().pendingConfirm;
  if (req) void startBuildingImport(req, deps);
}

/** Drops the import waiting for confirmation (the stored buildings stay). */
export function dismissBuildingImport(): void {
  setState({ pendingConfirm: null });
}

/** Repeats the last import (after an error). */
export function retryBuildingImport(deps: BuildingImportDeps = {}): void {
  const req = useBuildingImportStore.getState().request;
  if (req) void startBuildingImport(req, deps);
}

/** Observer heights and panel-centre distances of the configured floors (all tilts: n from 0° to 90°). */
function configuredObservers(config: Config): { heights: number[]; offsets: number[]; top: number } {
  const placements = floorPlacements(config);
  const railN = cmToM(config.building.balconyDepth);
  const half = cmToM(config.panels.length) / 2;
  const heights = placements.map((p) => p.center.z);
  return {
    heights,
    offsets: [...new Set([Math.max(railN, 0.05), Math.max(railN + half, 0.05)])],
    top: Math.max(0, ...placements.map((p) => p.railTopZ)),
  };
}

/**
 * Runs an import now (aborting a running one). Resolves when it has finished, failed or was superseded;
 * never rejects. Prefer requestBuildingImport (asks before discarding changes).
 */
export async function startBuildingImport(
  request: BuildingImportRequest,
  deps: BuildingImportDeps = {},
): Promise<void> {
  controller?.abort();
  const ctrl = new AbortController();
  controller = ctrl;
  const id = ++runId;
  const current = (): boolean => id === runId && !ctrl.signal.aborted;
  const req = { ...request, latitude: round6(request.latitude), longitude: round6(request.longitude) };
  const fetchBuildings = deps.fetchBuildings ?? fetchSwisstopoBuildings;
  const pause = deps.pause ?? macrotask;
  const radius = useConfigStore.getState().config.horizon.surfaceModel.radius;
  setState({
    status: 'loading',
    progress: { phase: 'tiles', done: 0, total: 0, bytes: 0 },
    error: null,
    request: req,
    pendingConfirm: null,
  });
  try {
    const res = await fetchBuildings(req.latitude, req.longitude, radius, {
      signal: ctrl.signal,
      fetchImpl: deps.fetchImpl,
      onProgress: (done, total, bytes) => {
        if (current()) setState({ progress: { phase: 'tiles', done, total, bytes } });
      },
    });
    if (!current()) return;
    if (!res.ok) {
      if (res.error.kind === 'aborted') return; // abortBuildingImport already reset the status
      setState({ status: 'error', error: res.error, progress: null });
      finishAddress(req);
      return;
    }
    if (!res.covered) {
      setState({ status: 'unavailable', progress: null, summary: null });
      finishAddress(req);
      return;
    }

    // Selection (pruning), with the config as it is now.
    const started = performance.now();
    const config = useConfigStore.getState().config;
    const anchor = { latitude: req.latitude, longitude: req.longitude };
    const candidates: ImportCandidate[] = [];
    for (const p of res.parts) {
      const c = importCandidate(p);
      if (c) candidates.push(c);
    }
    const footprints = candidates.map((c) => c.footprint);
    const tops = candidates.map((c) => c.base + c.height);
    const facadeAzimuth = config.building.facadeAzimuth;
    const loc = lonLatToEnu(anchor, config.location.latitude, config.location.longitude);
    const back = facadeToEnu([0, OWN_BUILDING_EXCLUSION.probeN], facadeAzimuth);
    const probe: [number, number] = [loc[0] + back[0], loc[1] + back[1]];
    const own = findOwnBuilding(footprints, [0, 0], req.reason === 'manual' ? probe : null);
    const others = footprints.filter((_, i) => i !== own);
    const observers = configuredObservers(config);
    // The configured facade counts too while its origin lies within the import radius.
    const extra: PruneStation[] =
      Math.hypot(loc[0], loc[1]) <= radius ? [{ origin: loc, facadeAzimuth }] : [];
    const stations = pruneStations(own >= 0 ? footprints[own] : null, others, extra);
    const ownTop = own >= 0 ? tops[own] : observers.top;
    const heights = pruneHeights(Math.max(ownTop, observers.top), observers.heights);
    let done = 0;
    const total = stations.length;
    setState({ progress: { phase: 'select', done, total, bytes: res.bytes } });
    const scores = await horizonScores(footprints, tops, stations, heights, observers.offsets, {
      exclude: own >= 0 ? [own] : [],
      signal: ctrl.signal,
      pause: async () => {
        done++;
        if (current()) setState({ progress: { phase: 'select', done, total, bytes: res.bytes } });
        await pause();
      },
    });
    if (!current()) return;

    // Manual buildings stay (moved to the new anchor); the latest config wins (edits while loading).
    const latest = useConfigStore.getState().config;
    const oldAnchor = latest.horizon.buildingImport;
    const manual: Building[] = [];
    let droppedManual = 0;
    for (const b of latest.horizon.buildings) {
      if (b.source !== 'manual') continue;
      const footprint = oldAnchor ? reanchorFootprint(b.footprint, oldAnchor, anchor) : b.footprint;
      if (footprint) manual.push({ ...b, footprint });
      else droppedManual++;
    }
    const manualVertices = manual.reduce((s, b) => s + b.footprint.length, 0);
    const plan = planImport({
      candidates,
      scores,
      own,
      site: [0, 0],
      maxBuildings: Math.min(IMPORT_MAX_BUILDINGS, MAX_BUILDINGS - manual.length),
      maxVertices: Math.min(IMPORT_MAX_VERTICES, MAX_TOTAL_BUILDING_VERTICES - manualVertices),
    });
    // Ids b<index + 1> (the compact form of share links). Imported buildings first: they are never deleted
    // (only marked removed), so deleting a manual one shifts no imported id (explicit ids in the link).
    const imported: Building[] = plan.kept.map(({ index }) => ({
      id: '',
      name: '',
      footprint: candidates[index].footprint,
      base: candidates[index].base,
      height: candidates[index].height,
      source: 'swisstopo',
    }));
    const buildings = [...imported, ...manual].map((b, i) => ({ ...b, id: `b${i + 1}` }));
    const ownPos = plan.kept.findIndex((k) => k.reason === 'own');
    const date = localIsoDate(deps.now?.() ?? Date.now());
    useConfigStore.getState().setConfig((c) => ({
      ...c,
      horizon: {
        ...c.horizon,
        buildings,
        buildingImport: { latitude: req.latitude, longitude: req.longitude, radius, date },
        surfaceModel:
          req.reason === 'address' ? { ...c.horizon.surfaceModel, enabled: true } : c.horizon.surfaceModel,
      },
    }));
    const summary: BuildingImportSummary = {
      found: res.parts.length,
      stored: imported.length,
      horizon: plan.kept.filter((k) => k.reason === 'horizon').length,
      context: plan.kept.filter((k) => k.reason === 'context' || k.reason === 'adjoining').length,
      ownId: ownPos >= 0 ? `b${ownPos + 1}` : null,
      droppedSetters: plan.droppedSetters,
      maxDroppedScore: plan.maxDroppedScore,
      keptManual: manual.length,
      droppedManual,
      coverage: res.coverage,
      attribution: res.attribution,
      tileCount: res.tileCount,
      bytes: res.bytes,
      selectMs: performance.now() - started,
    };
    setState({ status: 'ready', progress: null, summary, error: null });
    requestSitePlan(req.reason);
  } catch (e) {
    // Defensive: a bug in the selection must not escape to the UI.
    if (current()) {
      setState({
        status: 'error',
        progress: null,
        error: { kind: 'decode', message: e instanceof Error ? e.message : String(e) },
      });
    }
  } finally {
    if (controller === ctrl) controller = null;
  }
}

/**
 * After an address pick that stored nothing (failed, outside CH/FL, or waiting for «Neu laden» / «Behalten»):
 * the laser scan still comes on and the site plan opens.
 */
function finishAddress(req: BuildingImportRequest): void {
  if (req.reason !== 'address') return;
  useConfigStore.getState().patch('horizon', {
    surfaceModel: { ...useConfigStore.getState().config.horizon.surfaceModel, enabled: true },
  });
  requestSitePlan('address');
}

/** Handles a surroundings request of the address search (uiStore). */
export function handleSurroundingsRequest(
  request: SurroundingsImportRequest,
  deps: BuildingImportDeps = {},
): void {
  requestBuildingImport(
    { latitude: request.latitude, longitude: request.longitude, reason: 'address' },
    deps,
  );
}

/**
 * Consumes the surroundings-import requests of the address search (uiStore.requestSurroundingsImport) and
 * starts the building import. Mount exactly once (in <DataLoader/>). The import itself is not tied to the
 * component (StrictMode's second mount finds the request already consumed and the import running).
 */
export function useBuildingImportLoader(): void {
  useEffect(() => {
    const take = (): void => {
      const request = useUiStore.getState().consumeSurroundingsImport();
      if (request) handleSurroundingsRequest(request);
    };
    take();
    return useUiStore.subscribe((s, prev) => {
      if (s.surroundingsImport && s.surroundingsImport !== prev.surroundingsImport) take();
    });
  }, []);
}
