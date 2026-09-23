import { describe, it, expect } from 'vitest';
import {
  SOLAR_CONSTANT,
  airMass,
  clearSkyIrradiance,
  extraterrestrialNormal,
  groundViewFactor,
  iamAshrae,
  poaIrradiance,
  rowAboveBlockedFraction,
  skyViewFactor,
  skyViewFromGrid,
  skyViewGrid,
} from './irradiance';
import { panelLayout, shadeFromAbove } from './geometry';
import { emptyHorizon } from './horizon';
import { DEFAULT_CONFIG } from './defaults';
import type { Config, FacadeVector, HorizonProfile } from './types';

const D = Math.PI / 180;

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

function cfg(tiltFromVertical: number, panels: Partial<Config['panels']> = {}, building: Partial<Config['building']> = {}): Config {
  const c = structuredClone(DEFAULT_CONFIG);
  Object.assign(c.panels, { tiltFromVertical }, panels);
  Object.assign(c.building, building);
  return c;
}

function uniformHorizon(elevation: number): HorizonProfile {
  const h = emptyHorizon(1);
  h.elevations.fill(elevation);
  return h;
}

describe('extraterrestrialNormal', () => {
  it('matches the Spencer series', () => {
    // doy 1: B = 0 → all sine terms vanish: 1361·(1.00011 + 0.034221 + 0.000719) = 1361·1.03505.
    expect(extraterrestrialNormal(1)).toBeCloseTo(1361 * 1.03505, 9);
    // Cross-check: pvlib 0.15.2 get_extra_radiation(172, solar_constant=1361, method='spencer').
    expect(extraterrestrialNormal(172)).toBeCloseTo(1316.6896343530445, 9);
    expect(SOLAR_CONSTANT).toBe(1361);
  });

  it('averages to ≈ the solar constant over a year', () => {
    // Mean of the Fourier series over a full period = constant term 1.00011 (discrete sum over 365 days is exact).
    let s = 0;
    for (let d = 1; d <= 365; d++) s += extraterrestrialNormal(d);
    expect(s / 365).toBeCloseTo(1361 * 1.00011, 6);
  });
});

describe('airMass', () => {
  it('matches Kasten & Young 1989 (pvlib 0.15.2 kastenyoung1989)', () => {
    expect(airMass(90)).toBeCloseTo(0.9997119918558381, 12);
    expect(airMass(30)).toBeCloseTo(1.9942928525292494, 12);
    expect(airMass(10)).toBeCloseTo(5.5860358798512, 12);
    expect(airMass(0)).toBeCloseTo(37.91960837783625, 10);
  });

  it('is Infinity below the horizon', () => {
    expect(airMass(-0.1)).toBe(Infinity);
    expect(airMass(Number.NaN)).toBe(Infinity);
  });
});

describe('clearSkyIrradiance', () => {
  it('matches hand-computed Meinel values', () => {
    // Python (math only): E0 = Spencer, AM = Kasten-Young, DNI = E0·0.7^(AM^0.678), DHI = 0.1·DNI, GHI = DNI·sin h + DHI.
    const a = clearSkyIrradiance(60, 172);
    expect(a.dni).toBeCloseTo(888.7602367703623, 9);
    expect(a.dhi).toBeCloseTo(88.87602367703624, 9);
    expect(a.ghi).toBeCloseTo(858.5649665936426, 9);
    const b = clearSkyIrradiance(30, 1);
    expect(b.dni).toBeCloseTo(797.0184516578978, 9);
    expect(b.ghi).toBeCloseTo(478.21107099473863, 9);
    const c = clearSkyIrradiance(90, 185);
    expect(c.ghi).toBeCloseTo(1013.0272244255111, 9);
  });

  it('is zero at night', () => {
    expect(clearSkyIrradiance(0, 100)).toEqual({ ghi: 0, dni: 0, dhi: 0 });
    expect(clearSkyIrradiance(-12, 100)).toEqual({ ghi: 0, dni: 0, dhi: 0 });
  });

  it('grows with altitude', () => {
    let prev = 0;
    for (let h = 1; h <= 90; h++) {
      const g = clearSkyIrradiance(h, 80).ghi;
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
  });
});

describe('iamAshrae', () => {
  it('matches 1 − b0·(1/cos − 1) (values from pvlib 0.15.2 iam.ashrae)', () => {
    expect(iamAshrae(1)).toBe(1);
    expect(iamAshrae(0.8)).toBeCloseTo(0.9875, 12);
    expect(iamAshrae(0.5)).toBeCloseTo(0.95, 12);
    expect(iamAshrae(0.1)).toBeCloseTo(0.55, 12);
    expect(iamAshrae(0.5, 0.1)).toBeCloseTo(0.9, 12);
  });

  it('clamps to 0 for grazing and back-side incidence', () => {
    // IAM = 0 at cos = b0/(1 + b0) = 0.047619…
    expect(iamAshrae(0.05 / 1.05)).toBeCloseTo(0, 12);
    expect(iamAshrae(0.02)).toBe(0);
    expect(iamAshrae(0)).toBe(0);
    expect(iamAshrae(-0.5)).toBe(0);
  });
});

describe('poaIrradiance', () => {
  const layout = panelLayout(cfg(45)); // β = 45°
  const sample = { ghi: 600, dni: 700, dhi: 150 };

  it('sums beam, diffuse and ground (hand computation)', () => {
    // Sun in the facade normal plane at 30° altitude: cosInc = cos30·cos45 + sin30·sin45 = cos(15°).
    const sf: FacadeVector = { u: 0, n: Math.cos(30 * D), z: Math.sin(30 * D) };
    const ci = Math.cos(15 * D);
    const iam = 1 - 0.05 * (1 / ci - 1);
    const p = poaIrradiance(sample, sf, layout, { beamFactor: 0.8, skyViewFactor: 0.7, albedo: 0.2 });
    expect(p.beam).toBeCloseTo(700 * ci * iam * 0.8, 9);
    expect(p.diffuse).toBeCloseTo(150 * 0.7, 12);
    expect(p.ground).toBeCloseTo(600 * 0.2 * (1 - Math.cos(45 * D)) / 2, 9);
    expect(p.total).toBeCloseTo(p.beam + p.diffuse + p.ground, 12);
  });

  it('has no beam when the sun is behind the facade', () => {
    const sf: FacadeVector = { u: 0, n: -0.1, z: Math.sqrt(1 - 0.01) };
    const p = poaIrradiance(sample, sf, layout, { beamFactor: 1, skyViewFactor: 0.5, albedo: 0.2 });
    expect(p.beam).toBe(0);
    expect(p.total).toBeCloseTo(p.diffuse + p.ground, 12);
  });

  it('groundViewFactor = (1 − cos β)/2', () => {
    for (const t of [0, 30, 45, 90]) {
      expect(groundViewFactor(panelLayout(cfg(t)))).toBeCloseTo((1 - Math.cos((90 - t) * D)) / 2, 12);
    }
  });
});

describe('rowAboveBlockedFraction', () => {
  it('equals shadeFromAbove().fraction for directions in front of the facade', () => {
    const rnd = prng(7);
    let nonZero = 0;
    for (let i = 0; i < 500; i++) {
      const layout = panelLayout(
        cfg(rnd() * 90, { count: 1 + Math.floor(rnd() * 4), gap: rnd() * 30, width: 50 + rnd() * 150 }, {
          floorHeight: 200 + rnd() * 200,
        }),
      );
      const a = rnd() * 89.9 * D + 1e-4;
      const f = (rnd() - 0.5) * 179.8 * D;
      const d: FacadeVector = { u: -Math.cos(a) * Math.sin(f), n: Math.cos(a) * Math.cos(f), z: Math.sin(a) };
      const ref = shadeFromAbove(d, layout).fraction;
      if (ref > 0) nonZero++;
      expect(rowAboveBlockedFraction(d, layout)).toBeCloseTo(ref, 12);
    }
    expect(nonZero).toBeGreaterThan(100);
  });

  it('is 0 for a vertical row and for back-side directions', () => {
    expect(rowAboveBlockedFraction({ u: 0, n: 0.5, z: Math.sqrt(0.75) }, panelLayout(cfg(0)))).toBe(0);
    expect(rowAboveBlockedFraction({ u: 0, n: 0, z: -1 }, panelLayout(cfg(45)))).toBe(0);
  });
});

describe('skyViewFactor', () => {
  it('unobstructed free-standing plane = (1 + cos β)/2 within 0.5 %', () => {
    for (const t of [0, 10, 30, 45, 60, 80, 90]) {
      const f = skyViewFactor(panelLayout(cfg(t)), null, 180, false, { facade: false });
      const exact = (1 + Math.cos((90 - t) * D)) / 2;
      expect(Math.abs(f / exact - 1)).toBeLessThan(0.005);
      // Observed 2e-5 with the default 1° grid.
      expect(Math.abs(f / exact - 1)).toBeLessThan(1e-4);
    }
  });

  it('vertical panel in front of the facade = 0.5', () => {
    expect(skyViewFactor(panelLayout(cfg(0)), null, 202, false)).toBeCloseTo(0.5, 9);
    // Facade and panel plane coincide: the facade blocks nothing extra.
    expect(skyViewFactor(panelLayout(cfg(0)), null, 202, false, { facade: false })).toBeCloseTo(0.5, 9);
  });

  it('facade blocking reduces it to (cos θ + sin θ)/2', () => {
    // Visible profile angles p ∈ (0°, 90°); 2D kernel ½·cos(p − θ) → ½[sin(90° − θ) + sin θ].
    for (const t of [15, 45, 70, 90]) {
      const layout = panelLayout(cfg(t));
      const f = skyViewFactor(layout, null, 180, false);
      expect(f).toBeCloseTo((Math.cos(t * D) + Math.sin(t * D)) / 2, 6);
      // Blocked share = (1 + sin θ)/2 − (cos θ + sin θ)/2 = (1 − cos θ)/2 > 0.
      const free = skyViewFactor(layout, null, 180, false, { facade: false });
      expect(free - f).toBeCloseTo((1 - Math.cos(t * D)) / 2, 4);
      expect(f).toBeLessThan(free);
    }
  });

  it('a floor above reduces it (tilted rows)', () => {
    for (const t of [10, 45, 90]) {
      const layout = panelLayout(cfg(t));
      expect(skyViewFactor(layout, null, 202, true)).toBeLessThan(skyViewFactor(layout, null, 202, false) - 0.001);
    }
    // Vertical rows are coplanar: nothing blocked.
    const v = panelLayout(cfg(0));
    expect(skyViewFactor(v, null, 202, true)).toBe(skyViewFactor(v, null, 202, false));
  });

  it('matches the 2D (infinitely wide row) limit with a floor above', () => {
    // Independent 2D derivation: point v on the lower panel sees profile angles (0, p_max(v)),
    // p_max = min(90°, atan2(H − L·cos θ + v·cos θ, (L − v)·sin θ)) (ray over the upper row's lower edge);
    // F(v) = ½[sin(p_max − θ) + sin θ]; averaged over v by a 20 000-point midpoint rule.
    const H = 2.8;
    const L = 1.134;
    const f2d = (theta: number): number => {
      const t = theta * D;
      const n = 20000;
      let s = 0;
      for (let i = 0; i < n; i++) {
        const v = ((i + 0.5) / n) * L;
        const pb = Math.atan2(H - L * Math.cos(t) + v * Math.cos(t), (L - v) * Math.sin(t));
        const pmax = Math.max(0, Math.min(Math.PI / 2, pb));
        s += 0.5 * (Math.sin(pmax - t) + Math.sin(t));
      }
      return s / n;
    };
    for (const t of [20, 45, 70, 90]) {
      // 100 km wide single module ≈ infinite row.
      const layout = panelLayout(cfg(t, { width: 1e7, count: 1, length: 113.4 }, { floorHeight: 280 }));
      const f = skyViewFactor(layout, null, 180, true);
      expect(Math.abs(f - f2d(t))).toBeLessThan(2e-5);
    }
  });

  it('a horizon reduces it — analytic uniform horizon on a vertical panel', () => {
    // Vertical panel, facade: F(h) = (1/π)∫_{−90°}^{90°}cos φ dφ ∫_h^{90°} cos²a da = (2/π)(π/4 − h/2 − sin 2h / 4).
    const layout = panelLayout(cfg(0));
    for (const h of [10, 7.3, 25.55]) {
      const hr = h * D;
      const exact = (2 / Math.PI) * (Math.PI / 4 - hr / 2 - Math.sin(2 * hr) / 4);
      const f = skyViewFactor(layout, uniformHorizon(h), 202, false);
      expect(Math.abs(f - exact)).toBeLessThan(1e-4);
      expect(f).toBeLessThan(0.5);
    }
  });

  it('uses the facade azimuth to orient the horizon', () => {
    const layout = panelLayout(cfg(45));
    // 30° horizon only at azimuths 330°…30° (north).
    const north = emptyHorizon(1);
    north.elevations.forEach((_, i, e) => {
      if (i <= 30 || i >= 330) e[i] = 30;
    });
    const flat = skyViewFactor(layout, null, 180, true);
    // South facade: the northern horizon is behind the wall → no change.
    expect(skyViewFactor(layout, north, 180, true)).toBeCloseTo(flat, 12);
    // North facade: the obstacle is in front → reduced.
    expect(skyViewFactor(layout, north, 0, true)).toBeLessThan(flat - 0.01);
  });

  it('ignores negative horizons and converges with the grid step', () => {
    const layout = panelLayout(cfg(45));
    expect(skyViewFactor(layout, uniformHorizon(-3), 180, true)).toBeCloseTo(skyViewFactor(layout, null, 180, true), 12);
    const hz = uniformHorizon(12.3);
    const f1 = skyViewFactor(layout, hz, 200, true);
    const f05 = skyViewFactor(layout, hz, 200, true, { gridDeg: 0.5 });
    expect(Math.abs(f1 - f05)).toBeLessThan(1e-3);
  });

  it('grid reuse gives identical values', () => {
    const layout = panelLayout(cfg(30));
    const g = skyViewGrid(layout);
    const hz = uniformHorizon(5);
    expect(skyViewFromGrid(g, hz, 190, true)).toBe(skyViewFactor(layout, hz, 190, true));
    expect(skyViewFromGrid(g, null, 190, false)).toBe(skyViewFactor(layout, null, 190, false));
    expect(() => skyViewGrid(layout, { gridDeg: 0 })).toThrow(RangeError);
  });
});
