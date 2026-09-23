import { act, renderHook, waitFor } from '@testing-library/react';
import { encode } from 'fast-png';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { clearTerrainTileCache } from '../model/terrain';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { resetStores } from '../test/utils';
import { TERRAIN_DEBOUNCE_MS, terrainObserverHeight, useTerrainLoader } from './useTerrain';

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

  it('uses the top edge of the lowest panel row as observer height (independent of the tilt)', () => {
    // lowestFloor 1, floorHeight 280 cm, railing 100 cm → 3.8 m → 4 m
    expect(terrainObserverHeight(DEFAULT_CONFIG)).toBe(4);
    expect(
      terrainObserverHeight({ ...DEFAULT_CONFIG, panels: { ...DEFAULT_CONFIG.panels, tiltFromVertical: 0 } }),
    ).toBe(4);
  });
});
