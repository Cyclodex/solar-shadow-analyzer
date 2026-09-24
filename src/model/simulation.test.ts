import { describe, it, expect } from 'vitest';
import {
  createFloorModel,
  createStepResult,
  evaluateStep,
  floorPowerW,
  simulateYear,
  stepMonths,
  sunTrack,
} from './simulation';
import { clearSkyYear } from './weather';
import { poaIrradiance, skyViewFactor } from './irradiance';
import { panelLayout, shadeFromAbove, substringBeamLoss, sunInFacade } from './geometry';
import { emptyHorizon, floorHorizons, horizonAt } from './horizon';
import { sunPosition } from './sun';
import { DEFAULT_CONFIG, createObstacle } from './defaults';
import type { Config, HorizonProfile, WeatherSeries } from './types';

/** Mulberry32 — seeded PRNG for reproducible random cases. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Over = { [K in keyof Config]?: Partial<Config[K]> };

function cfg(over: Over = {}): Config {
  const c = structuredClone(DEFAULT_CONFIG);
  for (const k of Object.keys(over) as (keyof Config)[]) Object.assign(c[k] as object, over[k]);
  return c;
}

const flat = (n: number): HorizonProfile[] => Array.from({ length: n }, () => emptyHorizon(1));

/** Clear-sky year with seeded random cloudiness per step (DNI, DHI scaled independently) and temperatures. */
function cloudyYear(seed: number, year = 2023): WeatherSeries {
  const w = clearSkyYear(47.1, 7.45, year);
  const rnd = prng(seed);
  for (let i = 0; i < w.timesUtc.length; i++) {
    const kb = rnd();
    const kd = 0.5 + 3 * rnd();
    w.dni[i] *= kb;
    w.dhi[i] *= kd;
    const alt = sunPosition(w.timesUtc[i], 47.1, 7.45).altitude;
    w.ghi[i] = alt > 0 ? w.dni[i] * Math.sin((alt * Math.PI) / 180) + w.dhi[i] : 0;
    w.temperature[i] = -10 + 45 * rnd();
  }
  return { ...w, source: 'open-meteo' };
}

/**
 * Straightforward reference implementation of the energy model from the building blocks
 * (poaIrradiance, skyViewFactor, shadeFromAbove, substringBeamLoss, floorPowerW), one step and floor at a time.
 */
function referenceAnnualKwh(config: Config, w: WeatherSeries, horizons: HorizonProfile[]): number[] {
  const layout = panelLayout(config);
  const n = config.building.numFloors;
  const gamma = config.building.facadeAzimuth;
  const svf = horizons.map((h, k) => skyViewFactor(layout, h, gamma, k < n - 1));
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < w.timesUtc.length; i++) {
    const sun = sunPosition(w.timesUtc[i], config.location.latitude, config.location.longitude);
    const sf = sunInFacade(sun, gamma);
    const sample = { ghi: w.ghi[i], dni: w.dni[i], dhi: w.dhi[i] };
    for (let k = 0; k < n; k++) {
      let beamFactor = 1;
      if (sun.altitude <= 0 || sun.altitude < horizonAt(horizons[k], sun.azimuth)) beamFactor = 0;
      else if (k < n - 1) {
        const s = shadeFromAbove(sf, layout);
        const loss = config.system.shadingModel === 'substring' ? substringBeamLoss(s, layout) : s.perModule;
        beamFactor = 1 - loss.reduce((a, b) => a + b, 0) / loss.length;
      }
      const poa = poaIrradiance(sample, sf, layout, { beamFactor, skyViewFactor: svf[k], albedo: config.system.albedo });
      out[k] += (floorPowerW(poa.total, w.temperature[i], config).acW * w.stepMinutes) / 60 / 1000;
    }
  }
  return out;
}

describe('floorPowerW', () => {
  it('applies NOCT temperature, coefficient and losses (hand computation)', () => {
    // 2 × 430 Wp, γ = −0.35 %/K, NOCT 45, losses 14 %: POA 800, T_air 20 → T_cell = 20 + 800·25/800 = 45 °C,
    // P = 860·0.8·(1 − 0.0035·20)·0.86 = 688·0.93·0.86 = 550.2624 W.
    const p = floorPowerW(800, 20, DEFAULT_CONFIG);
    expect(p.dcW).toBeCloseTo(550.2624, 9);
    expect(p.acW).toBeCloseTo(550.2624, 9);
    // Limit 500 W: POA 1200, T_air 25 → T_cell 62.5, P = 860·1.2·(1 − 0.0035·37.5)·0.86 = 771.0329… W → AC 500.
    const q = floorPowerW(1200, 25, cfg({ system: { inverterLimitW: 500 } }));
    expect(q.dcW).toBeCloseTo(860 * 1.2 * (1 - 0.0035 * 37.5) * 0.86, 9);
    expect(q.acW).toBe(500);
    expect(floorPowerW(0, 20, DEFAULT_CONFIG)).toEqual({ dcW: 0, acW: 0 });
  });
});

describe('simulateYear', () => {
  it('matches a step-by-step reference implementation (substring and linear, with obstacles)', () => {
    const w = cloudyYear(1);
    for (const shadingModel of ['substring', 'linear'] as const) {
      const c = cfg({ building: { numFloors: 3 }, system: { shadingModel } });
      c.horizon.obstacles = [{ ...createObstacle('a', 'A'), offsetAlong: -20, distance: 15, height: 9 }];
      const hz = floorHorizons(c, null);
      const r = simulateYear(c, w, hz);
      const ref = referenceAnnualKwh(c, w, hz);
      r.floors.forEach((f, k) => expect(f.annualKwh).toBeCloseTo(ref[k], 6));
      // The obstacle horizon differs per floor (non-trivial check).
      expect(new Set(hz.map((h) => Math.max(...h.elevations))).size).toBe(3);
    }
  });

  it('gives the same result with a prebuilt floor model and sun track', () => {
    const w = cloudyYear(3);
    const c = cfg({ building: { numFloors: 3 } });
    c.horizon.obstacles = [{ ...createObstacle('a', 'A'), offsetAlong: 10, distance: 20, height: 12 }];
    const hz = floorHorizons(c, null);
    const opts = { facade: false, skyGridDeg: 2 };
    const expected = simulateYear(c, w, hz, opts);
    expect(simulateYear(c, w, hz, opts, { model: createFloorModel(c, hz, opts), track: sunTrack(c, w) })).toEqual(
      expected,
    );
    expect(simulateYear(c, w, hz, opts, { track: sunTrack(c, w) })).toEqual(expected);
    expect(simulateYear(c, w, hz, {}, { model: createFloorModel(c, hz) })).toEqual(simulateYear(c, w, hz));
  });

  it('top floor equals its unshaded variant; lower floors are not better than the top', () => {
    const w = cloudyYear(2);
    for (const [tilt, az] of [
      [45, 202],
      [20, 180],
      [70, 135],
      [90, 250],
    ]) {
      const r = simulateYear(cfg({ building: { numFloors: 4, facadeAzimuth: az }, panels: { tiltFromVertical: tilt } }), w, flat(4));
      const top = r.floors[3];
      expect(top.annualKwh).toBe(top.annualUnshadedKwh);
      expect(top.monthlyKwh).toEqual(top.monthlyUnshadedKwh);
      expect(top.shadingLossKwh).toBe(0);
      for (const f of r.floors.slice(0, 3)) {
        expect(f.annualKwh).toBeLessThan(top.annualKwh);
        expect(f.annualUnshadedKwh).toBeCloseTo(top.annualKwh, 9); // same horizon → same unshaded yield
        expect(f.shadingLossKwh).toBeCloseTo(f.annualUnshadedKwh - f.annualKwh, 9);
        expect(f.shadingLossPct).toBeGreaterThan(0);
        expect(f.skyViewFactor).toBeLessThan(top.skyViewFactor);
      }
    }
  });

  it('has no shading loss with a single floor or vertical panels', () => {
    const w = cloudyYear(3);
    expect(simulateYear(cfg({ building: { numFloors: 1 } }), w, flat(1)).totalShadingLossKwh).toBe(0);
    const v = simulateYear(cfg({ building: { numFloors: 3 }, panels: { tiltFromVertical: 0 } }), w, flat(3));
    expect(v.totalShadingLossKwh).toBe(0);
    expect(v.floors[0].annualKwh).toBe(v.floors[2].annualKwh);
  });

  it('clips at the inverter limit without changing the energy before the limit', () => {
    const w = clearSkyYear(47.1, 7.45, 2023);
    const free = simulateYear(cfg({ system: { inverterLimitW: 1e9 } }), w, flat(2));
    const lim = simulateYear(cfg({ system: { inverterLimitW: 300 } }), w, flat(2));
    const lit = w.ghi.filter((g) => g > 0).length;
    lim.floors.forEach((f, k) => {
      expect(free.floors[k].clippedKwh).toBe(0);
      expect(f.clippedKwh).toBeGreaterThan(0);
      // Output before the limit does not depend on the limit: AC + clipped = unlimited AC.
      expect(f.annualKwh + f.clippedKwh).toBeCloseTo(free.floors[k].annualKwh, 6);
      expect(f.annualKwh).toBeLessThanOrEqual((300 * lit) / 1000);
    });
  });

  it('is consistent: months sum to the year, totals to the floors, specific yield per kWp', () => {
    const c = cfg({ building: { numFloors: 3 } });
    const r = simulateYear(c, cloudyYear(4), flat(3));
    for (const f of r.floors) {
      expect(f.monthlyKwh.reduce((a, b) => a + b, 0)).toBeCloseTo(f.annualKwh, 9);
      expect(f.specificYield).toBeCloseTo(f.annualKwh / 0.86, 9);
      expect(f.storey).toBe(c.building.lowestFloor + f.floor);
    }
    expect(r.totalAnnualKwh).toBeCloseTo(r.floors.reduce((s, f) => s + f.annualKwh, 0), 9);
    r.totalMonthlyKwh.forEach((m, i) => expect(m).toBeCloseTo(r.floors.reduce((s, f) => s + f.monthlyKwh[i], 0), 9));
    expect(r.source).toBe('open-meteo');
    expect(r.year).toBe(2023);
  });

  it('diffuse-only sky: POA = DHI·(cos θ + sin θ)/2 + GHI·albedo·(1 − cos β)/2 (analytic)', () => {
    const w = clearSkyYear(47.1, 7.45, 2023);
    w.dni.fill(0);
    w.dhi.fill(0);
    w.ghi.fill(0);
    w.dhi[4000] = 100;
    w.ghi[4000] = 100;
    const t = 30;
    const r = simulateYear(cfg({ building: { numFloors: 1 }, panels: { tiltFromVertical: t } }), w, flat(1));
    const D = Math.PI / 180;
    const poa = 100 * (Math.cos(t * D) + Math.sin(t * D)) / 2 + 100 * 0.2 * (1 - Math.cos((90 - t) * D)) / 2;
    expect(r.floors[0].poaKwhPerM2).toBeCloseTo(poa / 1000, 7);
  });

  it('free-standing mode differs only for sun/sky behind the facade', () => {
    const w = cloudyYear(5);
    const vertical = cfg({ building: { numFloors: 1 }, panels: { tiltFromVertical: 0 } });
    // Vertical: behind the facade = behind the panel, and both sky view factors are 0.5.
    expect(simulateYear(vertical, w, flat(1), { facade: false }).totalAnnualKwh).toBeCloseTo(
      simulateYear(vertical, w, flat(1)).totalAnnualKwh,
      9,
    );
    const tilted = cfg({ building: { numFloors: 1 }, panels: { tiltFromVertical: 55 } });
    expect(simulateYear(tilted, w, flat(1), { facade: false }).totalAnnualKwh).toBeGreaterThan(
      simulateYear(tilted, w, flat(1)).totalAnnualKwh,
    );
  });

  it('runs 8760 steps × 8 floors × 8 modules fast', () => {
    const c = cfg({ building: { numFloors: 8 }, panels: { count: 8 } });
    const w = clearSkyYear(47.1, 7.45, 2023);
    const hz = flat(8);
    simulateYear(c, w, hz); // warm-up (JIT)
    const t0 = performance.now();
    const r = simulateYear(c, w, hz);
    const ms = performance.now() - t0;
    expect(r.floors).toHaveLength(8);
    // Target < 150 ms (measured ≈ 20–40 ms); generous bound for slow CI machines.
    expect(ms).toBeLessThan(1500);
  });
});

describe('evaluateStep', () => {
  it('reports shade only while the beam reaches the floor', () => {
    const c = cfg({ building: { numFloors: 2 } });
    const m = createFloorModel(c, [emptyHorizon(1), emptyHorizon(1)]);
    const out = createStepResult(2);
    // Sun on the facade normal at 75° altitude: profile angle 75° > critical atan2(H − L·cos45°, L·sin45°) = 68.1°.
    const sun = { altitude: 75, azimuth: 202, declination: 0, equationOfTime: 0 };
    const sf = sunInFacade(sun, 202);
    const sample = { ghi: 900, dni: 800, dhi: 100 };
    evaluateStep(m, 75, 202, sf, sample, 20, out, true);
    const ref = shadeFromAbove(sf, panelLayout(c)).fraction;
    expect(ref).toBeGreaterThan(0);
    expect(out.shade[0]).toBe(ref);
    expect(out.shade[1]).toBe(0);
    expect(out.poa[0]).toBeLessThan(out.poaUnshaded[0]);
    expect(out.poaUnshaded[1]).toBe(out.poa[1]);
    // Same sun below an 80° horizon on floor 0: no beam, no shade reported.
    const high = emptyHorizon(1);
    high.elevations.fill(80);
    const m2 = createFloorModel(c, [high, null]);
    evaluateStep(m2, 75, 202, sf, sample, 20, out, false);
    expect(out.shade[0]).toBe(0);
  });
});

describe('stepMonths', () => {
  it('assigns local calendar months', () => {
    const t = [
      Date.UTC(2023, 0, 31, 22, 30), // 23:30 CET → January
      Date.UTC(2023, 0, 31, 23, 30), // 00:30 CET 1 Feb → February
      Date.UTC(2023, 6, 31, 22, 30), // 00:30 CEST 1 Aug → August
      Date.UTC(2022, 11, 31, 23, 30), // 00:30 CET 1 Jan 2023 → January
      Date.UTC(2023, 11, 31, 23, 30), // 00:30 CET 1 Jan 2024 (after the year) → January
    ];
    expect(Array.from(stepMonths(t, 2023, 'Europe/Zurich'))).toEqual([0, 1, 7, 0, 0]);
    // New York: 00:30 UTC 1 Jan = 19:30 on 31 Dec of the previous year → December bucket.
    expect(Array.from(stepMonths([Date.UTC(2023, 0, 1, 0, 30)], 2023, 'America/New_York'))).toEqual([11]);
  });
});
