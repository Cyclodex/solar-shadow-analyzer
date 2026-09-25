import { beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_SURFACE, INITIAL_TERRAIN, INITIAL_WEATHER, useDataStore } from './dataStore';

describe('useDataStore', () => {
  beforeEach(() => useDataStore.getState().resetData());

  it('merges partial updates and resets', () => {
    useDataStore.getState().setTerrain({ status: 'loading', progress: 0.5 });
    useDataStore.getState().setWeather({ status: 'error', error: 'x', usingFallback: true });
    expect(useDataStore.getState().terrain).toEqual({ ...INITIAL_TERRAIN, status: 'loading', progress: 0.5 });
    expect(useDataStore.getState().weather).toEqual({
      ...INITIAL_WEATHER,
      status: 'error',
      error: 'x',
      usingFallback: true,
    });
    useDataStore.getState().resetData();
    expect(useDataStore.getState().terrain).toBe(INITIAL_TERRAIN);
    expect(useDataStore.getState().weather).toBe(INITIAL_WEATHER);
  });

  it('surface slice: merges updates, counts retries, resets', () => {
    const horizons = { '1.93:5.17': { stepDeg: 0.5, elevations: [1, 2] } };
    useDataStore.getState().setSurface({ status: 'ready', horizons, siteKey: 'k', dataYears: [2023] });
    expect(useDataStore.getState().surface).toEqual({
      ...INITIAL_SURFACE,
      status: 'ready',
      horizons,
      siteKey: 'k',
      dataYears: [2023],
    });
    useDataStore.getState().retrySurface();
    expect(useDataStore.getState().surfaceAttempt).toBe(1);
    useDataStore.getState().resetData();
    expect(useDataStore.getState().surface).toBe(INITIAL_SURFACE);
    expect(useDataStore.getState().surfaceAttempt).toBe(0);
  });
});
