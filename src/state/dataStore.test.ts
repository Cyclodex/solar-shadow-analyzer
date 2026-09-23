import { beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_TERRAIN, INITIAL_WEATHER, useDataStore } from './dataStore';

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
});
