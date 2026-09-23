import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSkyYear } from '../model/weather';
import { DEFAULT_CONFIG } from '../model/defaults';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import {
  useEconomics,
  useFocusFloor,
  useInstant,
  useInstantPower,
  useLayout,
  useSimulation,
  useTiltSweep,
} from './useModel';

const series = clearSkyYear(DEFAULT_CONFIG.location.latitude, DEFAULT_CONFIG.location.longitude, 2025);

describe('model hooks', () => {
  beforeEach(() => {
    resetStores();
    useConfigStore.getState().patch('horizon', { terrainEnabled: false });
  });

  it('simulation is null without weather and shared between components', () => {
    const { result } = renderHook(() => ({ a: useSimulation(), b: useSimulation(), e: useEconomics() }));
    expect(result.current.a).toBeNull();
    expect(result.current.e).toBeNull();
    act(() => useDataStore.getState().setWeather({ status: 'ready', series }));
    expect(result.current.a).not.toBeNull();
    expect(result.current.a).toBe(result.current.b);
    expect(result.current.a!.totalAnnualKwh).toBeGreaterThan(0);
    expect(result.current.e!.annualKwh).toBeCloseTo(result.current.a!.totalAnnualKwh, 6);
  });

  it('the tilt sweep ignores tilt changes but reacts to other inputs', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    const { result } = renderHook(() => ({
      sweep: useTiltSweep(),
      sim: useSimulation(),
      layout: useLayout(),
    }));
    const sweep = result.current.sweep;
    const sim = result.current.sim;
    expect(sweep?.points).toHaveLength(19);
    expect(sweep?.optimum.totalKwh).toBe(Math.max(...sweep!.points.map((p) => p.totalKwh)));
    act(() => useConfigStore.getState().patch('panels', { tiltFromVertical: 30 }));
    expect(result.current.sweep).toBe(sweep);
    expect(result.current.sim).not.toBe(sim);
    expect(result.current.layout.tiltFromVertical).toBe(30);
    act(() => useConfigStore.getState().patch('system', { lossesPct: 20 }));
    expect(result.current.sweep).not.toBe(sweep);
  });

  it('time changes re-evaluate the instant only', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    const { result } = renderHook(() => ({
      instant: useInstant(),
      power: useInstantPower(),
      sim: useSimulation(),
    }));
    const sim = result.current.sim;
    const noon = result.current.instant;
    expect(noon.sun.altitude).toBeGreaterThan(50); // 21 June, 12:00 CEST, 47° N
    expect(result.current.power.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    act(() => useTimeStore.getState().setMinutes(60));
    expect(result.current.instant).not.toBe(noon);
    expect(result.current.instant.sun.altitude).toBeLessThan(0);
    expect(result.current.instant.floors.every((f) => f.state === 'night')).toBe(true);
    expect(result.current.power.every((w) => w === 0)).toBe(true);
    expect(result.current.sim).toBe(sim);
  });

  it('clamps the focus floor to the floor count', () => {
    const { result } = renderHook(() => useFocusFloor());
    act(() => useUiStore.getState().setFocusFloor(5));
    expect(result.current).toBe(DEFAULT_CONFIG.building.numFloors - 1);
    act(() => useConfigStore.getState().patch('building', { numFloors: 8 }));
    expect(result.current).toBe(5);
  });
});
