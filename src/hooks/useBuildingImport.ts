import { useEffect } from 'react';
import type { Building, Config } from '../model/types';
import type { ImportJobInput, ImportJobOptions } from '../model/buildingImportJob';
import {
  hasImportEdits,
  IMPORT_MAX_BUILDINGS,
  IMPORT_MAX_VERTICES,
  localIsoDate,
  reanchorFootprint,
} from '../model/buildings';
import { lonLatToEnu } from '../model/enu';
import { floorPlacements } from '../model/geometry';
import { MAX_BUILDINGS, MAX_TOTAL_BUILDING_VERTICES } from '../model/share';
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
import { runImport } from './buildingImportClient';

// ─────────────────────────────────────────────
// SWISSTOPO BUILDING IMPORT (owned by the buildings feature, docs/ARCHITECTURE.md "Umgebung")
// After an address pick (uiStore.requestSurroundingsImport → useBuildingImportLoader, mounted once in
// <DataLoader/>) or «Gebäude laden» (BuildingList): fetch the building parts within surfaceModel.radius,
// identify the own building (part containing the address point, else the nearest within 25 m; for «Gebäude
// laden» first the part behind the facade origin), keep the buildings that set the horizon of any candidate
// facade plus the own building, its adjoining parts and near context within the caps (model/buildingImportJob.ts,
// in the building-import worker: buildingImportClient.ts), and store them with the anchor. A re-import replaces
// the imported buildings and keeps the manual ones (moved to the new anchor). An address pick also switches the
// laser scan on and asks the site plan to open. The import runs outside React (one at a time, a new one aborts
// the running one): the state lives in state/buildingImportStore.ts. Never throws.
// ─────────────────────────────────────────────

/** Injectable dependencies (tests; with a tile source or fetch the import runs in this thread). */
export interface BuildingImportDeps {
  fetchBuildings?: ImportJobOptions['fetchBuildings'];
  fetchImpl?: typeof fetch;
  /** Awaited between the selection steps in this thread (default: a macrotask, keeps the page responsive). */
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
  setState({
    status: 'loading',
    progress: { phase: 'tiles', done: 0, total: 0, bytes: 0 },
    error: null,
    request: req,
    pendingConfirm: null,
  });
  try {
    // The selection works with the config as it is now; room is left for the buildings entered by hand.
    const config = useConfigStore.getState().config;
    const manualNow = config.horizon.buildings.filter((b) => b.source === 'manual');
    const input: ImportJobInput = {
      latitude: req.latitude,
      longitude: req.longitude,
      radius: config.horizon.surfaceModel.radius,
      probeOwn: req.reason === 'manual',
      location: { latitude: config.location.latitude, longitude: config.location.longitude },
      facadeAzimuth: config.building.facadeAzimuth,
      observers: configuredObservers(config),
      maxBuildings: Math.min(IMPORT_MAX_BUILDINGS, MAX_BUILDINGS - manualNow.length),
      maxVertices: Math.min(
        IMPORT_MAX_VERTICES,
        MAX_TOTAL_BUILDING_VERTICES - manualNow.reduce((n, b) => n + b.footprint.length, 0),
      ),
    };
    const res = await runImport(input, {
      signal: ctrl.signal,
      fetchImpl: deps.fetchImpl,
      fetchBuildings: deps.fetchBuildings,
      pause: deps.pause ?? macrotask,
      onProgress: (progress) => {
        if (current()) setState({ progress });
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

    // Manual buildings stay (moved to the new anchor); the latest config wins (edits while loading).
    const latest = useConfigStore.getState().config;
    const oldAnchor = latest.horizon.buildingImport;
    const anchor = { latitude: req.latitude, longitude: req.longitude };
    const manual: Building[] = [];
    let droppedManual = 0;
    for (const b of latest.horizon.buildings) {
      if (b.source !== 'manual') continue;
      const footprint = oldAnchor ? reanchorFootprint(b.footprint, oldAnchor, anchor) : b.footprint;
      if (footprint) manual.push({ ...b, footprint });
      else droppedManual++;
    }
    // Buildings entered by hand while it loaded may need more room: the kept list is in priority order.
    const kept = [...res.kept];
    const room = MAX_BUILDINGS - manual.length;
    const roomVertices = MAX_TOTAL_BUILDING_VERTICES - manual.reduce((n, b) => n + b.footprint.length, 0);
    let vertices = kept.reduce((n, k) => n + k.footprint.length, 0);
    while (kept.length > 0 && (kept.length > room || vertices > roomVertices)) {
      vertices -= kept[kept.length - 1].footprint.length;
      kept.pop();
    }
    // Ids b<index + 1> (the compact form of share links). Imported buildings first: they are never deleted
    // (only marked removed), so deleting a manual one shifts no imported id (explicit ids in the link).
    const imported: Building[] = kept.map((k) => ({
      id: '',
      name: '',
      footprint: k.footprint,
      base: k.base,
      height: k.height,
      source: 'swisstopo',
    }));
    const buildings = [...imported, ...manual].map((b, i) => ({ ...b, id: `b${i + 1}` }));
    const ownPos = kept.findIndex((k) => k.reason === 'own');
    const radius = input.radius;
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
      found: res.found,
      stored: imported.length,
      horizon: kept.filter((k) => k.reason === 'horizon').length,
      context: kept.filter((k) => k.reason === 'context' || k.reason === 'adjoining').length,
      ownId: ownPos >= 0 ? `b${ownPos + 1}` : null,
      droppedSetters: res.droppedSetters,
      maxDroppedScore: res.maxDroppedScore,
      keptManual: manual.length,
      droppedManual,
      coverage: res.coverage,
      attribution: res.attribution,
      tileCount: res.tileCount,
      bytes: res.bytes,
      selectMs: res.selectMs,
    };
    setState({ status: 'ready', progress: null, summary, error: null });
    requestSitePlan(req.reason);
  } catch (e) {
    // Defensive: a bug here must not escape to the UI.
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
