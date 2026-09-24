import { act, renderHook, waitFor } from '@testing-library/react';
import { encode } from 'fast-png';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { clearTerrainTileCache } from '../model/terrain';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { resetStores } from '../test/utils';
import {
  TERRAIN_DEBOUNCE_MS,
  floorTerrainHeight,
  terrainObserverHeights,
  terrainProfileAt,
  useTerrainLoader,
} from './useTerrain';

/** One flat Terrarium tile (every pixel 0 m: R = 128, G = B = 0). */
function flatTile(): Uint8Array {
  const data = new Uint8Array(256 * 256 * 3);
  for (let i = 0; i < data.length; i += 3) data[i] = 128;
  return encode({ width: 256, height: 256, data, channels: 3, depth: 8 });
}

describe('useTerrainLoader', () => {
  beforeEach(() => {
    resetStores();
    clearTerrainTileCache();
  });

  it('loads the terrain horizon with progress into the data store', async () => {
    const png = flatTile();
    const fetchMock = vi.fn(
      async () => ({ ok: true, status: 200, arrayBuffer: async () => png.slice().buffer }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    const progress: number[] = [];
    const unsubscribe = useDataStore.subscribe((s) => progress.push(s.terrain.progress));
    renderHook(() => useTerrainLoader());
    await waitFor(() => expect(useDataStore.getState().terrain.status).toBe('ready'), { timeout: 5000 });
    unsubscribe();
    const t = useDataStore.getState().terrain;
    expect(t.progress).toBe(1);
    expect(progress.some((p) => p > 0 && p < 1)).toBe(true);
    expect(t.siteElevation).toBe(0);
    expect(t.profile?.elevations.length).toBeGreaterThan(0);
    expect(Math.max(...t.profile!.elevations)).toBe(0); // flat ground → clamped to 0°
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('elevation-tiles-prod/terrarium');
    // One horizon per panel floor height (4 m and 7 m), from one tile download.
    await waitFor(() =>
      expect(Object.keys(useDataStore.getState().terrain.profiles ?? {})).toEqual(['4', '7']),
    );
    expect(useDataStore.getState().terrain.profiles?.[4]).toBe(useDataStore.getState().terrain.profile);
  });

  it('a floor height change recomputes from the loaded tiles and keeps the profiles meanwhile', async () => {
    const png = flatTile();
    const fetchMock = vi.fn(
      async () => ({ ok: true, status: 200, arrayBuffer: async () => png.slice().buffer }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useTerrainLoader());
    await waitFor(
      () => expect(Object.keys(useDataStore.getState().terrain.profiles ?? {})).toEqual(['4', '7']),
      {
        timeout: 5000,
      },
    );
    const calls = fetchMock.mock.calls.length;
    const before = useDataStore.getState().terrain.profiles;
    act(() => useConfigStore.getState().patch('building', { floorHeight: 350 })); // rail tops 4.5 → 5 m, 8 m
    expect(useDataStore.getState().terrain.status).toBe('ready');
    expect(useDataStore.getState().terrain.profiles).toBe(before);
    await waitFor(
      () => expect(Object.keys(useDataStore.getState().terrain.profiles ?? {})).toEqual(['5', '8']),
      {
        timeout: TERRAIN_DEBOUNCE_MS + 3000,
      },
    );
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('stays idle when the terrain horizon is disabled', () => {
    useConfigStore.getState().patch('horizon', { terrainEnabled: false });
    renderHook(() => useTerrainLoader());
    expect(useDataStore.getState().terrain.status).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads immediately, reports errors and debounces location changes', async () => {
    vi.useFakeTimers();
    renderHook(() => useTerrainLoader());
    expect(useDataStore.getState().terrain.status).toBe('loading');
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    // fetch rejects in tests → error, no profile
    expect(useDataStore.getState().terrain.status).toBe('error');
    expect(useDataStore.getState().terrain.profile).toBeNull();
    const calls = vi.mocked(fetch).mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    act(() => useConfigStore.getState().patch('location', { latitude: 46.9 }));
    expect(useDataStore.getState().terrain.status).toBe('loading');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERRAIN_DEBOUNCE_MS - 1);
    });
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(calls);
    expect(useDataStore.getState().terrain.status).toBe('error');
  });

  it('uses the top edge of each panel row as observer height (independent of the tilt)', () => {
    // lowestFloor 1, floorHeight 280 cm, railing 100 cm → 3.8 m → 4 m; next floor 6.6 m → 7 m
    expect(floorTerrainHeight({ railTopZ: 3.8 })).toBe(4);
    expect(terrainObserverHeights(DEFAULT_CONFIG)).toEqual([4, 7]);
    expect(
      terrainObserverHeights({
        ...DEFAULT_CONFIG,
        panels: { ...DEFAULT_CONFIG.panels, tiltFromVertical: 0 },
      }),
    ).toEqual([4, 7]);
    const ground = {
      ...DEFAULT_CONFIG,
      building: { ...DEFAULT_CONFIG.building, lowestFloor: 0, railingHeight: 40 },
    };
    expect(terrainObserverHeights(ground)).toEqual([1, 3]); // 0.4 m → at least 1 m
  });

  it('picks the profile of a height, else the nearest computed height', () => {
    const p = (deg: number) => ({ stepDeg: 1, elevations: new Array<number>(360).fill(deg) });
    const profiles = { 4: p(4), 10: p(10) };
    expect(terrainProfileAt(profiles, 4)).toBe(profiles[4]);
    expect(terrainProfileAt(profiles, 6)).toBe(profiles[4]);
    expect(terrainProfileAt(profiles, 7)).toBe(profiles[4]); // tie → lower height
    expect(terrainProfileAt(profiles, 8)).toBe(profiles[10]);
    expect(terrainProfileAt(p(3), 99)?.elevations[0]).toBe(3);
    expect(terrainProfileAt(null, 4)).toBeNull();
  });
});
