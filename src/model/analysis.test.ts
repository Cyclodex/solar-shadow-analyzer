import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SWEEP_TILTS,
  HEATMAP_BEHIND,
  HEATMAP_HORIZON,
  HEATMAP_NIGHT,
  dailyProfile,
  heatmapFromSunCells,
  heatmapStats,
  heatmapSunCells,
  shadeHeatmap,
  shadeHeatmapFromGrid,
  sunGrid,
  tiltSweep,
  type SunGrid,
} from './analysis';
import { simulateYear, floorPowerW, createFloorModel, sunTrack } from './simulation';
import { solarPath, sunPosition } from './sun';
import { clearSkyYear, CLEAR_SKY_TEMPERATURE_C } from './weather';
import { clearSkyIrradiance, poaIrradiance, skyViewFactor } from './irradiance';
import { instantState, panelLayout, shadeFromAbove, sunInFacade } from './geometry';
import { emptyHorizon, floorHorizons, horizonAt } from './horizon';
import { dateFromDayOfYear, localToUtc } from './time';
import { DEFAULT_CONFIG, createObstacle } from './defaults';
import type { Config, HeatmapData, HorizonProfile } from './types';

type Over = { [K in keyof Config]?: Partial<Config[K]> };

function cfg(over: Over = {}): Config {
  const c = structuredClone(DEFAULT_CONFIG);
  for (const k of Object.keys(over) as (keyof Config)[]) Object.assign(c[k] as object, over[k]);
  return c;
}

const flat = (n: number): HorizonProfile[] => Array.from({ length: n }, () => emptyHorizon(1));

describe('shadeHeatmap', () => {
  it('has one cell per day and slot', () => {
    const h = shadeHeatmap(cfg(), flat(2), 2024, 0, 30);
    expect(h.days).toBe(366);
    expect(h.slotsPerDay).toBe(48);
    expect(h.slotMinutes).toBe(30);
    expect(h.values).toHaveLength(366 * 48);
    expect(shadeHeatmap(cfg(), flat(2), 2025, 7, 60).floor).toBe(1); // clamped to the top floor
    expect(() => shadeHeatmap(cfg(), flat(2), 2025, 0, 0)).toThrow(RangeError);
  });

  it('agrees with instantState at local slot midpoints (with an obstacle horizon)', () => {
    const c = cfg({ building: { numFloors: 3 } });
    c.horizon.obstacles = [{ ...createObstacle('a', 'A'), offsetAlong: 25, distance: 12, height: 14 }];
    const hz = floorHorizons(c, null);
    const slot = 20;
    const h = shadeHeatmap(c, hz, 2025, 0, slot);
    const code = { night: HEATMAP_NIGHT, behind: HEATMAP_BEHIND, horizon: HEATMAP_HORIZON } as const;
    const seen = new Set<number>();
    // Days away from the DST switches (the heatmap uses the local-noon offset for the whole day).
    for (const doy of [15, 80, 140, 172, 230, 280, 340]) {
      const date = dateFromDayOfYear(2025, doy);
      for (let s = 0; s < h.slotsPerDay; s++) {
        const st = instantState(c, localToUtc(date, (s + 0.5) * slot, c.location.timezone), hz).floors[0];
        const ref = st.state === 'lit' ? st.shade.fraction : code[st.state];
        const v = h.values[(doy - 1) * h.slotsPerDay + s];
        expect(v).toBeCloseTo(ref, 6);
        seen.add(v < 0 ? v : v > 0 ? 1 : 0);
      }
    }
    // Every category occurs.
    expect([...seen].sort((a, b) => a - b)).toEqual([-3, -2, -1, 0, 1]);
  });

  it('never shows panel shade on the top floor', () => {
    const h = shadeHeatmap(cfg(), flat(2), 2025, 1, 30);
    expect(h.values.some((v) => v > 0)).toBe(false);
    expect(h.values.some((v) => v === 0)).toBe(true);
  });
});

describe('sunGrid / shadeHeatmapFromGrid', () => {
  it('holds the sun position at every local slot midpoint', () => {
    const { latitude, longitude, timezone } = DEFAULT_CONFIG.location;
    const g = sunGrid(latitude, longitude, timezone, 2024, 30);
    expect([g.year, g.days, g.slotsPerDay, g.slotMinutes]).toEqual([2024, 366, 48, 30]);
    expect(g.altitude).toHaveLength(366 * 48);
    expect(g.azimuth).toHaveLength(366 * 48);
    for (const [doy, s] of [
      [15, 24],
      [172, 13],
      [300, 40],
    ]) {
      const sun = sunPosition(
        localToUtc(dateFromDayOfYear(2024, doy), (s + 0.5) * 30, timezone),
        latitude,
        longitude,
      );
      expect(g.altitude[(doy - 1) * 48 + s]).toBe(sun.altitude);
      expect(g.azimuth[(doy - 1) * 48 + s]).toBe(sun.azimuth);
    }
    expect(() => sunGrid(latitude, longitude, timezone, 2024, 0)).toThrow(RangeError);
  });

  it('one grid reproduces shadeHeatmap exactly for any tilt, facade, geometry and floor', () => {
    const base = cfg({ building: { numFloors: 3 } });
    base.horizon.obstacles = [{ ...createObstacle('a', 'A'), offsetAlong: 25, distance: 12, height: 14 }];
    const { latitude, longitude, timezone } = base.location;
    const grid = sunGrid(latitude, longitude, timezone, 2025, 20);
    const variants: Config[] = [
      base,
      { ...base, panels: { ...base.panels, tiltFromVertical: 0 } },
      { ...base, panels: { ...base.panels, tiltFromVertical: 20, count: 4 } },
      { ...base, panels: { ...base.panels, tiltFromVertical: 90 } },
      { ...base, building: { ...base.building, facadeAzimuth: 135, floorHeight: 320 } },
    ];
    for (const c of variants) {
      const hz = floorHorizons(c, null);
      for (const floor of [0, 1, 2]) {
        const a = shadeHeatmapFromGrid(grid, c, hz, floor);
        const b = shadeHeatmap(c, hz, 2025, floor, 20);
        expect(a).toEqual(b);
        expect(a.values.every((v, i) => Object.is(v, b.values[i]))).toBe(true);
        // Same values as sunInFacade + shadeFromAbove per cell, with the facade-frame cells reused.
        const direct = directHeatmapValues(grid, c, hz[floor], floor);
        expect(a.values.every((v, i) => Object.is(v, direct[i]))).toBe(true);
        const cells = heatmapSunCells(grid, c.building.facadeAzimuth, hz[floor]);
        expect(heatmapFromSunCells(cells, c, floor)).toEqual(a);
      }
    }
  });
});

/** Heatmap values with a full shadeFromAbove per cell (the computation before heatmapSunCells). */
function directHeatmapValues(grid: SunGrid, c: Config, hz: HorizonProfile, floor: number): Float32Array {
  const layout = panelLayout(c);
  const hasAbove = floor < c.building.numFloors - 1;
  return Float32Array.from(grid.altitude, (altitude, i) => {
    const sun = { altitude, azimuth: grid.azimuth[i] };
    if (altitude <= 0) return HEATMAP_NIGHT;
    const sf = sunInFacade(sun, c.building.facadeAzimuth);
    if (sf.n <= 0) return HEATMAP_BEHIND;
    if (altitude < horizonAt(hz, sun.azimuth)) return HEATMAP_HORIZON;
    return hasAbove ? shadeFromAbove(sf, layout).fraction : 0;
  });
}

describe('heatmapStats', () => {
  it('counts lit/shaded hours per month (hand-built heatmap)', () => {
    const values = new Float32Array(365 * 2).fill(HEATMAP_NIGHT);
    values[0] = 0; // 1 Jan: lit, unshaded
    values[1] = 0.5; // 1 Jan: shaded
    values[31 * 2] = 0.005; // 1 Feb: lit, below the 1 % threshold
    values[31 * 2 + 1] = HEATMAP_HORIZON;
    values[364 * 2 + 1] = 1; // 31 Dec: fully shaded
    const h: HeatmapData = { year: 2023, days: 365, slotsPerDay: 2, slotMinutes: 720, values, floor: 0 };
    const s = heatmapStats(h);
    expect(s.litHours).toBe(48); // 4 lit cells × 12 h
    expect(s.shadedHours).toBe(24);
    expect(s.shadedPct).toBe(50);
    expect(s.monthly[0]).toEqual({ month: 0, litHours: 24, shadedHours: 12, maxShade: 0.5 });
    expect(s.monthly[1].litHours).toBe(12);
    expect(s.monthly[1].shadedHours).toBe(0);
    expect(s.monthly[1].maxShade).toBeCloseTo(0.005, 8);
    expect(s.monthly[11]).toEqual({ month: 11, litHours: 12, shadedHours: 12, maxShade: 1 });
    expect(s.monthly.slice(2, 11).every((m) => m.litHours === 0)).toBe(true);
  });

  it('is 0 % for an all-night map', () => {
    const h: HeatmapData = {
      year: 2023,
      days: 365,
      slotsPerDay: 1,
      slotMinutes: 1440,
      values: new Float32Array(365).fill(HEATMAP_NIGHT),
      floor: 0,
    };
    expect(heatmapStats(h).shadedPct).toBe(0);
  });
});

describe('tiltSweep', () => {
  it('equals simulateYear at every default tilt 0…90°', () => {
    expect(DEFAULT_SWEEP_TILTS).toEqual(Array.from({ length: 19 }, (_, i) => i * 5));
    const c = cfg({ building: { numFloors: 2 } });
    const w = clearSkyYear(47.1, 7.45, 2023);
    const hz = flat(2);
    const sweep = tiltSweep(c, w, hz);
    expect(sweep.map((p) => p.tiltFromVertical)).toEqual([...DEFAULT_SWEEP_TILTS]);
    for (const p of sweep) {
      const r = simulateYear({ ...c, panels: { ...c.panels, tiltFromVertical: p.tiltFromVertical } }, w, hz);
      p.floorsKwh.forEach((kwh, k) => expect(kwh).toBeCloseTo(r.floors[k].annualKwh, 9));
      expect(p.totalKwh).toBeCloseTo(r.totalAnnualKwh, 9);
    }
    // Vertical rows do not shade each other.
    expect(sweep[0].floorsKwh[0]).toBe(sweep[0].floorsKwh[1]);
    // A prebuilt sun track gives the same result.
    expect(tiltSweep(c, w, hz, [0, 45], sunTrack(c, w))).toEqual([sweep[0], sweep[9]]);
  });

  it('accepts custom tilts and is fast', () => {
    const c = cfg({ building: { numFloors: 8 }, panels: { count: 4 } });
    const w = clearSkyYear(47.1, 7.45, 2023);
    expect(tiltSweep(c, w, flat(8), [12, 34]).map((p) => p.tiltFromVertical)).toEqual([12, 34]);
    const t0 = performance.now();
    const s = tiltSweep(c, w, flat(8));
    const ms = performance.now() - t0;
    expect(s).toHaveLength(19);
    // Measured ≈ 150–250 ms (19 tilts × 8 floors); generous bound for CI.
    expect(ms).toBeLessThan(5000);
  });
});

describe('dailyProfile', () => {
  it('covers the local day and matches a direct clear-sky computation', () => {
    const c = cfg({ building: { numFloors: 2 } });
    const hz = flat(2);
    const date = '2025-06-21';
    const p = dailyProfile(c, date, hz, 10);
    expect(p).toHaveLength(145);
    expect(p[0].minutes).toBe(0);
    expect(p[144].minutes).toBe(1440);
    const layout = panelLayout(c);
    const svfTop = skyViewFactor(layout, hz[1], c.building.facadeAzimuth, false);
    let shaded = 0;
    for (const pt of p) {
      const sun = { altitude: pt.altitude, azimuth: pt.azimuth, declination: 0, equationOfTime: 0 };
      const sf = sunInFacade(sun, c.building.facadeAzimuth);
      const poa = poaIrradiance(clearSkyIrradiance(pt.altitude, 172), sf, layout, {
        beamFactor: 1,
        skyViewFactor: svfTop,
        albedo: c.system.albedo,
      });
      expect(pt.floorsW[1]).toBeCloseTo(floorPowerW(poa.total, CLEAR_SKY_TEMPERATURE_C, c).acW, 9);
      expect(pt.floorsShade[1]).toBe(0);
      const lit = pt.altitude > 0 && sf.n > 0;
      expect(pt.floorsShade[0]).toBe(lit ? shadeFromAbove(sf, layout).fraction : 0);
      expect(pt.floorsW[0]).toBeLessThanOrEqual(pt.floorsW[1]);
      if (pt.floorsShade[0] > 0) shaded++;
      if (pt.altitude <= 0) expect(pt.floorsW).toEqual([0, 0]);
    }
    expect(shaded).toBeGreaterThan(0);
  });

  it('gives the same result with a prebuilt floor model and solar path', () => {
    const c = cfg({ building: { numFloors: 3 } });
    c.horizon.obstacles = [{ ...createObstacle('a', 'A'), offsetAlong: -10, distance: 15, height: 12 }];
    const hz = floorHorizons(c, null);
    const date = '2025-02-10';
    const expected = dailyProfile(c, date, hz, 10);
    expect(dailyProfile(c, date, hz, 10, createFloorModel(c, hz))).toEqual(expected);
    const { latitude, longitude, timezone } = c.location;
    const path = solarPath(date, latitude, longitude, timezone, 10);
    expect(dailyProfile(c, date, hz, 10, createFloorModel(c, hz), path)).toEqual(expected);
  });

  it('skips the missing hour on the spring-forward day', () => {
    // Zurich 2025-03-30: 02:00–03:00 does not exist → 145 − 6 points (solarPath).
    expect(dailyProfile(cfg(), '2025-03-30', flat(2))).toHaveLength(139);
  });
});
