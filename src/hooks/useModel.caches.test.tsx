import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sunGrid } from '../model/analysis';
import { DEFAULT_CONFIG } from '../model/defaults';
import { createFloorModel, stepMonths, sunTrack } from '../model/simulation';
import { solarPath } from '../model/sun';
import { clearSkyYear } from '../model/weather';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { resetStores } from '../test/utils';
import {
  flushSweeps,
  useDailyProfile,
  useHeatmap,
  useInstantPower,
  useSimulation,
  useTiltSweep,
} from './useModel';

// Count the expensive model builders (mocks are hoisted above the imports); the hooks must share their results.
vi.mock('../model/analysis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model/analysis')>();
  return { ...actual, sunGrid: vi.fn(actual.sunGrid) };
});
vi.mock('../model/simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model/simulation')>();
  return {
    ...actual,
    sunTrack: vi.fn(actual.sunTrack),
    createFloorModel: vi.fn(actual.createFloorModel),
    stepMonths: vi.fn(actual.stepMonths),
  };
});
vi.mock('../model/sun', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model/sun')>();
  return { ...actual, solarPath: vi.fn(actual.solarPath) };
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
    vi.mocked(stepMonths).mockClear();
    vi.mocked(solarPath).mockClear();
  });

  it('tilt and geometry steps reuse the sun positions of the heatmap and the weather series', () => {
    const { result } = renderHook(() => ({
      heat: useHeatmap(),
      sim: useSimulation(),
      sweep: useTiltSweep(),
    }));
    act(() => flushSweeps()); // the sweep's first result is computed in the background
    expect(result.current.sweep?.points).toHaveLength(19);
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

  it('a tilt step reuses the months of the weather steps and the sun positions of the day', () => {
    const { result } = renderHook(() => ({ daily: useDailyProfile(), sim: useSimulation() }));
    expect(stepMonths).toHaveBeenCalledTimes(1);
    expect(solarPath).toHaveBeenCalledTimes(1);
    const { daily, sim } = result.current;
    act(() => patch('panels', { tiltFromVertical: 40 }));
    act(() => patch('panels', { tiltFromVertical: 35 }));
    expect(result.current.daily).not.toBe(daily);
    expect(result.current.sim).not.toBe(sim);
    expect(stepMonths).toHaveBeenCalledTimes(1);
    expect(solarPath).toHaveBeenCalledTimes(1);
  });
});
