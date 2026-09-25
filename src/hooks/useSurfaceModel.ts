import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Config, FloorPlacement, HorizonProfile } from '../model/types';
import { DEFAULT_SWEEP_TILTS } from '../model/analysis';
import type { DsmJobResult, DsmObserverGroup, DsmSite, DsmSiteInfo } from '../model/dsm';
import { DSM_ALGORITHM_VERSION, dsmDataKey, insideDsmExtent } from '../model/dsmEstimate';
import { hashString, surfaceObserverKey, surfaceSiteKey, type SurfaceHorizons } from '../model/dsmHorizon';
import { facadeTransform } from '../model/enu';
import { floorPlacements, panelLayout } from '../model/geometry';
import { getStorage, touchCacheEntry, writeCacheEntry } from '../model/storageCache';
import { dsmMaskPolygons, ownBuildingIds } from '../model/surroundings';
import { cmToM } from '../model/units';
import { useConfig, useConfigSection, useConfigStore } from '../state/configStore';
import { INITIAL_SURFACE, useDataStore, type SurfaceData } from '../state/dataStore';
import { terrainDownloadGate } from '../state/loadGate';
import { computeDsmInWorker } from '../workers/terrainClient';
import { NO_SURROUNDINGS, type SurroundingsSource } from './useTerrain';

// ─────────────────────────────────────────────
// LASER-SCAN (swissSURFACE3D) HORIZON: LOADER AND READERS
// docs/ARCHITECTURE.md, "Umgebung: Adresse, Laserscan, Gebäude". The loader (mounted once in <DataLoader/>)
// computes the scan horizon of every floor's observer (panel-row centre, surfaceObserverKey) in the terrain
// worker (workers/terrainClient.ts computeDsmInWorker, model/dsm.ts) and writes dataStore.surface. Computing
// and downloading are separate:
// - computations (useSurfaceModelLoader's first effect) run from the localStorage result cache or as
//   memory-only jobs in the worker (no request); a change of site, facade, balcony, row width, trees, radius or
//   masks (surfaceSiteKey) waits SURFACE_DEBOUNCE_MS and shows 'loading' (results use the prisms and are
//   provisional); new observers of the shown site (tilt, floors, panel length) wait
//   SURFACE_OBSERVER_DEBOUNCE_MS while the other observers' horizons stay active (dsmFloorHorizons takes the
//   nearest one meanwhile); the first load and a retry start at once;
// - when a memory-only job misses (a new site, or after a reload the worker's memory is empty), the download
//   effect loads the site's data (SurfacePlan.dataKey: site, radius, trees, masks or not) after the weather
//   (state/loadGate.ts), with progress and MB either as 'loading' or, while the site's horizons stay shown, as
//   a refresh (useSurfaceRefresh; results provisional while current observers lack their own horizon). Only a
//   change of the data key or disabling aborts it: observers and facade changes meanwhile do not, they are
//   computed from memory when it is done. A failed refresh is shown and waits for «Erneut versuchen»;
// - once the current tilt is ready, the tilts of the tilt sweep (0–90° in 5° steps) follow in the background
//   (useSurfaceSweepPending), so the sweep uses each tilt's own horizon.
// Finished horizons are kept in localStorage (ssa.surface.v1:*, SURFACE_CACHE_SITES sites): the Cache API
// refuses the 206 range responses, so the results are cached, not the downloads.
// ─────────────────────────────────────────────

/** Delay after the last change of the site (or its masks) before loading. */
export const SURFACE_DEBOUNCE_MS = 800;
/** Delay after the last change of the observers (tilt, floors) before computing their horizons. */
export const SURFACE_OBSERVER_DEBOUNCE_MS = 250;
/** Delay before the tilt-sweep observers are computed after the current tilt is ready. */
export const SURFACE_SWEEP_DELAY_MS = 300;
/** Sites kept in the localStorage result cache. */
export const SURFACE_CACHE_SITES = 3;
/** Observers kept in dataStore.surface.horizons besides the current and the sweep ones. */
const EXTRA_OBSERVERS = 32;
const CACHE_PREFIX = 'ssa.surface.v1:';

// ── Plan: site and observers of a config ─────

/** Observers of a job: groups sharing n (heights = floors), and the key of every group height. */
export interface ObserverSet {
  groups: DsmObserverGroup[];
  keys: string[][];
}

/** Observer groups of placement lists (one list per tilt), each observer key once. */
export function observerSet(
  placementLists: readonly (readonly Pick<FloorPlacement, 'center'>[])[],
): ObserverSet {
  const byN = new Map<number, { heights: number[]; keys: string[] }>();
  const seen = new Set<string>();
  for (const list of placementLists) {
    for (const p of list) {
      const key = surfaceObserverKey(p.center);
      if (seen.has(key)) continue;
      seen.add(key);
      // The key's rounded values: the horizon belongs exactly to the observer its key names.
      const [n, z] = key.split(':').map(Number);
      const g = byN.get(n) ?? { heights: [], keys: [] };
      g.heights.push(z);
      g.keys.push(key);
      byN.set(n, g);
    }
  }
  const groups: DsmObserverGroup[] = [];
  const keys: string[][] = [];
  for (const [n, g] of byN) {
    groups.push({ n, heights: g.heights });
    keys.push(g.keys);
  }
  return { groups, keys };
}

/** Own footprint(s) in the facade frame: the stored buildings containing the probe point (ownBuildingIds). */
function ownFootprint(config: Config): [number, number][] | null {
  const { buildings, buildingImport } = config.horizon;
  const { location, building } = config;
  const ids = ownBuildingIds(buildings, buildingImport, location, building.facadeAzimuth);
  if (!buildingImport || ids.length === 0) return null;
  const t = facadeTransform(buildingImport, location, building.facadeAzimuth);
  return buildings.filter((b) => ids.includes(b.id)).flatMap((b) => b.footprint.map((p) => t.toFacade(p)));
}

/** Everything the loader needs for a config. */
export interface SurfacePlan {
  /** surfaceSiteKey(config): what dataStore.surface.siteKey names. */
  siteKey: string;
  /** siteKey + own footprint: the identity of the computed horizons (result cache). */
  jobKey: string;
  /** What the site's downloads depend on (model/dsmEstimate.ts dsmDataKey). */
  dataKey: string;
  site: DsmSite;
  /** Observers of the current tilt. */
  current: ObserverSet;
  /** Observers of the tilt-sweep tilts (DEFAULT_SWEEP_TILTS). */
  sweep: ObserverSet;
}

export function surfacePlan(config: Config): SurfacePlan {
  const { location, building, horizon } = config;
  const siteKey = surfaceSiteKey(config);
  const own = ownFootprint(config);
  const polygons = dsmMaskPolygons(horizon.buildings);
  const anchor = horizon.buildingImport;
  const site: DsmSite = {
    latitude: location.latitude,
    longitude: location.longitude,
    facadeAzimuth: building.facadeAzimuth,
    radius: horizon.surfaceModel.radius,
    trees: horizon.surfaceModel.trees,
    masks:
      polygons.length > 0 && anchor
        ? { anchor: { latitude: anchor.latitude, longitude: anchor.longitude }, polygons }
        : null,
    exclusion: {
      balconyDepthM: cmToM(building.balconyDepth),
      rowWidthM: panelLayout(config).rowWidth,
      ownFootprint: own,
    },
  };
  const ownKey = own ? hashString(JSON.stringify(own.map((p) => [p[0].toFixed(2), p[1].toFixed(2)]))) : '-';
  const withTilt = (tiltFromVertical: number): FloorPlacement[] =>
    floorPlacements({ ...config, panels: { ...config.panels, tiltFromVertical } });
  return {
    siteKey,
    jobKey: `${siteKey}|${ownKey}|v${DSM_ALGORITHM_VERSION}`,
    dataKey: dsmDataKey(site),
    site,
    current: observerSet([floorPlacements(config)]),
    sweep: observerSet(DEFAULT_SWEEP_TILTS.map(withTilt)),
  };
}

// ── Result cache (localStorage) ──────────────

interface StoredInfo {
  /** No scan at the site. */
  unavailable?: boolean;
  years: number[];
  bytes: number;
  coverage: number;
}

interface StoredSite {
  t: number;
  info: StoredInfo | null;
  /** Observer key → [samples, offset, base64 of the non-zero circular span as Uint16 in 0.01°]. */
  h: Record<string, [number, number, string]>;
}

/**
 * Compact form of a profile: elevations in 0.01° as little-endian Uint16, only the circular span outside the
 * longest run of zeros (the half behind the facade is 0) → [samples, offset, base64].
 */
export function encodeProfile(p: HorizonProfile): [number, number, string] {
  const n = p.elevations.length;
  const v = p.elevations.map((e) => Math.max(0, Math.min(65535, Math.round(e * 100))));
  // Longest circular run of zeros.
  let bestLen = 0;
  let bestEnd = 0;
  let run = 0;
  for (let i = 0; i < 2 * n; i++) {
    run = v[i % n] === 0 ? run + 1 : 0;
    if (run > bestLen && run <= n) {
      bestLen = run;
      bestEnd = i;
    }
  }
  if (bestLen >= n) return [n, 0, ''];
  const offset = (bestEnd + 1) % n;
  const len = n - bestLen;
  let bin = '';
  for (let k = 0; k < len; k++) {
    const x = v[(offset + k) % n];
    bin += String.fromCharCode(x & 0xff, x >> 8);
  }
  return [n, offset, btoa(bin)];
}

export function decodeProfile(stored: unknown): HorizonProfile | null {
  if (!Array.isArray(stored) || stored.length !== 3) return null;
  const [n, offset, b64] = stored as unknown[];
  if (
    typeof n !== 'number' ||
    !(n > 0 && n <= 7200) ||
    typeof offset !== 'number' ||
    typeof b64 !== 'string'
  ) {
    return null;
  }
  const e = new Array<number>(n).fill(0);
  try {
    const bin = atob(b64);
    if (bin.length % 2 !== 0 || bin.length / 2 > n) return null;
    for (let k = 0; k < bin.length / 2; k++) {
      e[(offset + k) % n] = (bin.charCodeAt(2 * k) | (bin.charCodeAt(2 * k + 1) << 8)) / 100;
    }
  } catch {
    return null;
  }
  return { stepDeg: 360 / n, elevations: e };
}

const cacheKey = (jobKey: string): string =>
  `${CACHE_PREFIX}${hashString(jobKey)}${hashString(`${jobKey}#`)}`;

/** Cached info and horizons of a job key (refreshing its last use), or null. */
export function readSurfaceCache(
  jobKey: string,
): { info: StoredInfo | null; horizons: SurfaceHorizons } | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(cacheKey(jobKey));
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StoredSite>;
    if (typeof s.h !== 'object' || s.h === null) return null;
    const horizons: Record<string, HorizonProfile> = {};
    for (const [k, v] of Object.entries(s.h)) {
      const p = decodeProfile(v);
      if (p) horizons[k] = p;
    }
    const info = s.info && Array.isArray(s.info.years) ? s.info : null;
    touchCacheEntry(storage, cacheKey(jobKey), s);
    return { info, horizons };
  } catch {
    return null;
  }
}

/** Merges info (unless null) and horizons into the cached entry of a job key. */
export function writeSurfaceCache(jobKey: string, info: StoredInfo | null, horizons: SurfaceHorizons): void {
  const storage = getStorage();
  if (!storage) return;
  let prev: Partial<StoredSite> = {};
  try {
    prev = JSON.parse(storage.getItem(cacheKey(jobKey)) ?? '{}') as Partial<StoredSite>;
  } catch {
    // corrupt: replaced
  }
  const h: StoredSite['h'] = typeof prev.h === 'object' && prev.h !== null ? { ...prev.h } : {};
  for (const [k, p] of Object.entries(horizons)) h[k] = encodeProfile(p);
  writeCacheEntry(storage, CACHE_PREFIX, SURFACE_CACHE_SITES, cacheKey(jobKey), {
    info: info ?? prev.info ?? null,
    h,
  });
}

// ── Loader ───────────────────────────────────

/** A download for new observers while the site's horizons stay shown ('ready'), or its failure. */
export type SurfaceRefresh =
  { status: 'loading'; progress: number; bytes: number } | { status: 'error'; error: string };

interface SurfaceLocalState {
  /** jobKey of the horizons in dataStore.surface (null when none). */
  jobKey: string | null;
  /** The tilt-sweep observers are being computed. */
  sweepPending: boolean;
  /** Data key whose download a memory-only job asked for (the download effect runs it), null when none. */
  wanted: string | null;
  /** Data key being downloaded, null when none. */
  downloading: string | null;
  /** Data key of the last download that finished. */
  loadedKey: string | null;
  /** Bumped when a download finished: the computations run again, from the worker's memory. */
  loaded: number;
  /** Download for new observers of the shown site, or its failure (null when none). */
  refresh: SurfaceRefresh | null;
}

const LOCAL_INITIAL: SurfaceLocalState = {
  jobKey: null,
  sweepPending: false,
  wanted: null,
  downloading: null,
  loadedKey: null,
  loaded: 0,
  refresh: null,
};

/** Loader state beyond dataStore.surface (module store of this hook). */
const useSurfaceLocal = create<SurfaceLocalState>()(() => LOCAL_INITIAL);

/** Resets the loader's own state (tests). */
export function resetSurfaceLoader(): void {
  useSurfaceLocal.setState(LOCAL_INITIAL);
}

/** Sweep horizons computed longer than this are shown as pending (a fast sweep does not flash a hint). */
export const SURFACE_SWEEP_HINT_DELAY_MS = 1500;

/**
 * True once the horizons of the tilt-sweep tilts have been computing in the background for
 * SURFACE_SWEEP_HINT_DELAY_MS: until they arrive the sweep uses the nearest tilt's horizon (approximate).
 */
export function useSurfaceSweepPending(): boolean {
  const enabled = useConfigSection('horizon').surfaceModel.enabled;
  const active = useSurfaceLocal((s) => s.sweepPending) && enabled;
  const [held, setHeld] = useState(false);
  // Reset during render (not in an effect): the next activation waits again.
  if (!active && held) setHeld(false);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setHeld(true), SURFACE_SWEEP_HINT_DELAY_MS);
    return () => clearTimeout(id);
  }, [active]);
  return active && held;
}

/** Horizons per observer key of a job result. */
function horizonsOf(set: ObserverSet, profiles: HorizonProfile[][]): Record<string, HorizonProfile> {
  const out: Record<string, HorizonProfile> = {};
  set.keys.forEach((keys, g) =>
    keys.forEach((k, h) => {
      const p = profiles[g]?.[h];
      if (p) out[k] = p;
    }),
  );
  return out;
}

/** The groups of `set` with at least one observer not in `have`. */
function missing(set: ObserverSet, have: SurfaceHorizons): ObserverSet {
  const groups: DsmObserverGroup[] = [];
  const keys: string[][] = [];
  set.groups.forEach((g, i) => {
    if (set.keys[i].some((k) => !have[k])) {
      groups.push(g);
      keys.push(set.keys[i]);
    }
  });
  return { groups, keys };
}

/** `horizons` without observers beyond the plan's current and sweep ones and EXTRA_OBSERVERS recent others. */
function prune(horizons: Record<string, HorizonProfile>, plan: SurfacePlan): Record<string, HorizonProfile> {
  const wanted = new Set([...plan.current.keys.flat(), ...plan.sweep.keys.flat()]);
  const extra = Object.keys(horizons).filter((k) => !wanted.has(k));
  const drop = new Set(extra.slice(0, Math.max(0, extra.length - EXTRA_OBSERVERS)));
  if (drop.size === 0) return horizons;
  return Object.fromEntries(Object.entries(horizons).filter(([k]) => !drop.has(k)));
}

const infoOf = (info: DsmSiteInfo): StoredInfo => ({
  years: info.dataYears,
  bytes: info.bytes,
  coverage: info.coverage,
});

const UNAVAILABLE_INFO: StoredInfo = { unavailable: true, years: [], bytes: 0, coverage: 0 };

/** True when dataStore.surface shows the horizons of the plan's job ('ready'). */
function isShown(plan: SurfacePlan): boolean {
  const s = useDataStore.getState().surface;
  return (
    s.status === 'ready' && s.siteKey === plan.siteKey && useSurfaceLocal.getState().jobKey === plan.jobKey
  );
}

/** The published horizons if they belong to the plan's job, else {}. */
function publishedHorizons(plan: SurfacePlan): SurfaceHorizons {
  return isShown(plan) ? (useDataStore.getState().surface.horizons ?? {}) : {};
}

/** Publishes horizons of the plan's job as ready (merged with those already shown for the same job). */
function publishReady(plan: SurfacePlan, info: StoredInfo, horizons: SurfaceHorizons): void {
  const merged = prune({ ...publishedHorizons(plan), ...horizons }, plan);
  useSurfaceLocal.setState({ jobKey: plan.jobKey });
  useDataStore.getState().setSurface({
    status: 'ready',
    progress: 1,
    bytes: info.bytes,
    dataYears: info.years,
    coverage: info.coverage,
    error: null,
    horizons: merged,
    siteKey: plan.siteKey,
  });
}

function publishUnavailable(): void {
  useSurfaceLocal.setState({ refresh: null });
  useDataStore.getState().setSurface({ ...INITIAL_SURFACE, status: 'unavailable', progress: 1 });
}

/**
 * A failure for the plan: while its site's horizons are shown they stay (the nearest observer stands in) and
 * the refresh reports the error; otherwise the scan is in error (results use the prisms).
 */
function publishFailure(plan: SurfacePlan, error: string): void {
  if (isShown(plan)) {
    useSurfaceLocal.setState({ refresh: { status: 'error', error } });
    return;
  }
  useSurfaceLocal.setState({ refresh: null });
  useDataStore.getState().setSurface({ ...INITIAL_SURFACE, status: 'error', error });
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A worker job's rejection (other than an abort) as a typed result. */
const rejected = (e: unknown): DsmJobResult => ({
  status: 'error',
  error: { kind: 'data', message: errorText(e) },
  stats: { requests: 0, downloaded: 0, ms: { stac: 0, download: 0, decode: 0, mask: 0, rays: 0, total: 0 } },
});

/** Loads the laser-scan horizons into dataStore.surface. Call exactly once (in <DataLoader/>). */
export function useSurfaceModelLoader(): void {
  const config = useConfig();
  const enabled = config.horizon.surfaceModel.enabled;
  // Primitive keys (the effects read the latest config from the store): unrelated config changes do not
  // restart a computation or a download.
  const keys = useMemo(() => {
    if (!enabled) return null;
    const plan = surfacePlan(config);
    return {
      jobKey: plan.jobKey,
      dataKey: plan.dataKey,
      current: plan.current.keys.flat().join(','),
      sweep: plan.sweep.keys.flat().join(','),
    };
  }, [enabled, config]);
  const jobKey = keys?.jobKey ?? null;
  const dataKey = keys?.dataKey ?? null;
  const currentKey = keys?.current ?? '';
  const sweepKey = keys?.sweep ?? '';
  const attempt = useDataStore((s) => s.surfaceAttempt);
  const loaded = useSurfaceLocal((s) => s.loaded);
  const lastRun = useRef<{ jobKey: string; attempt: number; loaded: number } | null>(null);
  /** Data key downloaded once more because its data was gone right after its download (at most once). */
  const redownload = useRef<string | null>(null);

  // Computations of the current tilt's observers: from the result cache or the worker's memory (no request;
  // a miss asks the download effect below for the site's data).
  useEffect(() => {
    const { setSurface } = useDataStore.getState();
    if (!enabled || jobKey === null) {
      lastRun.current = null;
      useSurfaceLocal.setState({
        jobKey: null,
        sweepPending: false,
        wanted: null,
        downloading: null,
        refresh: null,
      });
      setSurface(INITIAL_SURFACE);
      return;
    }
    const plan = surfacePlan(useConfigStore.getState().config);
    const prev = lastRun.current;
    lastRun.current = { jobKey: plan.jobKey, attempt, loaded };
    const retry = prev !== null && prev.attempt !== attempt;
    const afterLoad = prev !== null && prev.loaded !== loaded;
    const sameJob = prev !== null && prev.jobKey === plan.jobKey;
    const local = useSurfaceLocal.getState();
    const cur = useDataStore.getState().surface;
    const shown = isShown(plan);
    if (retry && local.refresh?.status === 'error') useSurfaceLocal.setState({ refresh: null });
    if (shown) {
      const have = cur.horizons ?? {};
      if (plan.current.keys.flat().every((k) => have[k])) return; // e.g. a tilt of the sweep
    } else {
      // A site without scan, or after a failed load (that waits for «Erneut versuchen»).
      if (sameJob && !retry && (cur.status === 'unavailable' || cur.status === 'error')) return;
      // A download of the same data goes on (as 'loading', with its progress so far).
      const downloading = local.downloading === plan.dataKey;
      if (!(cur.status === 'loading' && (sameJob || downloading))) {
        const carried = downloading && local.refresh?.status === 'loading' ? local.refresh : null;
        setSurface({
          ...INITIAL_SURFACE,
          status: 'loading',
          ...(carried ? { progress: carried.progress, bytes: carried.bytes } : {}),
        });
      }
      useSurfaceLocal.setState({
        jobKey: null,
        sweepPending: false,
        refresh: null,
        ...(local.wanted !== null && local.wanted !== plan.dataKey ? { wanted: null } : {}),
      });
    }
    const delay =
      prev === null || retry || afterLoad
        ? 0
        : shown || sameJob
          ? SURFACE_OBSERVER_DEBOUNCE_MS
          : SURFACE_DEBOUNCE_MS;
    const ctrl = new AbortController();
    const { signal } = ctrl;

    const run = async (): Promise<void> => {
      const cached = readSurfaceCache(plan.jobKey);
      // Outside the scan's extent: no request (and no wait for the download gate).
      if (cached?.info?.unavailable || !insideDsmExtent(plan.site.latitude, plan.site.longitude)) {
        publishUnavailable();
        return;
      }
      const todo = missing(plan.current, { ...(cached?.horizons ?? {}), ...publishedHorizons(plan) });
      if (cached?.info && Object.keys(cached.horizons).length > 0) {
        // From the result cache; observers it lacks are computed below (the nearest cached one stands in).
        if (todo.groups.length === 0 || !isShown(plan)) publishReady(plan, cached.info, cached.horizons);
      }
      if (todo.groups.length === 0 && isShown(plan)) return;
      let result: DsmJobResult;
      try {
        result = await computeDsmInWorker(
          { site: plan.site, groups: todo.groups, memoryOnly: true },
          { signal },
        );
      } catch (e) {
        if (signal.aborted) return;
        result = rejected(e);
      }
      if (signal.aborted) return;
      if (result.status === 'ok') {
        redownload.current = null;
        const info = infoOf(result.info);
        const fresh = horizonsOf(todo, result.horizons);
        writeSurfaceCache(plan.jobKey, info, fresh);
        publishReady(plan, info, { ...(cached?.horizons ?? {}), ...fresh });
        return;
      }
      if (result.status === 'miss') {
        const l = useSurfaceLocal.getState();
        // After a failed refresh new observers take the nearest computed one until «Erneut versuchen».
        if (l.refresh?.status === 'error' && isShown(plan)) return;
        if (l.loadedKey === plan.dataKey && l.downloading === null) {
          // The data just downloaded is gone (memory evicted, or the worker was replaced): once more, then fail.
          if (redownload.current === plan.dataKey) {
            publishFailure(plan, 'The laser-scan data did not stay in memory.');
            return;
          }
          redownload.current = plan.dataKey;
        }
        useSurfaceLocal.setState({ wanted: plan.dataKey });
        return;
      }
      if (result.status === 'unavailable') {
        writeSurfaceCache(plan.jobKey, UNAVAILABLE_INFO, {});
        publishUnavailable();
        return;
      }
      if (result.error.kind === 'aborted') return;
      publishFailure(plan, result.error.message);
    };

    const timer = setTimeout(() => void run(), delay);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [enabled, jobKey, currentKey, attempt, loaded]);

  // Download of the site's data (asked for by a memory-only job that missed). Only a change of the data key
  // (site, radius, trees, masks or not) or disabling aborts it; new observers or another facade meanwhile are
  // computed from memory once it is done (`loaded`).
  const wanted = useSurfaceLocal((s) => s.wanted);
  const download = enabled && dataKey !== null && wanted === dataKey;
  useEffect(() => {
    if (!download || dataKey === null) return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    const { setSurface } = useDataStore.getState();
    const setLocal = useSurfaceLocal.setState;

    const run = async (): Promise<void> => {
      // The site's horizons stay shown during the download: a refresh with its own progress.
      const shownAtStart = isShown(surfacePlan(useConfigStore.getState().config));
      setLocal({
        downloading: dataKey,
        ...(shownAtStart ? { refresh: { status: 'loading', progress: 0, bytes: 0 } } : {}),
      });
      try {
        await terrainDownloadGate(signal);
      } catch {
        return; // aborted
      }
      // The site and observers at the start (later observers are computed from memory when it is done).
      const plan = surfacePlan(useConfigStore.getState().config);
      if (plan.dataKey !== dataKey) return;
      const cached = readSurfaceCache(plan.jobKey);
      const todo = missing(plan.current, { ...(cached?.horizons ?? {}), ...publishedHorizons(plan) });
      let result: DsmJobResult;
      try {
        result = await computeDsmInWorker(
          { site: plan.site, groups: todo.groups },
          {
            signal,
            onProgress: (p) => {
              if (signal.aborted) return;
              if (useSurfaceLocal.getState().refresh?.status === 'loading') {
                setLocal({ refresh: { status: 'loading', progress: p.fraction, bytes: p.bytes } });
              } else if (useDataStore.getState().surface.status === 'loading') {
                setSurface({ progress: p.fraction, bytes: p.bytes });
              }
            },
          },
        );
      } catch (e) {
        if (signal.aborted) return;
        result = rejected(e);
      }
      if (signal.aborted) return;
      const now = surfacePlan(useConfigStore.getState().config);
      if (result.status === 'ok') {
        const info = infoOf(result.info);
        const fresh = horizonsOf(todo, result.horizons);
        writeSurfaceCache(plan.jobKey, info, fresh);
        if (now.jobKey === plan.jobKey) publishReady(now, info, { ...(cached?.horizons ?? {}), ...fresh });
        setLocal((s) => ({
          wanted: null,
          downloading: null,
          refresh: null,
          loadedKey: dataKey,
          loaded: s.loaded + 1,
        }));
        return;
      }
      setLocal({ wanted: null, downloading: null });
      if (result.status === 'unavailable') {
        writeSurfaceCache(plan.jobKey, UNAVAILABLE_INFO, {});
        publishUnavailable();
        return;
      }
      if (result.status === 'error' && result.error.kind === 'aborted') return;
      publishFailure(
        now,
        result.status === 'error' ? result.error.message : 'The laser-scan data did not load.',
      );
    };

    const timer = setTimeout(() => void run(), 0);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
      if (useSurfaceLocal.getState().downloading === dataKey) useSurfaceLocal.setState({ downloading: null });
    };
  }, [download, dataKey]);

  // Tilt sweep: the other tilts' observers, in the background once the current tilt is ready (from the result
  // cache or the worker's memory; a miss asks for the download like the current tilt).
  const ready = useDataStore((s) => s.surface.status === 'ready');
  const published = useSurfaceLocal((s) => s.jobKey);
  const refreshFailed = useSurfaceLocal((s) => s.refresh?.status === 'error');
  const sweepReady = enabled && ready && jobKey !== null && published === jobKey;
  useEffect(() => {
    if (!sweepReady) {
      useSurfaceLocal.setState({ sweepPending: false });
      return;
    }
    const plan = surfacePlan(useConfigStore.getState().config);
    if (plan.jobKey !== useSurfaceLocal.getState().jobKey) return;
    const cached = readSurfaceCache(plan.jobKey);
    const shown = publishedHorizons(plan);
    const fromCache: Record<string, HorizonProfile> = {};
    for (const k of plan.sweep.keys.flat()) {
      const p = cached?.horizons[k];
      if (!shown[k] && p) fromCache[k] = p;
    }
    const todo = missing(plan.sweep, { ...shown, ...fromCache });
    const merge = (horizons: SurfaceHorizons): void => {
      const s = useDataStore.getState().surface;
      if (!isShown(plan)) return;
      useDataStore.getState().setSurface({ horizons: prune({ ...(s.horizons ?? {}), ...horizons }, plan) });
    };
    if (Object.keys(fromCache).length > 0) merge(fromCache);
    if (todo.groups.length === 0) {
      useSurfaceLocal.setState({ sweepPending: false });
      return;
    }
    useSurfaceLocal.setState({ sweepPending: true });
    const ctrl = new AbortController();
    const { signal } = ctrl;
    const run = async (): Promise<void> => {
      let result: DsmJobResult;
      try {
        result = await computeDsmInWorker(
          { site: plan.site, groups: todo.groups, memoryOnly: true },
          { signal },
        );
      } catch (e) {
        if (signal.aborted) return;
        result = rejected(e);
      }
      if (signal.aborted) return;
      if (result.status === 'ok') {
        const fresh = horizonsOf(todo, result.horizons);
        writeSurfaceCache(plan.jobKey, infoOf(result.info), fresh);
        merge(fresh);
      } else if (result.status === 'miss' && useSurfaceLocal.getState().refresh?.status !== 'error') {
        // Not in memory (e.g. after a reload): the download runs as a refresh, then this effect again.
        useSurfaceLocal.setState({ wanted: plan.dataKey });
        return;
      }
      // Otherwise the sweep keeps using the nearest observer.
      useSurfaceLocal.setState({ sweepPending: false });
    };
    const timer = setTimeout(() => void run(), SURFACE_SWEEP_DELAY_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [sweepReady, jobKey, sweepKey, attempt, loaded, refreshFailed]);
}

// ── Readers ──────────────────────────────────

/** Pure form of useDsmActive: the scan is enabled and its loaded horizons belong to the config's site key. */
export function isDsmActive(
  config: Config,
  surface: Pick<SurfaceData, 'status' | 'siteKey' | 'horizons'>,
): boolean {
  return (
    config.horizon.surfaceModel.enabled &&
    surface.status === 'ready' &&
    surface.horizons !== null &&
    surface.siteKey === surfaceSiteKey(config)
  );
}

/**
 * dsmActive of the calculation rules (model/surroundings.ts): horizon.surfaceModel.enabled and the DSM
 * horizons are 'ready' for surfaceSiteKey(config). False while loading, after an error, outside coverage and
 * for horizons of another site/facade/mask (stale).
 */
export function useDsmActive(config: Config): boolean {
  const siteKey = useMemo(() => surfaceSiteKey(config), [config]);
  return useDataStore(
    (s) =>
      config.horizon.surfaceModel.enabled &&
      s.surface.status === 'ready' &&
      s.surface.horizons !== null &&
      s.surface.siteKey === siteKey,
  );
}

/** Surroundings input of floorHorizonsWithTerrain for `config` (stable identity while nothing changes). */
export function useSurroundingsSource(config: Config): SurroundingsSource {
  const active = useDsmActive(config);
  const horizons = useDataStore((s) => s.surface.horizons);
  return useMemo(() => (active && horizons ? { dsm: horizons } : NO_SURROUNDINGS), [active, horizons]);
}

/**
 * The download of the shown site's data for new observers (progress), or its failure; null when none (also
 * while the scan is off or not 'ready': then dataStore.surface has the state).
 */
export function useSurfaceRefresh(): SurfaceRefresh | null {
  const enabled = useConfigSection('horizon').surfaceModel.enabled;
  const ready = useDataStore((s) => s.surface.status === 'ready');
  const refresh = useSurfaceLocal((s) => s.refresh);
  return enabled && ready ? refresh : null;
}

/**
 * True while the laser-scan horizon of the annual results is still arriving: the enabled scan loads, its data
 * is downloaded again for current observers that have no horizon of their own yet (useSurfaceRefresh; the
 * nearest observer stands in), or newly arrived horizons have not reached the deferred annual results yet
 * (same deferral as useDeferredInputs in hooks/useModel.ts). Results computed meanwhile use the prism fallback
 * or the nearest observer and are provisional (useTerrainPending includes this).
 */
export function useSurfacePending(): boolean {
  const config = useConfig();
  const enabled = config.horizon.surfaceModel.enabled;
  const loading = useDataStore((s) => s.surface.status === 'loading');
  const refreshing = useSurfaceRefresh()?.status === 'loading';
  const horizons = useDataStore((s) => s.surface.horizons);
  const lacking =
    refreshing &&
    horizons !== null &&
    floorPlacements(config).some((p) => !horizons[surfaceObserverKey(p.center)]);
  const source = useSurroundingsSource(config);
  const deferred = useDeferredValue(source);
  return (enabled && (loading || lacking)) || deferred !== source;
}

/** What keeps provisional results provisional: the terrain horizon, the laser scan, or both (hints). */
export type ProvisionalCause = 'terrain' | 'surface' | 'both';

/**
 * Cause for the "vorläufig" hints: the laser scan while it loads (useSurfacePending), the terrain horizon
 * otherwise (also for the moment a newly arrived terrain horizon needs to reach the deferred results).
 */
export function useProvisionalCause(): ProvisionalCause {
  const surface = useSurfacePending();
  const terrainEnabled = useConfigSection('horizon').terrainEnabled;
  const terrainLoading = useDataStore((s) => s.terrain.status === 'loading');
  const terrain = terrainEnabled && terrainLoading;
  if (surface) return terrain ? 'both' : 'surface';
  return 'terrain';
}
