import { describe, it, expect } from 'vitest';
import {
  FLOOR_HORIZON_STEP_DEG,
  emptyHorizon,
  floorHorizons,
  horizonAt,
  horizonFromPoints,
  horizonToCsv,
  maxHorizon,
  obstacleHorizon,
  parseHorizonCsv,
} from './horizon';
import { floorPlacements } from './geometry';
import { DEFAULT_CONFIG, createObstacle } from './defaults';
import type { Config, HorizonProfile, Obstacle } from './types';

const D = Math.PI / 180;
const atanDeg = (x: number): number => Math.atan(x) / D;

function box(offsetAlong: number, distance: number, width: number, depth: number, height: number): Obstacle {
  return { id: 'o', name: 'o', offsetAlong, distance, width, depth, height };
}

/** Elevation of a 0.5°-step profile exactly at a grid azimuth. */
const at = (p: HorizonProfile, az: number): number => p.elevations[Math.round(az / p.stepDeg)];

describe('emptyHorizon & horizonAt', () => {
  it('flat profile with 360/step samples', () => {
    expect(emptyHorizon().elevations).toHaveLength(360);
    expect(emptyHorizon(0.5).elevations).toHaveLength(720);
    expect(emptyHorizon(0.5).stepDeg).toBe(0.5);
    expect(emptyHorizon(7).stepDeg).toBeCloseTo(360 / 51, 12); // adjusted so the profile closes
    expect(emptyHorizon().elevations.every((e) => e === 0)).toBe(true);
    expect(() => emptyHorizon(0)).toThrow(RangeError);
  });

  it('interpolates linearly and wraps periodically through north', () => {
    const p: HorizonProfile = { stepDeg: 1, elevations: Array.from({ length: 360 }, (_, i) => i / 10) };
    expect(horizonAt(p, 10)).toBeCloseTo(1, 12);
    expect(horizonAt(p, 10.25)).toBeCloseTo(1.025, 12);
    // Between 359° (35.9) and 360° = 0° (0): halfway → 17.95.
    expect(horizonAt(p, 359.5)).toBeCloseTo(17.95, 12);
    expect(horizonAt(p, -0.5)).toBeCloseTo(17.95, 12);
    expect(horizonAt(p, 720 + 10.25)).toBeCloseTo(1.025, 12);
    expect(horizonAt(p, -1e-15)).toBeCloseTo(0, 9);
    expect(horizonAt({ stepDeg: 1, elevations: [] }, 12)).toBe(0);
  });
});

describe('maxHorizon', () => {
  it('pointwise max, skipping missing profiles; resamples finer inputs', () => {
    const a: HorizonProfile = { stepDeg: 1, elevations: Array.from({ length: 360 }, (_, i) => (i < 180 ? 5 : 0)) };
    const b: HorizonProfile = { stepDeg: 0.5, elevations: Array.from({ length: 720 }, (_, i) => (i % 2 ? 9 : 2)) };
    const m = maxHorizon([a, null, b, undefined], 1);
    expect(m.elevations).toHaveLength(360);
    // At integer azimuths b is at its even samples (2).
    expect(m.elevations[10]).toBe(5);
    expect(m.elevations[200]).toBe(2);
    expect(maxHorizon([null, undefined]).elevations.every((e) => e === 0)).toBe(true);
  });

  it('keeps negative horizons (no implicit 0 floor)', () => {
    const neg: HorizonProfile = { stepDeg: 1, elevations: new Array<number>(360).fill(-2) };
    expect(maxHorizon([neg]).elevations[42]).toBe(-2);
  });
});

describe('horizonFromPoints', () => {
  it('periodic linear interpolation between sorted points', () => {
    const p = horizonFromPoints([
      { azimuth: 270, elevation: 30 },
      { azimuth: 90, elevation: 10 },
    ]);
    expect(horizonAt(p, 90)).toBeCloseTo(10, 12);
    expect(horizonAt(p, 180)).toBeCloseTo(20, 12); // halfway 90 → 270
    expect(horizonAt(p, 270)).toBeCloseTo(30, 12);
    // 270 → 450 (= 90): 0° is halfway → 20; 45° is 3/4 of the way → 30 − 0.75·20 = 15.
    expect(horizonAt(p, 0)).toBeCloseTo(20, 12);
    expect(horizonAt(p, 45)).toBeCloseTo(15, 12);
    expect(horizonAt(p, 315)).toBeCloseTo(25, 12);
  });

  it('single point → constant; none → flat; 0° and 360° duplicates keep the max', () => {
    expect(horizonFromPoints([{ azimuth: 123, elevation: 4 }]).elevations.every((e) => e === 4)).toBe(true);
    expect(horizonFromPoints([]).elevations.every((e) => e === 0)).toBe(true);
    const p = horizonFromPoints([
      { azimuth: 0, elevation: 2 },
      { azimuth: 180, elevation: 0 },
      { azimuth: 360, elevation: 6 },
      { azimuth: Number.NaN, elevation: 50 },
    ]);
    expect(horizonAt(p, 0)).toBeCloseTo(6, 12);
    expect(horizonAt(p, 90)).toBeCloseTo(3, 12);
  });

  it('normalizes negative / >360 azimuths (e.g. −180…180 input)', () => {
    const p = horizonFromPoints([
      { azimuth: -90, elevation: 8 }, // = 270
      { azimuth: 450, elevation: 4 }, // = 90
    ]);
    expect(horizonAt(p, 270)).toBeCloseTo(8, 12);
    expect(horizonAt(p, 90)).toBeCloseTo(4, 12);
    expect(horizonAt(p, 180)).toBeCloseTo(6, 12);
  });
});

describe('obstacleHorizon', () => {
  // South facade: u = east, straight out = azimuth 180.
  const G = 180;
  const obs = { u: 0, n: 2, z: 5 };

  it('obstacle straight in front: atan((h − z)/d) on the near face', () => {
    const p = obstacleHorizon([box(0, 20, 10, 5, 15)], obs, G);
    expect(p.stepDeg).toBe(0.5);
    expect(at(p, 180)).toBeCloseTo(atanDeg(10 / 18), 10);
    // ψ = ±10°: near face (n = 20) reached after 18/cos ψ at u = ∓18·tan 10° = ∓3.17 (inside ±5).
    expect(at(p, 190)).toBeCloseTo(atanDeg((10 * Math.cos(10 * D)) / 18), 10);
    expect(at(p, 170)).toBeCloseTo(atanDeg((10 * Math.cos(10 * D)) / 18), 10);
    // Edge of the near face at ψ = atan(5/18) = 15.52°; at 16° the ray passes beside the box.
    expect(at(p, 196)).toBe(0);
    expect(at(p, 164)).toBe(0);
    // Behind the facade nothing is hit.
    expect(at(p, 0)).toBe(0);
  });

  it('side face of a wall perpendicular to the facade, east of the observer', () => {
    // u ∈ [8, 12], n ∈ [0.5, 20.5]. East (az 90) is +u → face u = 8 at distance 8.
    const p = obstacleHorizon([box(10, 0.5, 4, 20, 15)], obs, G);
    expect(at(p, 90)).toBeCloseTo(atanDeg(10 / 8), 10);
    // az 120 (ψ = −60°): direction (u, n) = (sin 60°, cos 60°), hits u = 8 at n = 2 + 8/tan 60° = 6.62 (inside).
    expect(at(p, 120)).toBeCloseTo(atanDeg((10 * Math.sin(60 * D)) / 8), 10);
    expect(at(p, 270)).toBe(0);
    expect(at(p, 180)).toBe(0);
  });

  it('works for directions behind the facade plane (obstacle between wall and observer)', () => {
    // n ∈ [0.5, 1.5] directly behind an observer at n = 3 → looking north (toward the wall) d = 1.5.
    const p = obstacleHorizon([box(0, 0.5, 2, 1, 10)], { u: 0, n: 3, z: 5 }, G);
    expect(at(p, 0)).toBeCloseTo(atanDeg(5 / 1.5), 10);
    expect(at(p, 180)).toBe(0);
  });

  it('ignores obstacles containing the observer and obstacles lower than the observer', () => {
    expect(obstacleHorizon([box(0, 1, 4, 4, 30)], obs, G).elevations.every((e) => e === 0)).toBe(true);
    expect(obstacleHorizon([box(0, 20, 10, 5, 4)], obs, G).elevations.every((e) => e === 0)).toBe(true);
  });

  it('observer exactly on a face: only directions into the box are blocked (regression)', () => {
    // Box u ∈ [0, 10] (offsetAlong = width/2, both on the UI's 0.5 m grid), n ∈ [0.5, 5.5]; observer (0, 2, 5) lies
    // on its west face u = 0. South facade: u = east. Rays with a westward component (az 180.5…359.5) move to u < 0
    // and never meet the box → 0. Rays with an eastward component start on the face inside the n-range → hit at
    // distance 0 → atan2(15, 0) = 90°. (Before the fix every azimuth returned 90°: tFar = 0 counted as a hit.)
    const p = obstacleHorizon([box(5, 0.5, 10, 5, 20)], obs, G);
    expect(at(p, 90)).toBe(90);
    expect(at(p, 135)).toBe(90);
    expect(at(p, 225)).toBe(0);
    expect(at(p, 270)).toBe(0);
    expect(at(p, 315)).toBe(0);
    for (let az = 180.5; az < 360; az += 0.5) expect(at(p, az)).toBe(0);
    // Observer on the near face n = 2 of a box in front: looking toward the wall (az 0 = −n) is free.
    const q = obstacleHorizon([box(0, 2, 10, 5, 20)], obs, G);
    expect(at(q, 180)).toBe(90);
    expect(at(q, 0)).toBe(0);
    expect(at(q, 45)).toBe(0);
  });

  it('takes the maximum over obstacles and uses the nearest face of each', () => {
    const near = box(0, 10, 10, 5, 8); // atan(3/8) = 20.6°
    const far = box(0, 30, 40, 5, 25); // atan(20/28) = 35.5°
    const p = obstacleHorizon([near, far], obs, G);
    expect(at(p, 180)).toBeCloseTo(atanDeg(20 / 28), 10);
  });

  it('matches an independent ray-vs-edge-segment implementation for random boxes', () => {
    let seed = 7;
    const rnd = (): number => {
      // LCG (Numerical Recipes constants), enough for reproducible test data.
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    /** Nearest hit of the ray o + t·d (t ≥ 0) with the 4 footprint edges, via 2D segment intersection. */
    function nearestEdgeHit(ou: number, on: number, du: number, dn: number, o: Obstacle): number | null {
      const u0 = o.offsetAlong - o.width / 2;
      const u1 = o.offsetAlong + o.width / 2;
      const n0 = o.distance;
      const n1 = o.distance + o.depth;
      const corners: [number, number][] = [
        [u0, n0],
        [u1, n0],
        [u1, n1],
        [u0, n1],
      ];
      let best: number | null = null;
      for (let i = 0; i < 4; i++) {
        const [pu, pn] = corners[i];
        const [qu, qn] = corners[(i + 1) % 4];
        const eu = qu - pu;
        const en = qn - pn;
        const den = du * en - dn * eu; // cross(d, e)
        if (Math.abs(den) < 1e-12) continue;
        const wu = pu - ou;
        const wn = pn - on;
        const t = (wu * en - wn * eu) / den;
        const s = (wu * dn - wn * du) / den;
        if (t >= 0 && s >= 0 && s <= 1 && (best === null || t < best)) best = t;
      }
      return best;
    }
    let hits = 0;
    for (let k = 0; k < 60; k++) {
      const g = rnd() * 360;
      const o = box(rnd() * 60 - 30, 0.5 + rnd() * 40, 0.5 + rnd() * 30, 0.5 + rnd() * 30, 0.5 + rnd() * 40);
      const ob = { u: rnd() * 10 - 5, n: rnd() * 5, z: rnd() * 20 };
      const inside = ob.u > o.offsetAlong - o.width / 2 && ob.u < o.offsetAlong + o.width / 2 && ob.n > o.distance;
      if (inside && ob.n < o.distance + o.depth) continue;
      const p = obstacleHorizon([o], ob, g);
      p.elevations.forEach((e, i) => {
        const rel = (i * p.stepDeg - g) * D;
        const t = nearestEdgeHit(ob.u, ob.n, -Math.sin(rel), Math.cos(rel), o);
        const want = t === null ? 0 : Math.max(0, Math.atan2(o.height - ob.z, t) / D);
        expect(e).toBeCloseTo(want, 9);
        if (want > 0) hits++;
      });
    }
    expect(hits).toBeGreaterThan(1000);
  });

  it('rotates with the facade azimuth', () => {
    const p = obstacleHorizon([box(0, 20, 10, 5, 15)], obs, 250);
    expect(at(p, 250)).toBeCloseTo(atanDeg(10 / 18), 10);
    expect(at(p, 180)).toBe(0);
  });
});

describe('floorHorizons', () => {
  function withHorizon(h: Partial<Config['horizon']>, numFloors = 2): Config {
    const c = structuredClone(DEFAULT_CONFIG);
    Object.assign(c.horizon, h);
    c.building.numFloors = numFloors;
    return c;
  }

  it('obstacle seen from each floor’s panel center (lower floors see a higher horizon)', () => {
    const o = createObstacle('a', 'A'); // offsetAlong 0, distance 20, width 15, depth 10, height 12
    const c = withHorizon({ obstacles: [o], terrainEnabled: false }, 3);
    const hs = floorHorizons(c, null);
    const places = floorPlacements(c);
    expect(hs).toHaveLength(3);
    const az = c.building.facadeAzimuth; // straight out, on the 0.5° grid
    hs.forEach((h, k) => {
      expect(h.stepDeg).toBe(FLOOR_HORIZON_STEP_DEG);
      const { n, z } = places[k].center;
      expect(at(h, az)).toBeCloseTo(Math.max(0, atanDeg((12 - z) / (20 - n))), 10);
    });
    expect(at(hs[0], az)).toBeGreaterThan(at(hs[1], az));
    // Center of floor 0: n = 1.5 + 0.567·sin 45°, z = 3.8 − 0.567·cos 45°.
    const n0 = 1.5 + 0.567 * Math.SQRT1_2;
    const z0 = 3.8 - 0.567 * Math.SQRT1_2;
    expect(at(hs[0], az)).toBeCloseTo(atanDeg((12 - z0) / (20 - n0)), 10);
  });

  it('combines terrain (only if enabled), manual points and obstacles by maximum', () => {
    const terrain: HorizonProfile = { stepDeg: 1, elevations: new Array<number>(360).fill(3) };
    const manual = [
      { azimuth: 0, elevation: 10 },
      { azimuth: 180, elevation: 0 },
    ];
    const on = floorHorizons(withHorizon({ terrainEnabled: true, manual }), terrain);
    expect(horizonAt(on[0], 0)).toBeCloseTo(10, 12);
    expect(horizonAt(on[0], 90)).toBeCloseTo(5, 12);
    expect(horizonAt(on[0], 180)).toBeCloseTo(3, 12); // terrain wins
    const off = floorHorizons(withHorizon({ terrainEnabled: false, manual }), terrain);
    expect(horizonAt(off[1], 180)).toBeCloseTo(0, 12);
    const none = floorHorizons(withHorizon({ terrainEnabled: false }), null);
    expect(none.every((h) => h.elevations.every((e) => e === 0))).toBe(true);
  });
});

describe('CSV', () => {
  it('parses comma, semicolon (decimal comma), tab and whitespace separated lines, skipping headers/comments', () => {
    const text = [
      '﻿azimuth,elevation',
      '# PVGIS-like export',
      '0,1.5',
      '10, 2.25  # trailing comment',
      '20;3,5',
      '30\t4,75',
      '40 5',
      '50;−1,5;extra',
      'nonsense',
      '',
      '60,',
    ].join('\r\n');
    expect(parseHorizonCsv(text)).toEqual([
      { azimuth: 0, elevation: 1.5 },
      { azimuth: 10, elevation: 2.25 },
      { azimuth: 20, elevation: 3.5 },
      { azimuth: 30, elevation: 4.75 },
      { azimuth: 40, elevation: 5 },
      { azimuth: 50, elevation: -1.5 },
    ]);
  });

  it('round-trips a profile through horizonToCsv → parseHorizonCsv → horizonFromPoints', () => {
    const p: HorizonProfile = {
      stepDeg: 1,
      elevations: Array.from({ length: 360 }, (_, i) => 5 + 4 * Math.sin(i * 3 * D)),
    };
    const csv = horizonToCsv(p);
    expect(csv.split('\n')[0]).toBe('azimuth,elevation');
    expect(csv.split('\n')[1]).toBe('0,5');
    const back = horizonFromPoints(parseHorizonCsv(csv));
    back.elevations.forEach((e, i) => expect(Math.abs(e - p.elevations[i])).toBeLessThanOrEqual(0.005 + 1e-12));
  });
});
