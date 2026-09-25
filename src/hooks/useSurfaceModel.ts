import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Config, FloorPlacement, HorizonProfile } from '../model/types';
import { DEFAULT_SWEEP_TILTS } from '../model/analysis';
import { DSM_ALGORITHM_VERSION, type DsmObserverGroup, type DsmSite, type DsmSiteInfo } from '../model/dsm';
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
// worker (workers/terrainClient.ts computeDsmInWorker, model/dsm.ts) and writes dataStore.surface:
// - a change of site, facade, balcony, row width, trees, radius or masks (surfaceSiteKey) waits
//   SURFACE_DEBOUNCE_MS, shows 'loading' (results use the prisms and are provisional) and waits for the weather
//   request (state/loadGate.ts) before downloading; the first load and a retry start at once;
// - new observers of the same site (tilt, floors, panel length) are computed from the rasters in the worker's
//   memory after SURFACE_OBSERVER_DEBOUNCE_MS while the other observers' horizons stay active (dsmFloorHorizons
//   takes the nearest one meanwhile);
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

interface SurfaceLocalState {
  /** jobKey of the horizons in dataStore.surface (null when none). */
  jobKey: string | null;
  /** The tilt-sweep observers are being computed. */
  sweepPending: boolean;
}

/** Loader state beyond dataStore.surface (module store of this hook). */
const useSurfaceLocal = create<SurfaceLocalState>()(() => ({ jobKey: null, sweepPending: false }));

/** Resets the loader's own state (tests). */
export function resetSurfaceLoader(): void {
  useSurfaceLocal.setState({ jobKey: null, sweepPending: false });
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

/** The published horizons if they belong to the plan's job, else {}. */
function publishedHorizons(plan: SurfacePlan): SurfaceHorizons {
  const s = useDataStore.getState().surface;
  const same = useSurfaceLocal.getState().jobKey === plan.jobKey && s.siteKey === plan.siteKey;
  return same && s.status === 'ready' ? (s.horizons ?? {}) : {};
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

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Loads the laser-scan horizons into dataStore.surface. Call exactly once (in <DataLoader/>). */
export function useSurfaceModelLoader(): void {
  const config = useConfig();
  const enabled = config.horizon.surfaceModel.enabled;
  // Primitive keys (the effects read the latest config from the store): unrelated config changes do not
  // restart a load.
  const keys = useMemo(() => {
    if (!enabled) return null;
    const plan = surfacePlan(config);
    return {
      jobKey: plan.jobKey,
      current: plan.current.keys.flat().join(','),
      sweep: plan.sweep.keys.flat().join(','),
    };
  }, [enabled, config]);
  const jobKey = keys?.jobKey ?? null;
  const currentKey = keys?.current ?? '';
  const sweepKey = keys?.sweep ?? '';
  const attempt = useDataStore((s) => s.surfaceAttempt);
  const lastRun = useRef<{ jobKey: string; attempt: number } | null>(null);

  // Current tilt: site changes (loading) and new observers (refresh).
  useEffect(() => {
    const { setSurface } = useDataStore.getState();
    if (!enabled || jobKey === null) {
      lastRun.current = null;
      useSurfaceLocal.setState({ jobKey: null, sweepPending: false });
      setSurface(INITIAL_SURFACE);
      return;
    }
    const plan = surfacePlan(useConfigStore.getState().config);
    const prev = lastRun.current;
    lastRun.current = { jobKey: plan.jobKey, attempt };
    const retry = prev !== null && prev.attempt !== attempt;
    const sameJob = prev !== null && !retry && prev.jobKey === plan.jobKey;
    const cur = useDataStore.getState().surface;
    // The site's horizons are shown: new observers (or a new own footprint) are computed without 'loading'.
    const refresh = !retry && cur.status === 'ready' && cur.siteKey === plan.siteKey;
    if (refresh && sameJob && useSurfaceLocal.getState().jobKey === plan.jobKey) {
      const have = cur.horizons ?? {};
      if (plan.current.keys.flat().every((k) => have[k])) return; // e.g. a tilt of the sweep
    }
    // New observers at a site without scan, or after a failed load (that waits for «Erneut versuchen»).
    if (sameJob && (cur.status === 'unavailable' || cur.status === 'error')) return;
    const delay = prev === null || retry ? 0 : sameJob ? SURFACE_OBSERVER_DEBOUNCE_MS : SURFACE_DEBOUNCE_MS;
    if (!refresh) {
      useSurfaceLocal.setState({ jobKey: null, sweepPending: false });
      // A load already running for this site keeps its progress (the worker keeps the tiles it has).
      if (!(sameJob && cur.status === 'loading')) setSurface({ ...INITIAL_SURFACE, status: 'loading' });
    }
    const ctrl = new AbortController();
    const { signal } = ctrl;

    const run = async (): Promise<void> => {
      const cached = readSurfaceCache(plan.jobKey);
      if (cached?.info?.unavailable) {
        setSurface({ ...INITIAL_SURFACE, status: 'unavailable', progress: 1 });
        return;
      }
      const have = { ...(cached?.horizons ?? {}), ...publishedHorizons(plan) };
      const todo = missing(plan.current, have);
      if (cached?.info && todo.groups.length === 0) {
        publishReady(plan, cached.info, cached.horizons);
        return;
      }
      if (!refresh) {
        try {
          await terrainDownloadGate(signal);
        } catch {
          return; // aborted
        }
      }
      let result;
      try {
        result = await computeDsmInWorker(
          { site: plan.site, groups: todo.groups },
          {
            signal,
            onProgress: refresh
              ? undefined
              : (p) => {
                  if (!signal.aborted) setSurface({ progress: p.fraction, bytes: p.bytes });
                },
          },
        );
      } catch (e) {
        if (signal.aborted) return;
        if (!refresh) setSurface({ ...INITIAL_SURFACE, status: 'error', error: errorText(e) });
        return;
      }
      if (signal.aborted) return;
      if (result.status === 'unavailable') {
        writeSurfaceCache(plan.jobKey, { unavailable: true, years: [], bytes: 0, coverage: 0 }, {});
        setSurface({ ...INITIAL_SURFACE, status: 'unavailable', progress: 1 });
        return;
      }
      if (result.status === 'error') {
        if (result.error.kind === 'aborted') return;
        // A refresh keeps the shown horizons (the nearest observer stands in).
        if (!refresh) setSurface({ ...INITIAL_SURFACE, status: 'error', error: result.error.message });
        return;
      }
      const info = infoOf(result.info);
      const fresh = horizonsOf(todo, result.horizons);
      writeSurfaceCache(plan.jobKey, info, fresh);
      publishReady(plan, info, { ...(cached?.horizons ?? {}), ...fresh });
    };

    const timer = setTimeout(() => void run(), delay);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [enabled, jobKey, currentKey, attempt]);

  // Tilt sweep: the other tilts' observers, in the background once the current tilt is ready.
  const ready = useDataStore((s) => s.surface.status === 'ready');
  const published = useSurfaceLocal((s) => s.jobKey);
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
      if (
        s.status !== 'ready' ||
        s.siteKey !== plan.siteKey ||
        useSurfaceLocal.getState().jobKey !== plan.jobKey
      ) {
        return;
      }
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
      try {
        const result = await computeDsmInWorker({ site: plan.site, groups: todo.groups }, { signal });
        if (signal.aborted) return;
        if (result.status === 'ok') {
          const fresh = horizonsOf(todo, result.horizons);
          writeSurfaceCache(plan.jobKey, infoOf(result.info), fresh);
          merge(fresh);
        }
      } catch {
        if (signal.aborted) return;
        // The sweep keeps using the nearest observer.
      }
      useSurfaceLocal.setState({ sweepPending: false });
    };
    const timer = setTimeout(() => void run(), SURFACE_SWEEP_DELAY_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [sweepReady, jobKey, sweepKey, attempt]);
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
 * True while the enabled laser-scan horizon is still arriving (loading): annual results computed meanwhile use
 * the prism fallback and are provisional (useTerrainPending in hooks/useModel.ts includes it).
 */
export function useSurfacePending(): boolean {
  const enabled = useConfigSection('horizon').surfaceModel.enabled;
  const loading = useDataStore((s) => s.surface.status === 'loading');
  return enabled && loading;
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
