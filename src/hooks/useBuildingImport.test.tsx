import { renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildingFetchResult, BuildingPart, FetchBuildingsOptions } from '../model/buildingSources';
import { DEFAULT_CONFIG } from '../model/defaults';
import { enuToLonLat, lonLatToEnu } from '../model/enu';
import { pointInRing } from '../model/polygon';
import { encodeConfig, sanitizeConfig } from '../model/share';
import type { Building, Config } from '../model/types';
import { useBuildingImportStore } from '../state/buildingImportStore';
import { useConfigStore } from '../state/configStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import {
  abortBuildingImport,
  confirmBuildingImport,
  dismissBuildingImport,
  requestBuildingImport,
  resetBuildingImport,
  retryBuildingImport,
  startBuildingImport,
  useBuildingImportLoader,
  type BuildingImportDeps,
} from './useBuildingImport';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../model/buildingSources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../model/buildingSources')>()),
  fetchSwisstopoBuildings: fetchMock,
}));

/** Breitenrainstrasse 10, Bern (entrance point, 1e-6°). */
const SITE = { latitude: 46.958474, longitude: 7.45363 };

const rect = (x0: number, y0: number, w: number, d: number, height: number): BuildingPart => ({
  footprint: [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + d],
    [x0, y0 + d],
  ],
  height,
  minHeight: 0,
  kind: null,
});

/** Own part around the address point, two adjoining parts, a street row in front, far buildings, one behind. */
function parts(): BuildingPart[] {
  const out = [rect(-6, -10, 12, 12, 18), rect(-18, -10, 12, 12, 16), rect(6, -10, 12, 12, 20)];
  for (let k = 0; k < 8; k++) out.push(rect(-40 + 10 * k, 15, 9, 10, 10 + k));
  out.push(rect(-5, 120, 20, 20, 30)); // far, high: sets the horizon of the upper floors
  out.push(rect(200, 200, 10, 10, 6)); // far and low: nothing
  out.push({ ...rect(-6, -40, 12, 10, 25), holes: [] });
  return out;
}

function ok(over: Partial<Extract<BuildingFetchResult, { ok: true }>> = {}): BuildingFetchResult {
  return {
    ok: true,
    parts: parts(),
    attribution: '© swisstopo',
    tileCount: 2,
    bytes: 300_000,
    covered: true,
    coverage: 1,
    mergedPieces: 0,
    ...over,
  };
}

type FetchArgs = [number, number, number, FetchBuildingsOptions?];

/** A fetch that resolves when `release` is called, or reports 'aborted' when the signal fires. */
function deferredFetch(result: BuildingFetchResult) {
  let release: () => void = () => {};
  const fn = vi.fn((...args: FetchArgs) => {
    const opts = args[3] ?? {};
    opts.onProgress?.(1, 2, 150_000);
    return new Promise<BuildingFetchResult>((resolve) => {
      release = () => resolve(result);
      opts.signal?.addEventListener('abort', () =>
        resolve({ ok: false, error: { kind: 'aborted', message: 'aborted' }, tileCount: 2, bytes: 0 }),
      );
    });
  });
  return { fn, release: () => release() };
}

const deps = (fetchBuildings: BuildingImportDeps['fetchBuildings']): BuildingImportDeps => ({
  fetchBuildings,
  pause: () => Promise.resolve(),
  now: () => new Date(2026, 8, 25, 10).getTime(),
});

const config = (): Config => useConfigStore.getState().config;
const state = () => useBuildingImportStore.getState();

function setSite(over: Partial<Config['horizon']> = {}): void {
  useConfigStore.getState().replace(
    sanitizeConfig({
      ...DEFAULT_CONFIG,
      location: { ...DEFAULT_CONFIG.location, ...SITE, name: 'Breitenrainstrasse 10, 3013 Bern' },
      horizon: { ...DEFAULT_CONFIG.horizon, ...over },
    }),
  );
}

describe('building import', () => {
  beforeEach(() => {
    resetStores();
    resetBuildingImport();
    fetchMock.mockReset();
    setSite();
  });
  afterEach(() => resetBuildingImport());

  it('imports around the address: pruned buildings, anchor, laser scan on, site plan requested', async () => {
    const fetchBuildings = vi.fn(async () => ok());
    await startBuildingImport({ ...SITE, reason: 'address' }, deps(fetchBuildings));
    expect(fetchBuildings).toHaveBeenCalledTimes(1);
    const [lat, lon, radius] = fetchBuildings.mock.calls[0] as unknown as FetchArgs;
    expect([lat, lon, radius]).toEqual([SITE.latitude, SITE.longitude, 300]);
    const h = config().horizon;
    expect(h.buildingImport).toEqual({ ...SITE, radius: 300, date: '2026-09-25' });
    expect(h.surfaceModel.enabled).toBe(true);
    expect(h.buildings.map((b) => b.id)).toEqual(h.buildings.map((_, i) => `b${i + 1}`));
    expect(h.buildings.every((b) => b.source === 'swisstopo' && b.base === 0)).toBe(true);
    // Own part first (contains the address point), then the adjoining parts.
    expect(pointInRing(h.buildings[0].footprint, 0, 0)).toBe(true);
    expect(
      h.buildings
        .slice(1, 3)
        .map((b) => b.height)
        .sort(),
    ).toEqual([16, 20]);
    // The far high building sets the horizon of the upper floors, the far low one nothing (beyond 60 m).
    expect(h.buildings.some((b) => b.height === 30)).toBe(true);
    expect(h.buildings.some((b) => b.height === 6)).toBe(false);
    const s = state();
    expect(s.status).toBe('ready');
    expect(s.summary).toMatchObject({ found: 14, ownId: 'b1', coverage: 1, attribution: '© swisstopo' });
    expect(s.summary!.stored).toBe(h.buildings.length);
    expect(s.sitePlanRequest?.reason).toBe('address');
    expect(state().consumeSitePlanRequest()).not.toBeNull();
    expect(state().consumeSitePlanRequest()).toBeNull();
    // The stored config is already sanitized (a second pass changes nothing).
    expect(sanitizeConfig(config())).toEqual(config());
  });

  it('reports progress, and an abort leaves the config unchanged', async () => {
    const before = config();
    const { fn } = deferredFetch(ok());
    const run = startBuildingImport({ ...SITE, reason: 'manual' }, deps(fn));
    expect(state().status).toBe('loading');
    // The job module loads first (in this thread without a worker), then the tiles report.
    await waitFor(() =>
      expect(state().progress).toEqual({ phase: 'tiles', done: 1, total: 2, bytes: 150_000 }),
    );
    abortBuildingImport();
    await run;
    expect(state().status).toBe('idle');
    expect(state().progress).toBeNull();
    expect(config()).toBe(before);
    expect(state().sitePlanRequest).toBeNull();
  });

  it('a new import supersedes a running one', async () => {
    const first = deferredFetch(ok());
    const run1 = startBuildingImport({ ...SITE, reason: 'manual' }, deps(first.fn));
    const run2 = startBuildingImport({ ...SITE, reason: 'manual' }, deps(vi.fn(async () => ok())));
    await Promise.all([run1, run2]);
    expect(state().status).toBe('ready');
    // The first one stopped before or while fetching its tiles.
    const call = first.fn.mock.calls[0] as unknown as FetchArgs | undefined;
    if (call) expect(call[3]?.signal?.aborted).toBe(true);
  });

  it('an error keeps the config, retry repeats the import', async () => {
    const before = config();
    const failing = vi.fn(async () => ({
      ok: false as const,
      error: { kind: 'http' as const, message: 'HTTP 503 Service Unavailable', status: 503 },
      tileCount: 2,
      bytes: 0,
    }));
    await startBuildingImport({ ...SITE, reason: 'manual' }, deps(failing));
    expect(state().status).toBe('error');
    expect(state().error).toMatchObject({ kind: 'http', status: 503 });
    expect(config()).toBe(before);
    const good = vi.fn(async () => ok());
    retryBuildingImport(deps(good));
    await waitFor(() => expect(state().status).toBe('ready'));
    expect(good).toHaveBeenCalledTimes(1);
    expect(config().horizon.buildings.length).toBeGreaterThan(0);
  });

  it('outside Switzerland/Liechtenstein: unavailable, nothing stored; the address still turns the scan on', async () => {
    await startBuildingImport(
      { ...SITE, reason: 'address' },
      deps(vi.fn(async () => ok({ covered: false, coverage: 0, parts: [] }))),
    );
    expect(state().status).toBe('unavailable');
    expect(config().horizon.buildings).toEqual([]);
    expect(config().horizon.buildingImport).toBeNull();
    expect(config().horizon.surfaceModel.enabled).toBe(true);
    expect(state().sitePlanRequest?.reason).toBe('address');
  });

  it('keeps the coverage of border sites for the note', async () => {
    await startBuildingImport({ ...SITE, reason: 'manual' }, deps(vi.fn(async () => ok({ coverage: 0.41 }))));
    expect(state().summary?.coverage).toBe(0.41);
    expect(config().horizon.surfaceModel.enabled).toBe(false); // «Gebäude laden» leaves the scan alone
  });

  it('re-import: imported buildings replaced, manual ones kept at their world position', async () => {
    const oldAnchor = enuToLonLat(SITE, -30, 10);
    const manual: Building = {
      id: 'b7',
      name: 'Neubau',
      footprint: [
        [50, 0],
        [60, 0],
        [60, 10],
        [50, 10],
      ],
      base: 0,
      height: 9,
      source: 'manual',
    };
    const imported: Building = { ...manual, id: 'b1', name: '', source: 'swisstopo' };
    setSite({
      buildings: [imported, manual],
      buildingImport: { ...oldAnchor, radius: 300, date: '2026-01-01' },
    });
    await startBuildingImport({ ...SITE, reason: 'manual' }, deps(vi.fn(async () => ok())));
    const h = config().horizon;
    const kept = h.buildings.filter((b) => b.source === 'manual');
    expect(kept).toHaveLength(1);
    expect(kept[0].name).toBe('Neubau');
    // Imported first, then the manual ones; ids renumbered b<index + 1>.
    expect(kept[0].id).toBe(`b${h.buildings.length}`);
    expect(h.buildings.slice(0, -1).every((b) => b.source === 'swisstopo')).toBe(true);
    // Same world position: old anchor (−30, 10) + (50, 0) = (20, 10) of the site.
    expect(kept[0].footprint[0][0]).toBeCloseTo(20, 1);
    expect(kept[0].footprint[0][1]).toBeCloseTo(10, 1);
    expect(h.buildings.filter((b) => b.name === '' && b.height === 9)).toHaveLength(0);
    expect(state().summary).toMatchObject({ keptManual: 1, droppedManual: 0, ownId: 'b1' });
  });

  it('deleting a building entered by hand keeps the share link compact (imported ones first)', async () => {
    const manual = (id: string, e: number): Building => ({
      id,
      name: '',
      footprint: [
        [e, 40],
        [e + 8, 40],
        [e + 8, 48],
        [e, 48],
      ],
      base: 0,
      height: 9,
      source: 'manual',
    });
    setSite({
      buildings: [manual('b1', 50), manual('b2', 70)],
      buildingImport: { ...SITE, radius: 0, date: '' },
    });
    await startBuildingImport({ ...SITE, reason: 'manual' }, deps(vi.fn(async () => ok())));
    const before = config();
    expect(before.horizon.buildings.filter((b) => b.source === 'swisstopo').length).toBeGreaterThan(5);
    const firstManual = before.horizon.buildings.find((b) => b.source === 'manual')!;
    const after = sanitizeConfig({
      ...before,
      horizon: {
        ...before.horizon,
        buildings: before.horizon.buildings.filter((b) => b.id !== firstManual.id),
      },
    });
    // No imported id shifts (each stays b<index + 1>, the compact form); only the manual one after it does.
    after.horizon.buildings
      .filter((b) => b.source === 'swisstopo')
      .forEach((b, i) => expect(b.id).toBe(`b${i + 1}`));
    expect(encodeConfig(after).length).toBeLessThan(encodeConfig(before).length);
  });

  it('asks before discarding changes to imported buildings («Gebäude laden»)', async () => {
    const edited: Building = {
      id: 'b1',
      name: '',
      footprint: [
        [0, 20],
        [10, 20],
        [10, 30],
      ],
      base: 0,
      height: 30,
      source: 'swisstopo',
      edited: true,
    };
    setSite({ buildings: [edited], buildingImport: { ...SITE, radius: 300, date: '2026-01-01' } });
    const fetchBuildings = vi.fn(async () => ok());
    requestBuildingImport({ ...SITE, reason: 'manual' }, deps(fetchBuildings));
    expect(state().pendingConfirm).toMatchObject({ reason: 'manual' });
    expect(fetchBuildings).not.toHaveBeenCalled();
    dismissBuildingImport();
    expect(state().pendingConfirm).toBeNull();
    expect(config().horizon.buildings[0].edited).toBe(true);
    requestBuildingImport({ ...SITE, reason: 'manual' }, deps(fetchBuildings));
    confirmBuildingImport(deps(fetchBuildings));
    await waitFor(() => expect(state().status).toBe('ready'));
    expect(state().pendingConfirm).toBeNull();
    expect(config().horizon.buildings.some((b) => b.edited)).toBe(false);
  });

  it('after an address pick: asks when the address is in the same neighbourhood, replaces otherwise', async () => {
    const removed: Building = {
      id: 'b1',
      name: '',
      footprint: [
        [0, 20],
        [10, 20],
        [10, 30],
      ],
      base: 0,
      height: 30,
      source: 'swisstopo',
      removed: true,
    };
    setSite({ buildings: [removed], buildingImport: { ...SITE, radius: 300, date: '2026-01-01' } });
    const fetchBuildings = vi.fn(async () => ok());
    const near = enuToLonLat(SITE, 40, 0);
    expect(config().horizon.surfaceModel.enabled).toBe(false);
    requestBuildingImport({ ...near, reason: 'address' }, deps(fetchBuildings));
    expect(state().pendingConfirm).toMatchObject({ reason: 'address' });
    expect(useUiStore.getState().openSections.horizon).toBe(true);
    expect(state().sitePlanRequest?.reason).toBe('address');
    expect(fetchBuildings).not.toHaveBeenCalled();
    // The address pick turns the laser scan on at once; keeping the changes leaves it on.
    expect(config().horizon.surfaceModel.enabled).toBe(true);
    dismissBuildingImport();
    expect(config().horizon.surfaceModel.enabled).toBe(true);
    expect(config().horizon.buildings[0].removed).toBe(true);
    const far = enuToLonLat(SITE, 5000, 0);
    requestBuildingImport({ ...far, reason: 'address' }, deps(fetchBuildings));
    await waitFor(() => expect(state().status).toBe('ready'));
    expect(fetchBuildings).toHaveBeenCalledTimes(1);
    expect(state().pendingConfirm).toBeNull();
    const [e] = lonLatToEnu(
      SITE,
      config().horizon.buildingImport!.latitude,
      config().horizon.buildingImport!.longitude,
    );
    expect(e).toBeCloseTo(5000, 0);
  });

  it('a pick that asks before discarding edits stops an import still running for an earlier pick', async () => {
    const removed: Building = {
      id: 'b1',
      name: '',
      footprint: [
        [0, 20],
        [10, 20],
        [10, 30],
      ],
      base: 0,
      height: 30,
      source: 'swisstopo',
      removed: true,
    };
    const anchor = { ...SITE, radius: 300, date: '2026-01-01' };
    setSite({ buildings: [removed], buildingImport: anchor });
    // Pick A, 1.2 km away (another site: imported at once, still loading) …
    const slow = deferredFetch(ok());
    requestBuildingImport({ ...enuToLonLat(SITE, 1200, 0), reason: 'address' }, deps(slow.fn));
    await waitFor(() => expect(slow.fn).toHaveBeenCalledTimes(1));
    expect(state().status).toBe('loading');
    // … then pick B, 50 m from the edited site: waits for «Neu laden» / «Behalten».
    requestBuildingImport({ ...enuToLonLat(SITE, 50, 0), reason: 'address' }, deps(slow.fn));
    expect(state().pendingConfirm).toMatchObject({ reason: 'address' });
    expect(state().status).not.toBe('loading');
    // A's tiles arrive late: nothing of A is stored, the edits and the anchor stay.
    slow.release();
    await new Promise((r) => setTimeout(r, 0));
    expect(config().horizon.buildings).toEqual([removed]);
    expect(config().horizon.buildingImport).toEqual(anchor);
    dismissBuildingImport();
    expect(config().horizon.buildings[0].removed).toBe(true);
    expect(config().horizon.buildingImport).toEqual(anchor);
  });

  it('useBuildingImportLoader consumes the address search request once (StrictMode)', async () => {
    fetchMock.mockImplementation(async () => ok());
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    renderHook(() => useBuildingImportLoader(), { wrapper });
    useUiStore.getState().requestSurroundingsImport(SITE.latitude, SITE.longitude);
    await waitFor(() => expect(state().status).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().surroundingsImport).toBeNull();
    expect(config().horizon.surfaceModel.enabled).toBe(true);
  });

  it('useBuildingImportLoader picks up a request made before it mounted', async () => {
    fetchMock.mockImplementation(async () => ok());
    useUiStore.getState().requestSurroundingsImport(SITE.latitude, SITE.longitude);
    renderHook(() => useBuildingImportLoader());
    await waitFor(() => expect(state().status).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
