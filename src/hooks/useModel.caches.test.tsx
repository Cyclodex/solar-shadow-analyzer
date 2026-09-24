import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sunGrid } from '../model/analysis';
import { DEFAULT_CONFIG } from '../model/defaults';
import { createFloorModel, sunTrack } from '../model/simulation';
import { clearSkyYear } from '../model/weather';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { resetStores } from '../test/utils';
import { useDailyProfile, useHeatmap, useInstantPower, useSimulation, useTiltSweep } from './useModel';

// Count the expensive model builders (mocks are hoisted above the imports); the hooks must share their results.
vi.mock('../model/analysis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model/analysis')>();
  return { ...actual, sunGrid: vi.fn(actual.sunGrid) };
});
vi.mock('../model/simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model/simulation')>();
  return { ...actual, sunTrack: vi.fn(actual.sunTrack), createFloorModel: vi.fn(actual.createFloorModel) };
});

const { latitude, longitude } = DEFAULT_CONFIG.location;
const patch = useConfigStore.getState().patch;

describe('model hook caches', () => {
  beforeEach(() => {
    resetStores();
    patch('horizon', { terrainEnabled: false });
    useDataStore.getState().setWeather({ status: 'ready', series: clearSkyYear(latitude, longitude, 2025) });
    vi.mocked(sunGrid).mockClear();
    vi.mocked(sunTrack).mockClear();
    vi.mocked(createFloorModel).mockClear();
  });

  it('tilt and geometry steps reuse the sun positions of the heatmap and the weather series', () => {
    const { result } = renderHook(() => ({
      heat: useHeatmap(),
      sim: useSimulation(),
      sweep: useTiltSweep(),
    }));
    expect(sunGrid).toHaveBeenCalledTimes(1);
    // One track for the simulation and all 19 sweep tilts.
    expect(sunTrack).toHaveBeenCalledTimes(1);
    const { heat, sim } = result.current;

    act(() => patch('panels', { tiltFromVertical: 40 }));
    act(() => patch('building', { floorHeight: 300 }));
    expect(result.current.heat).not.toBe(heat);
    expect(result.current.sim).not.toBe(sim);
    expect(sunGrid).toHaveBeenCalledTimes(1);
    expect(sunTrack).toHaveBeenCalledTimes(1);

    // The facade orientation changes the sun track (sun in facade coordinates), not the heatmap grid.
    act(() => patch('building', { facadeAzimuth: 200 }));
    expect(sunGrid).toHaveBeenCalledTimes(1);
    expect(sunTrack).toHaveBeenCalledTimes(2);

    // A new year needs a new grid.
    act(() => patch('weather', { year: 2024 }));
    expect(result.current.heat?.year).toBe(2024);
    expect(sunGrid).toHaveBeenCalledTimes(2);
  });

  it('the instant power, daily profile and simulation share one floor model', () => {
    renderHook(() => ({ power: useInstantPower(), daily: useDailyProfile(), sim: useSimulation() }));
    expect(createFloorModel).toHaveBeenCalledTimes(1);
    act(() => patch('panels', { tiltFromVertical: 40 }));
    expect(createFloorModel).toHaveBeenCalledTimes(2);
  });
});
