import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../model/types';
import { DEFAULT_CONFIG } from '../model/defaults';
import { surfaceSiteKey } from '../model/dsmHorizon';
import { useConfigStore } from '../state/configStore';
import { INITIAL_SURFACE, useDataStore } from '../state/dataStore';
import { resetStores } from '../test/utils';
import { isDsmActive, useDsmActive, useSurfacePending, useSurroundingsSource } from './useSurfaceModel';
import { NO_SURROUNDINGS } from './useTerrain';

const enabled: Config = {
  ...DEFAULT_CONFIG,
  horizon: {
    ...DEFAULT_CONFIG.horizon,
    surfaceModel: { ...DEFAULT_CONFIG.horizon.surfaceModel, enabled: true },
  },
};
const horizons = { '1.00:4.00': { stepDeg: 1, elevations: new Array<number>(360).fill(7) } };

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

  it('useSurfacePending: enabled and loading', () => {
    const { result, rerender } = renderHook(() => useSurfacePending());
    act(() => useDataStore.getState().setSurface({ status: 'loading' }));
    rerender();
    expect(result.current).toBe(false); // disabled in the config
    act(() => useConfigStore.getState().replace(enabled));
    rerender();
    expect(result.current).toBe(true);
  });
});
