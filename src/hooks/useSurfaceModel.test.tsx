import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config, HorizonProfile } from '../model/types';
import type { DsmJobRequest, DsmJobResult } from '../model/dsm';
import { DEFAULT_CONFIG } from '../model/defaults';
import { surfaceObserverKey, surfaceSiteKey } from '../model/dsmHorizon';
import { floorPlacements } from '../model/geometry';
import { useConfigStore } from '../state/configStore';
import { INITIAL_SURFACE, useDataStore } from '../state/dataStore';
import { resetStores } from '../test/utils';
import type { DsmWorkerOptions } from '../workers/terrainClient';
import {
  decodeProfile,
  encodeProfile,
  isDsmActive,
  observerSet,
  readSurfaceCache,
  resetSurfaceLoader,
  surfacePlan,
  useDsmActive,
  useProvisionalCause,
  useSurfaceModelLoader,
  useSurfacePending,
  useSurfaceSweepPending,
  useSurroundingsSource,
  writeSurfaceCache,
} from './useSurfaceModel';
import { NO_SURROUNDINGS } from './useTerrain';

const worker = vi.hoisted(() => ({
  jobs: [] as { request: DsmJobRequest; opts: DsmWorkerOptions }[],
  respond: null as null | ((request: DsmJobRequest) => DsmJobResult),
}));

vi.mock('../workers/terrainClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../workers/terrainClient')>()),
  computeDsmInWorker: (request: DsmJobRequest, opts: DsmWorkerOptions = {}) => {
    worker.jobs.push({ request, opts });
    return new Promise<DsmJobResult>((resolve, reject) => {
      const signal = opts.signal;
      if (signal?.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      setTimeout(() => {
        if (signal?.aborted) return;
        opts.onProgress?.({ fraction: 0.5, bytes: 1000, totalBytes: 2000 });
        resolve(worker.respond!(request));
      }, 5);
    });
  },
}));

const enabled: Config = {
  ...DEFAULT_CONFIG,
  horizon: {
    ...DEFAULT_CONFIG.horizon,
    surfaceModel: { ...DEFAULT_CONFIG.horizon.surfaceModel, enabled: true },
  },
};
const flat = (v: number): HorizonProfile => ({ stepDeg: 0.5, elevations: new Array<number>(720).fill(v) });
const horizons = { '1.00:4.00': { stepDeg: 1, elevations: new Array<number>(360).fill(7) } };

/** A worker answer: per group and height a flat profile of n + z/100 degrees (identifiable). */
function okResult(request: DsmJobRequest): DsmJobResult {
  return {
    status: 'ok',
    horizons: request.groups.map((g) => g.heights.map((z) => flat(g.n + z / 100))),
    info: {
      dataYears: [2023],
      bytes: 5_000_000,
      coverage: 0.98,
      ground: 500,
      groundSource: 'height-service',
      files: 4,
      tiles: 9,
    },
    stats: {
      requests: 15,
      downloaded: 5_000_000,
      ms: { stac: 0, download: 0, decode: 0, mask: 0, rays: 0, total: 0 },
    },
  };
}

const keysOf = (config: Config): string[] => floorPlacements(config).map((p) => surfaceObserverKey(p.center));
const surface = () => useDataStore.getState().surface;

describe('dsmActive', () => {
  beforeEach(resetStores);

  it('only when enabled and the horizons are ready for the current site key', () => {
    const ready = { status: 'ready' as const, siteKey: surfaceSiteKey(enabled), horizons };
    expect(isDsmActive(enabled, ready)).toBe(true);
    expect(isDsmActive(DEFAULT_CONFIG, ready)).toBe(false); // disabled
    expect(isDsmActive(enabled, { ...ready, status: 'loading' })).toBe(false);
    expect(isDsmActive(enabled, { ...ready, status: 'error' })).toBe(false);
    expect(isDsmActive(enabled, { ...ready, horizons: null })).toBe(false);
    const moved = { ...enabled, building: { ...enabled.building, facadeAzimuth: 90 } };
    expect(isDsmActive(moved, ready)).toBe(false); // stale: another facade
  });

  it('useDsmActive / useSurroundingsSource follow the data store', () => {
    const active = renderHook(() => useDsmActive(enabled));
    const source = renderHook(() => useSurroundingsSource(enabled));
    expect(active.result.current).toBe(false);
    expect(source.result.current).toBe(NO_SURROUNDINGS);
    act(() =>
      useDataStore.getState().setSurface({ status: 'ready', siteKey: surfaceSiteKey(enabled), horizons }),
    );
    active.rerender();
    source.rerender();
    expect(active.result.current).toBe(true);
    expect(source.result.current).toEqual({ dsm: horizons });
    const first = source.result.current;
    source.rerender();
    expect(source.result.current).toBe(first); // stable identity (cache keys)
    act(() => useDataStore.getState().setSurface(INITIAL_SURFACE));
    source.rerender();
    expect(source.result.current).toBe(NO_SURROUNDINGS);
  });

  it('useSurfacePending: enabled and loading; useProvisionalCause names what is loading', () => {
    const { result, rerender } = renderHook(() => [useSurfacePending(), useProvisionalCause()] as const);
    act(() => useDataStore.getState().setSurface({ status: 'loading' }));
    rerender();
    expect(result.current).toEqual([false, 'terrain']); // disabled in the config
    act(() => useConfigStore.getState().replace(enabled));
    rerender();
    expect(result.current).toEqual([true, 'surface']);
    act(() => useDataStore.getState().setTerrain({ status: 'loading' }));
    rerender();
    expect(result.current).toEqual([true, 'both']);
  });
});

describe('surfacePlan', () => {
  it('site of the config and observers of the current and the sweep tilts', () => {
    const plan = surfacePlan(enabled);
    expect(plan.siteKey).toBe(surfaceSiteKey(enabled));
    expect(plan.site).toMatchObject({
      latitude: 47.1,
      longitude: 7.45,
      facadeAzimuth: 202,
      radius: 300,
      trees: true,
      masks: null,
      exclusion: { balconyDepthM: 1.5, ownFootprint: null },
    });
    // Two floors share one panel-row position (n) per tilt: one group with two heights.
    expect(plan.current.groups).toHaveLength(1);
    expect(plan.current.keys[0]).toEqual(keysOf(enabled));
    expect(plan.current.groups[0].heights).toEqual(keysOf(enabled).map((k) => Number(k.split(':')[1])));
    // 19 tilts (0–90° in 5° steps) × 2 floors; 80° and 85° share n = 2.06 m (1 cm keys): 18 groups.
    expect(plan.sweep.keys.flat()).toHaveLength(38);
    expect(plan.sweep.groups).toHaveLength(18);
    expect(plan.sweep.keys.flat()).toContain(keysOf(enabled)[0]); // 45° is a sweep tilt
  });

  it('own footprint and masks from the stored buildings', () => {
    const withBuildings: Config = {
      ...enabled,
      horizon: {
        ...enabled.horizon,
        buildingImport: { latitude: 47.1, longitude: 7.45, radius: 300, date: '2026-09-25' },
        buildings: [
          {
            id: 'b1',
            name: '',
            footprint: [
              [-6, -6],
              [6, -6],
              [6, 6],
              [-6, 6],
            ],
            base: 0,
            height: 15,
            source: 'swisstopo',
          },
          {
            id: 'b2',
            name: '',
            footprint: [
              [20, 20],
              [30, 20],
              [30, 30],
            ],
            base: 0,
            height: 9,
            source: 'swisstopo',
            removed: true,
          },
        ],
      },
    };
    const plan = surfacePlan(withBuildings);
    expect(plan.site.exclusion.ownFootprint).toHaveLength(4);
    expect(plan.site.masks?.polygons).toEqual([withBuildings.horizon.buildings[1].footprint]);
    expect(plan.jobKey).not.toBe(surfacePlan(enabled).jobKey);
  });

  it('observerSet groups by n and names every observer once', () => {
    const set = observerSet([
      [{ center: { u: 0, n: 1.5, z: 4 } }, { center: { u: 0, n: 1.5, z: 7 } }],
      [{ center: { u: 0, n: 1.5, z: 4 } }, { center: { u: 0, n: 2, z: 3 } }],
    ]);
    expect(set.groups).toEqual([
      { n: 1.5, heights: [4, 7] },
      { n: 2, heights: [3] },
    ]);
    expect(set.keys).toEqual([['1.50:4.00', '1.50:7.00'], ['2.00:3.00']]);
  });
});

describe('result cache', () => {
  beforeEach(() => localStorage.clear());

  it('encodes a profile compactly (0.01°, the zero half left out) and back', () => {
    const e = Array.from({ length: 720 }, (_, i) => (i > 100 && i < 460 ? Math.round(i * 7.3) / 100 : 0));
    const p = { stepDeg: 0.5, elevations: e };
    const stored = encodeProfile(p);
    expect(stored[0]).toBe(720);
    expect(stored[2].length).toBeLessThan(1000); // 359 samples × 2 bytes in base64
    expect(decodeProfile(stored)).toEqual(p);
    expect(decodeProfile(encodeProfile(flat(0)))).toEqual(flat(0));
    expect(decodeProfile(['x'])).toBeNull();
    expect(decodeProfile([720, 0, '!!'])).toBeNull();
  });

  it('merges horizons per site, keeps the info, evicts old sites', () => {
    writeSurfaceCache('a', { years: [2023], bytes: 1, coverage: 1 }, { '1.00:4.00': flat(3) });
    writeSurfaceCache('a', null, { '1.00:7.00': flat(2) });
    expect(readSurfaceCache('a')).toEqual({
      info: { years: [2023], bytes: 1, coverage: 1 },
      horizons: { '1.00:4.00': flat(3), '1.00:7.00': flat(2) },
    });
    for (const k of ['b', 'c', 'd']) writeSurfaceCache(k, null, {});
    expect(readSurfaceCache('a')).toBeNull(); // 3 sites kept
    expect(readSurfaceCache('d')).not.toBeNull();
  });
});

describe('useSurfaceModelLoader', () => {
  beforeEach(() => {
    resetStores();
    resetSurfaceLoader();
    worker.jobs.length = 0;
    worker.respond = okResult;
  });
  afterEach(() => resetSurfaceLoader());

  const enable = (config: Config = enabled): void => act(() => useConfigStore.getState().replace(config));

  it('is idle while disabled', async () => {
    renderHook(() => useSurfaceModelLoader());
    await new Promise((r) => setTimeout(r, 30));
    expect(surface()).toEqual(INITIAL_SURFACE);
    expect(worker.jobs).toHaveLength(0);
  });

  it('loads the current tilt (loading → ready), then the sweep tilts in the background', async () => {
    enable();
    const states: string[] = [];
    const unsubscribe = useDataStore.subscribe((s) => states.push(s.surface.status));
    const sweep = renderHook(() => useSurfaceSweepPending());
    renderHook(() => useSurfaceModelLoader());
    expect(surface().status).toBe('loading');
    await waitFor(() => expect(surface().status).toBe('ready'));
    const s = surface();
    expect(s).toMatchObject({
      siteKey: surfaceSiteKey(enabled),
      dataYears: [2023],
      bytes: 5_000_000,
      coverage: 0.98,
      progress: 1,
      error: null,
    });
    const [lower, upper] = keysOf(enabled);
    expect(s.horizons?.[lower]).toEqual(
      flat(Number(lower.split(':')[0]) + Number(lower.split(':')[1]) / 100),
    );
    expect(s.horizons?.[upper]).toBeDefined();
    expect(worker.jobs[0].request.groups).toEqual(surfacePlan(enabled).current.groups);
    expect(states).toContain('loading');
    // Sweep: the 18 other tilts in one job (17 groups: 80° and 85° share the panel-row position n).
    await waitFor(() => expect(worker.jobs).toHaveLength(2));
    expect(worker.jobs[1].request.groups).toHaveLength(17);
    expect(worker.jobs[1].request.groups.flatMap((g) => g.heights)).toHaveLength(36);
    sweep.rerender();
    await waitFor(() => expect(Object.keys(surface().horizons ?? {})).toHaveLength(38));
    await waitFor(() => {
      sweep.rerender();
      expect(sweep.result.current).toBe(false);
    });
    unsubscribe();
  });

  it('computes a new tilt from memory without loading; a sweep tilt needs nothing', async () => {
    enable();
    renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(Object.keys(surface().horizons ?? {})).toHaveLength(38));
    const jobs = worker.jobs.length;
    act(() => useConfigStore.getState().patch('panels', { tiltFromVertical: 50 }));
    await new Promise((r) => setTimeout(r, 400));
    expect(worker.jobs).toHaveLength(jobs);
    const states: string[] = [];
    const unsubscribe = useDataStore.subscribe((s) => states.push(s.surface.status));
    act(() => useConfigStore.getState().patch('panels', { tiltFromVertical: 47 }));
    const tilted = useConfigStore.getState().config;
    await waitFor(() => expect(surface().horizons?.[keysOf(tilted)[0]]).toBeDefined());
    expect(states.every((st) => st === 'ready')).toBe(true);
    expect(worker.jobs.at(-1)?.request.groups).toHaveLength(1);
    unsubscribe();
  });

  it('serves a loaded site from the localStorage cache', async () => {
    enable();
    const first = renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(Object.keys(surface().horizons ?? {})).toHaveLength(38));
    first.unmount();
    act(() => useDataStore.getState().resetData());
    resetSurfaceLoader();
    worker.jobs.length = 0;
    renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(surface().status).toBe('ready'));
    await waitFor(() => expect(Object.keys(surface().horizons ?? {})).toHaveLength(38));
    expect(worker.jobs).toHaveLength(0);
    expect(surface()).toMatchObject({ dataYears: [2023], coverage: 0.98 });
  });

  it('outside the scan extent: unavailable at once, without a job', async () => {
    enable({ ...enabled, location: { ...enabled.location, latitude: 48.8566, longitude: 2.3522 } });
    renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(surface().status).toBe('unavailable'), { timeout: 500 });
    expect(worker.jobs).toHaveLength(0);
  });

  it('outside the scan: unavailable (remembered); errors wait for a retry', async () => {
    worker.respond = (request) => ({ status: 'unavailable', stats: okResult(request).stats });
    enable();
    const view = renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(surface().status).toBe('unavailable'));
    expect(surface().horizons).toBeNull();
    view.unmount();
    worker.jobs.length = 0;
    renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(surface().status).toBe('unavailable'));
    expect(worker.jobs).toHaveLength(0);

    worker.respond = (request) => ({
      status: 'error',
      error: { kind: 'http', status: 503, message: 'HTTP 503 for https://data.geo.admin.ch/x.tif' },
      stats: okResult(request).stats,
    });
    act(() => useConfigStore.getState().patch('building', { facadeAzimuth: 190 }));
    await waitFor(() => expect(surface().status).toBe('error'), { timeout: 3000 });
    expect(surface().error).toContain('HTTP 503');
    const jobs = worker.jobs.length;
    act(() => useConfigStore.getState().patch('panels', { tiltFromVertical: 30 }));
    await new Promise((r) => setTimeout(r, 400));
    expect(worker.jobs).toHaveLength(jobs); // no new download without «Erneut versuchen»
    worker.respond = okResult;
    act(() => useDataStore.getState().retrySurface());
    await waitFor(() => expect(surface().status).toBe('ready'));
  });

  it('a site change waits, shows loading and drops the old horizons; disabling aborts', async () => {
    enable();
    renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(surface().status).toBe('ready'));
    act(() => useConfigStore.getState().patch('building', { facadeAzimuth: 180 }));
    expect(surface()).toMatchObject({ status: 'loading', horizons: null, siteKey: null });
    await waitFor(() => expect(surface().status).toBe('ready'), { timeout: 3000 });
    expect(surface().siteKey).toBe(surfaceSiteKey(useConfigStore.getState().config));
    act(() => useConfigStore.getState().patch('building', { facadeAzimuth: 170 }));
    await new Promise((r) => setTimeout(r, 900));
    const running = worker.jobs.at(-1)!;
    act(() =>
      useConfigStore.getState().patch('horizon', {
        surfaceModel: { ...useConfigStore.getState().config.horizon.surfaceModel, enabled: false },
      }),
    );
    expect(running.opts.signal?.aborted).toBe(true);
    expect(surface()).toEqual(INITIAL_SURFACE);
  });
});
