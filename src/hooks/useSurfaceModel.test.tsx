import { act, render, renderHook, waitFor } from '@testing-library/react';
import { useDeferredValue } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config, HorizonProfile } from '../model/types';
import type { DsmJobRequest, DsmJobResult } from '../model/dsm';
import { DEFAULT_CONFIG } from '../model/defaults';
import { surfaceObserverKey, surfaceSiteKey } from '../model/dsmHorizon';
import { floorPlacements } from '../model/geometry';
import { useConfig, useConfigStore } from '../state/configStore';
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
  useSurfaceRefresh,
  useSurfaceSweepPending,
  useSurroundingsSource,
  writeSurfaceCache,
} from './useSurfaceModel';
import { NO_SURROUNDINGS } from './useTerrain';

/**
 * A stand-in for the terrain worker: its memory holds the data keys (dsmDataKey) of the sites downloaded; a
 * memoryOnly job of another site misses at once, a download takes `downloadMs` (progress half-way).
 */
const worker = vi.hoisted(() => ({
  jobs: [] as { request: DsmJobRequest; opts: DsmWorkerOptions; outcome: string }[],
  respond: null as null | ((request: DsmJobRequest) => DsmJobResult),
  memory: new Set<string>(),
  downloadMs: 5,
}));

vi.mock('../workers/terrainClient', async (importOriginal) => {
  const { dsmDataKey } = await import('../model/dsmEstimate');
  return {
    ...(await importOriginal<typeof import('../workers/terrainClient')>()),
    computeDsmInWorker: (request: DsmJobRequest, opts: DsmWorkerOptions = {}) => {
      const job = { request, opts, outcome: 'running' };
      worker.jobs.push(job);
      return new Promise<DsmJobResult>((resolve, reject) => {
        const signal = opts.signal;
        const abort = (): void => {
          if (job.outcome === 'running') job.outcome = 'aborted';
          reject(new DOMException('aborted', 'AbortError'));
        };
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener('abort', abort);
        const key = dsmDataKey(request.site);
        const inMemory = worker.memory.has(key);
        const stats = okResult(request).stats;
        if (request.memoryOnly && !inMemory) {
          setTimeout(() => {
            if (signal?.aborted) return;
            job.outcome = 'miss';
            resolve({ status: 'miss', stats });
          }, 1);
          return;
        }
        const ms = inMemory ? 5 : worker.downloadMs;
        if (!inMemory) {
          setTimeout(() => {
            if (!signal?.aborted) opts.onProgress?.({ fraction: 0.5, bytes: 1000, totalBytes: 2000 });
          }, ms / 2);
        }
        setTimeout(() => {
          if (signal?.aborted) return;
          const result = worker.respond!(request);
          if (result.status === 'ok') worker.memory.add(key);
          job.outcome = result.status;
          resolve(result);
        }, ms);
      });
    },
  };
});

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
    localStorage.clear();
    worker.jobs.length = 0;
    worker.respond = okResult;
    worker.memory.clear();
    worker.downloadMs = 5;
  });
  afterEach(() => resetSurfaceLoader());

  const enable = (config: Config = enabled): void => act(() => useConfigStore.getState().replace(config));
  const downloads = () => worker.jobs.filter((j) => !j.request.memoryOnly);
  const tilt = (tiltFromVertical: number): void =>
    act(() => useConfigStore.getState().patch('panels', { tiltFromVertical }));
  /** A reload: the page state and the worker's memory are gone, the result cache stays. */
  const reload = (view: { unmount: () => void }): void => {
    view.unmount();
    act(() => useDataStore.getState().resetData());
    resetSurfaceLoader();
    worker.memory.clear();
    worker.jobs.length = 0;
  };

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
    // The worker's memory is empty: one memory-only miss, then one download with the current observers.
    expect(worker.jobs[0].request).toMatchObject({ memoryOnly: true });
    expect(downloads()).toHaveLength(1);
    expect(downloads()[0].request.groups).toEqual(surfacePlan(enabled).current.groups);
    expect(states).toContain('loading');
    // Sweep: the 18 other tilts in one job from memory (17 groups: 80° and 85° share the row position n).
    await waitFor(() => expect(worker.jobs.some((j) => j.request.groups.length === 17)).toBe(true));
    const sweepJob = worker.jobs.find((j) => j.request.groups.length === 17)!;
    expect(sweepJob.request.memoryOnly).toBe(true);
    expect(sweepJob.request.groups.flatMap((g) => g.heights)).toHaveLength(36);
    sweep.rerender();
    await waitFor(() => expect(Object.keys(surface().horizons ?? {})).toHaveLength(38));
    await waitFor(() => {
      sweep.rerender();
      expect(sweep.result.current).toBe(false);
    });
    expect(downloads()).toHaveLength(1);
    unsubscribe();
  });

  it('computes a new tilt from memory without loading; a sweep tilt needs nothing', async () => {
    enable();
    renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(Object.keys(surface().horizons ?? {})).toHaveLength(38));
    const jobs = worker.jobs.length;
    tilt(50);
    await new Promise((r) => setTimeout(r, 400));
    expect(worker.jobs).toHaveLength(jobs);
    const states: string[] = [];
    const unsubscribe = useDataStore.subscribe((s) => states.push(s.surface.status));
    tilt(47);
    const tilted = useConfigStore.getState().config;
    await waitFor(() => expect(surface().horizons?.[keysOf(tilted)[0]]).toBeDefined());
    expect(states.every((st) => st === 'ready')).toBe(true);
    expect(worker.jobs.at(-1)?.request).toMatchObject({ memoryOnly: true });
    expect(worker.jobs.at(-1)?.request.groups).toHaveLength(1);
    expect(downloads()).toHaveLength(1);
    unsubscribe();
  });

  it('a tilt change while the site downloads neither aborts nor restarts the download', async () => {
    worker.downloadMs = 1000;
    enable();
    const bytes: number[] = [];
    const unsubscribe = useDataStore.subscribe((s) => {
      if (s.surface.status === 'loading') bytes.push(s.surface.bytes);
    });
    renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(downloads()).toHaveLength(1));
    const download = downloads()[0];
    await waitFor(() => expect(surface().bytes).toBe(1000)); // half-way
    tilt(30);
    tilt(33);
    await new Promise((r) => setTimeout(r, 300)); // the observer debounce has passed
    expect(download.outcome).toBe('running');
    expect(surface()).toMatchObject({ status: 'loading', bytes: 1000 });
    await waitFor(() => expect(surface().status).toBe('ready'));
    expect(download.outcome).toBe('ok');
    // The new tilt's observers come from memory once the download is done: still one download.
    const tilted = useConfigStore.getState().config;
    await waitFor(() => expect(surface().horizons?.[keysOf(tilted)[0]]).toBeDefined());
    expect(downloads()).toHaveLength(1);
    expect(download.request.groups).toEqual(surfacePlan(enabled).current.groups);
    // The shown MB never went back while loading.
    expect(bytes.every((b, i) => i === 0 || b >= bytes[i - 1])).toBe(true);
    unsubscribe();
  });

  it('a facade change while the site downloads keeps the download (same data)', async () => {
    worker.downloadMs = 300;
    enable();
    renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(downloads()).toHaveLength(1));
    const download = downloads()[0];
    act(() => useConfigStore.getState().patch('building', { facadeAzimuth: 190 }));
    await waitFor(() => expect(surface().status).toBe('ready'), { timeout: 3000 });
    expect(download.outcome).toBe('ok');
    expect(surface().siteKey).toBe(surfaceSiteKey(useConfigStore.getState().config));
    expect(downloads()).toHaveLength(1);
  });

  it('serves a loaded site from the localStorage cache', async () => {
    enable();
    const first = renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(Object.keys(surface().horizons ?? {})).toHaveLength(38));
    reload(first);
    renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(surface().status).toBe('ready'));
    await waitFor(() => expect(Object.keys(surface().horizons ?? {})).toHaveLength(38));
    await new Promise((r) => setTimeout(r, 400));
    expect(worker.jobs).toHaveLength(0);
    expect(surface()).toMatchObject({ dataYears: [2023], coverage: 0.98 });
  });

  it('after a reload a new tilt reloads the data visibly (progress, provisional), after the gate', async () => {
    enable();
    const first = renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(Object.keys(surface().horizons ?? {})).toHaveLength(38));
    reload(first);
    worker.downloadMs = 200;
    renderHook(() => useSurfaceModelLoader());
    const view = renderHook(() => [useSurfaceRefresh(), useSurfacePending()] as const);
    await waitFor(() => expect(surface().status).toBe('ready'));
    // The weather request is running: downloads wait for it (state/loadGate.ts).
    act(() => useDataStore.getState().setWeather({ status: 'loading' }));
    tilt(44);
    const tilted = useConfigStore.getState().config;
    await waitFor(() => {
      view.rerender();
      expect(view.result.current).toEqual([{ status: 'loading', progress: 0, bytes: 0 }, true]);
    });
    expect(surface().status).toBe('ready'); // the other observers' horizons stay active
    await new Promise((r) => setTimeout(r, 100));
    expect(downloads()).toHaveLength(0);
    act(() => useDataStore.getState().setWeather({ status: 'ready' }));
    await waitFor(() => expect(downloads()).toHaveLength(1));
    await waitFor(() => {
      view.rerender();
      expect(view.result.current[0]).toEqual({ status: 'loading', progress: 0.5, bytes: 1000 });
    });
    await waitFor(() => expect(surface().horizons?.[keysOf(tilted)[0]]).toBeDefined());
    await waitFor(() => {
      view.rerender();
      expect(view.result.current).toEqual([null, false]);
    });
    expect(downloads()[0].request.groups).toEqual(surfacePlan(tilted).current.groups);
  });

  it('a failed reload is reported, keeps the horizons and waits for «Erneut versuchen»', async () => {
    enable();
    const first = renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(Object.keys(surface().horizons ?? {})).toHaveLength(38));
    reload(first);
    worker.respond = (request) => ({
      status: 'error',
      error: { kind: 'network', message: 'Failed to fetch' },
      stats: okResult(request).stats,
    });
    renderHook(() => useSurfaceModelLoader());
    const view = renderHook(() => [useSurfaceRefresh(), useSurfacePending()] as const);
    await waitFor(() => expect(surface().status).toBe('ready'));
    tilt(44);
    await waitFor(() => {
      view.rerender();
      expect(view.result.current).toEqual([{ status: 'error', error: 'Failed to fetch' }, false]);
    });
    expect(surface().status).toBe('ready');
    expect(Object.keys(surface().horizons ?? {})).toHaveLength(38);
    const jobs = downloads().length;
    tilt(43);
    await new Promise((r) => setTimeout(r, 400));
    expect(downloads()).toHaveLength(jobs); // no new download without «Erneut versuchen»
    worker.respond = okResult;
    act(() => useDataStore.getState().retrySurface());
    const tilted = useConfigStore.getState().config;
    await waitFor(() => expect(surface().horizons?.[keysOf(tilted)[0]]).toBeDefined());
    view.rerender();
    expect(view.result.current).toEqual([null, false]);
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
    tilt(30);
    await new Promise((r) => setTimeout(r, 400));
    expect(worker.jobs).toHaveLength(jobs); // no new download without «Erneut versuchen»
    worker.respond = okResult;
    act(() => useDataStore.getState().retrySurface());
    await waitFor(() => expect(surface().status).toBe('ready'));
  });

  it('a site change waits, shows loading and drops the old horizons; a new site or disabling aborts', async () => {
    enable();
    renderHook(() => useSurfaceModelLoader());
    await waitFor(() => expect(surface().status).toBe('ready'));
    act(() => useConfigStore.getState().patch('building', { facadeAzimuth: 180 }));
    expect(surface()).toMatchObject({ status: 'loading', horizons: null, siteKey: null });
    await waitFor(() => expect(surface().status).toBe('ready'), { timeout: 3000 });
    expect(surface().siteKey).toBe(surfaceSiteKey(useConfigStore.getState().config));
    expect(downloads()).toHaveLength(1); // same data: from memory
    // Another site: a new download; moving on aborts it, and so does disabling.
    worker.downloadMs = 2000;
    const moveTo = (latitude: number): void =>
      act(() => useConfigStore.getState().patch('location', { latitude }));
    moveTo(47.2);
    await waitFor(() => expect(downloads()).toHaveLength(2), { timeout: 3000 });
    const second = downloads()[1];
    moveTo(47.3);
    expect(second.outcome).toBe('aborted');
    await waitFor(() => expect(downloads()).toHaveLength(3), { timeout: 3000 });
    const third = downloads()[2];
    act(() =>
      useConfigStore.getState().patch('horizon', {
        surfaceModel: { ...useConfigStore.getState().config.horizon.surfaceModel, enabled: false },
      }),
    );
    expect(third.outcome).toBe('aborted');
    expect(surface()).toEqual(INITIAL_SURFACE);
  });
});

describe('useSurfacePending', () => {
  beforeEach(resetStores);

  it('stays pending until arrived horizons have reached the deferred results', () => {
    act(() => useConfigStore.getState().replace(enabled));
    act(() => useDataStore.getState().setSurface({ status: 'loading' }));
    const frames: { pending: boolean; stale: boolean }[] = [];
    function Probe() {
      const config = useConfig();
      const source = useSurroundingsSource(config);
      const deferred = useDeferredValue(source);
      const pending = useSurfacePending();
      frames.push({ pending, stale: deferred !== source });
      return null;
    }
    render(<Probe />);
    frames.length = 0;
    act(() =>
      useDataStore.getState().setSurface({ status: 'ready', siteKey: surfaceSiteKey(enabled), horizons }),
    );
    expect(frames.some((f) => f.stale)).toBe(true); // the deferred results were behind for a render …
    expect(frames.filter((f) => f.stale).every((f) => f.pending)).toBe(true); // … and pending meanwhile
    expect(frames.at(-1)).toEqual({ pending: false, stale: false });
  });
});
