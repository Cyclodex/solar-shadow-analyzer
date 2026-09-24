import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HorizonProfile } from '../model/types';
import { clearSkyYear } from '../model/weather';
import { DEFAULT_CONFIG, createObstacle } from '../model/defaults';
import { floorHorizons } from '../model/horizon';
import { simulateYear } from '../model/simulation';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import {
  SWEEP_SETTLE_MS,
  useAnnualInputsPending,
  useDailyProfile,
  useEconomics,
  useFocusFloor,
  useHeatmap,
  useHeatmapStats,
  useHorizons,
  useInstant,
  useInstantPower,
  useLayout,
  useShadedFloor,
  useSimulation,
  useSolarPath,
  useSunTimes,
  useResultsReady,
  useTerrainProfile,
  useTiltSweep,
} from './useModel';
import { useWeatherBusy } from './useWeather';

const { latitude, longitude } = DEFAULT_CONFIG.location;
const series = clearSkyYear(latitude, longitude, 2025);
const patch = useConfigStore.getState().patch;
const setWeather = (s = series): void => useDataStore.getState().setWeather({ status: 'ready', series: s });

/** Flat terrain profile of `deg` degrees (1° step). */
const flat = (deg: number): HorizonProfile => ({ stepDeg: 1, elevations: new Array<number>(360).fill(deg) });

describe('model hooks', () => {
  beforeEach(() => {
    resetStores();
    patch('horizon', { terrainEnabled: false });
  });

  it('simulation is null without weather and shared between components', () => {
    const { result } = renderHook(() => ({ a: useSimulation(), b: useSimulation(), e: useEconomics() }));
    expect(result.current.a).toBeNull();
    expect(result.current.e).toBeNull();
    act(() => setWeather());
    expect(result.current.a).not.toBeNull();
    expect(result.current.a).toBe(result.current.b);
    expect(result.current.a!.totalAnnualKwh).toBeGreaterThan(0);
    expect(result.current.e!.annualKwh).toBeCloseTo(result.current.a!.totalAnnualKwh, 6);
  });

  it('economics use the simulated floors for the investment', () => {
    setWeather();
    const { result } = renderHook(() => ({ sim: useSimulation(), e: useEconomics() }));
    const { investmentPerFloor } = DEFAULT_CONFIG.economics;
    expect(result.current.e!.investment).toBe(result.current.sim!.floors.length * investmentPerFloor);
  });

  it('annual results are null while the weather belongs to another site or year', () => {
    setWeather();
    const { result } = renderHook(() => ({ sim: useSimulation(), sweep: useTiltSweep() }));
    expect(result.current.sim).not.toBeNull();
    act(() => patch('location', { latitude: 53.55, longitude: 9.99 }));
    expect(result.current.sim).toBeNull();
    expect(result.current.sweep).toBeNull();
    act(() => setWeather(clearSkyYear(53.55, 9.99, 2025)));
    expect(result.current.sim).not.toBeNull();
    expect(result.current.sweep).not.toBeNull();
    act(() => patch('weather', { year: 2024 }));
    expect(result.current.sim).toBeNull();
    expect(result.current.sweep).toBeNull();
  });

  it('results are ready only for final inputs: matching weather, nothing loading', () => {
    setWeather();
    const { result } = renderHook(() => ({
      busy: useWeatherBusy(),
      ready: useResultsReady(),
      sweep: useTiltSweep(),
    }));
    expect(result.current).toMatchObject({ busy: false, ready: true });
    expect(result.current.sweep).toMatchObject({ year: 2025, source: 'clear-sky' });

    // New site: the previous series is stale even before the loader has set 'loading'.
    act(() => patch('location', { latitude: 53.55, longitude: 9.99 }));
    expect(result.current).toMatchObject({ busy: true, ready: false });
    act(() => useDataStore.getState().setWeather({ status: 'loading' }));
    expect(result.current).toMatchObject({ busy: true, ready: false });
    act(() =>
      useDataStore.getState().setWeather({ status: 'error', series: clearSkyYear(53.554, 9.993, 2025) }),
    );
    expect(result.current).toMatchObject({ busy: false, ready: true });

    // Terrain (enabled) still loading: the weather is fine, the results are not final.
    act(() => {
      patch('horizon', { terrainEnabled: true });
      useDataStore.getState().setTerrain({ status: 'loading' });
    });
    expect(result.current).toMatchObject({ busy: false, ready: false });
  });

  it('the tilt sweep ignores tilt changes and recomputes other changes once they settled', () => {
    vi.useFakeTimers();
    setWeather();
    const { result } = renderHook(() => ({
      sweep: useTiltSweep(),
      sim: useSimulation(),
      layout: useLayout(),
    }));
    const sweep = result.current.sweep;
    const sim = result.current.sim;
    expect(sweep?.points).toHaveLength(19);
    expect(sweep?.updating).toBeFalsy();
    expect(sweep?.optimum.totalKwh).toBe(Math.max(...sweep!.points.map((p) => p.totalKwh)));
    act(() => patch('panels', { tiltFromVertical: 30 }));
    expect(result.current.sweep).toBe(sweep);
    expect(result.current.sim).not.toBe(sim);
    expect(result.current.layout.tiltFromVertical).toBe(30);

    // A drag of another input: the previous result, marked as updating, until the input settled.
    act(() => patch('system', { lossesPct: 18 }));
    act(() => {
      vi.advanceTimersByTime(SWEEP_SETTLE_MS - 50);
    });
    act(() => patch('system', { lossesPct: 20 }));
    act(() => {
      vi.advanceTimersByTime(SWEEP_SETTLE_MS - 50);
    });
    expect(result.current.sweep?.updating).toBe(true);
    expect(result.current.sweep?.points).toBe(sweep!.points);
    // Settled: computed in the background, still the previous result until it is done.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.sweep?.updating).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const next = result.current.sweep!;
    expect(next.updating).toBeFalsy();
    expect(next.points).not.toBe(sweep!.points);
    expect(next.optimum.totalKwh).toBeLessThan(sweep!.optimum.totalKwh);
  });

  it('with obstacles every sweep point equals the simulation at that tilt (own horizons per tilt)', () => {
    patch('building', { numFloors: 3 });
    patch('horizon', {
      obstacles: [
        { ...createObstacle('o1', 'Haus'), offsetAlong: 0, distance: 4, width: 30, depth: 5, height: 12 },
      ],
    });
    patch('panels', { tiltFromVertical: 25 });
    setWeather();
    const { result } = renderHook(() => ({ sweep: useTiltSweep(), sim: useSimulation() }));
    const at25 = result.current.sweep!.points.find((p) => p.tiltFromVertical === 25)!;
    expect(at25.totalKwh).toBeCloseTo(result.current.sim!.totalAnnualKwh, 6);
    result.current.sim!.floors.forEach((fl, k) => expect(at25.floorsKwh[k]).toBeCloseTo(fl.annualKwh, 6));
    // And at another tilt, against simulateYear with that tilt's horizons.
    const c = { ...useConfigStore.getState().config };
    const c60 = { ...c, panels: { ...c.panels, tiltFromVertical: 60 } };
    const expected = simulateYear(c60, series, floorHorizons(c60, null)).totalAnnualKwh;
    expect(result.current.sweep!.points.find((p) => p.tiltFromVertical === 60)!.totalKwh).toBeCloseTo(
      expected,
      6,
    );
  });

  it('location name and elevation are display-only: no yearly result is recomputed', () => {
    setWeather();
    const { result } = renderHook(() => ({
      sim: useSimulation(),
      sweep: useTiltSweep(),
      heat: useHeatmap(),
      daily: useDailyProfile(),
      sunTimes: useSunTimes(),
      path: useSolarPath(),
    }));
    const before = result.current;
    act(() => patch('location', { name: 'Zuhause' }));
    act(() => patch('location', { elevation: DEFAULT_CONFIG.location.elevation + 1 }));
    for (const key of Object.keys(before) as (keyof typeof before)[])
      expect(result.current[key]).toBe(before[key]);

    // The module power changes the yield, not the geometry-only heatmap.
    act(() => patch('panels', { powerWp: 435 }));
    expect(result.current.heat).toBe(before.heat);
    expect(result.current.sim).not.toBe(before.sim);

    act(() => patch('location', { latitude: latitude + 0.001 }));
    expect(result.current.heat).not.toBe(before.heat);
    expect(result.current.sunTimes).not.toBe(before.sunTimes);
  });

  it('the heatmap defaults to the shaded floor (never the top floor)', () => {
    patch('building', { numFloors: 3 });
    act(() => useUiStore.getState().setFocusFloor(2));
    const { result } = renderHook(() => ({ heat: useHeatmap(), top: useHeatmap(2) }));
    expect(result.current.heat.floor).toBe(1);
    expect(result.current.top.floor).toBe(2);
    act(() => useUiStore.getState().setFocusFloor(0));
    expect(result.current.heat.floor).toBe(0);
  });

  it('the heatmap can stay out of a render (enabled = false)', () => {
    const { result, rerender } = renderHook(
      ({ on }) => ({ heat: useHeatmap(0, on), stats: useHeatmapStats(0, on) }),
      {
        initialProps: { on: false },
      },
    );
    expect(result.current.heat).toBeNull();
    expect(result.current.stats).toBeNull();
    rerender({ on: true });
    expect(result.current.heat?.floor).toBe(0);
    expect(result.current.stats?.litHours).toBeGreaterThan(0);
  });

  it('time changes re-evaluate the instant only', () => {
    setWeather();
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

  it('clamps the focus floor to the floor count; the shaded floor never is the top floor', () => {
    const { result } = renderHook(() => ({ focus: useFocusFloor(), shaded: useShadedFloor() }));
    act(() => useUiStore.getState().setFocusFloor(5));
    expect(result.current).toEqual({ focus: 1, shaded: 0 });
    act(() => patch('building', { numFloors: 8 }));
    expect(result.current).toEqual({ focus: 5, shaded: 5 });
    act(() => useUiStore.getState().setFocusFloor(7));
    expect(result.current).toEqual({ focus: 7, shaded: 6 });
    act(() => patch('building', { numFloors: 1 }));
    expect(result.current).toEqual({ focus: 0, shaded: 0 });
  });

  it('annual inputs are pending while weather or (enabled) terrain load', () => {
    const { result } = renderHook(() => useAnnualInputsPending());
    expect(result.current).toBe(false);
    act(() => useDataStore.getState().setTerrain({ status: 'loading' }));
    expect(result.current).toBe(false); // terrain disabled
    act(() => patch('horizon', { terrainEnabled: true }));
    expect(result.current).toBe(true);
    act(() => useDataStore.getState().setTerrain({ status: 'error' }));
    expect(result.current).toBe(false);
    act(() => useDataStore.getState().setWeather({ status: 'loading' }));
    expect(result.current).toBe(true);
  });

  it('each floor gets the terrain horizon of its own height', () => {
    patch('horizon', { terrainEnabled: true });
    patch('building', { numFloors: 3 });
    // Rail tops: 3.8 m, 6.6 m, 9.4 m → 4, 7, 9 m. Only 4 and 9 computed so far: 7 m uses the nearest (lower on ties).
    act(() =>
      useDataStore
        .getState()
        .setTerrain({ status: 'ready', profile: flat(6), profiles: { 4: flat(6), 9: flat(4) } }),
    );
    const { result } = renderHook(() => ({
      horizons: useHorizons(),
      lowest: useTerrainProfile(),
      top: useTerrainProfile(2),
    }));
    expect(result.current.horizons.map((h) => h.elevations[0])).toEqual([6, 4, 4]);
    expect(result.current.lowest?.elevations[0]).toBe(6);
    expect(result.current.top?.elevations[0]).toBe(4);
    // A single profile (no per-height results) applies to every floor.
    act(() => useDataStore.getState().setTerrain({ profiles: null }));
    expect(result.current.horizons.map((h) => h.elevations[0])).toEqual([6, 6, 6]);
    // Disabled: no terrain.
    act(() => patch('horizon', { terrainEnabled: false }));
    expect(result.current.horizons.map((h) => h.elevations[0])).toEqual([0, 0, 0]);
    expect(result.current.top).toBeNull();
  });
});
