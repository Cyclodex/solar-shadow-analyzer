import { beforeEach, describe, expect, it } from 'vitest';
import type { Building, Config, Obstacle } from './types';
import { clearPrismHorizonMemo, prismFloorHorizons } from './buildingHorizon';
import { DEFAULT_CONFIG } from './defaults';
import { enuToLonLat, facadeToEnu } from './enu';
import { floorPlacements } from './geometry';
import { FLOOR_HORIZON_STEP_DEG, obstacleHorizon } from './horizon';
import { sanitizeConfig } from './share';
import { cmToM } from './units';

const anchor = { latitude: 46.958474, longitude: 7.45363 };
const GAMMA = 153.4;

/** Footprint (anchor ENU) of an obstacle-like box in the facade frame of a location at the anchor. */
function boxFootprint(o: Obstacle, gamma = GAMMA): [number, number][] {
  const u0 = o.offsetAlong - o.width / 2;
  const u1 = o.offsetAlong + o.width / 2;
  const n0 = o.distance;
  const n1 = o.distance + o.depth;
  return [
    [u0, n0],
    [u1, n0],
    [u1, n1],
    [u0, n1],
  ].map(([u, n]) => facadeToEnu([u, n], gamma));
}

const obstacle = (over: Partial<Obstacle> = {}): Obstacle => ({
  id: 'o',
  name: '',
  offsetAlong: 3,
  distance: 12,
  width: 20,
  depth: 8,
  height: 14,
  ...over,
});

function config(buildings: Building[], over: Partial<Config['building']> = {}): Config {
  return {
    ...DEFAULT_CONFIG,
    location: { ...DEFAULT_CONFIG.location, ...anchor },
    building: { ...DEFAULT_CONFIG.building, facadeAzimuth: GAMMA, numFloors: 4, lowestFloor: 0, ...over },
    horizon: {
      ...DEFAULT_CONFIG.horizon,
      buildings,
      buildingImport: { ...anchor, radius: 300, date: '2026-09-25' },
    },
  };
}

const building = (id: string, footprint: [number, number][], over: Partial<Building> = {}): Building => ({
  id,
  name: '',
  footprint,
  base: 0,
  height: 14,
  source: 'swisstopo',
  ...over,
});

describe('prismFloorHorizons', () => {
  beforeEach(() => clearPrismHorizonMemo());

  it('equals obstacleHorizon of the same box for every floor (≤ 1e-9°)', () => {
    const o = obstacle();
    const c = config([building('b1', boxFootprint(o))]);
    const placements = floorPlacements(c);
    const res = prismFloorHorizons(c, placements, false)!;
    expect(res).toHaveLength(4);
    placements.forEach((p, k) => {
      const ref = obstacleHorizon([o], p.center, GAMMA, FLOOR_HORIZON_STEP_DEG);
      expect(res[k]!.stepDeg).toBe(ref.stepDeg);
      let worst = 0;
      ref.elevations.forEach((e, i) => (worst = Math.max(worst, Math.abs(e - res[k]!.elevations[i]))));
      expect(worst).toBeLessThan(1e-9);
    });
  });

  it('follows the tilt (observer = panel centre) and the location (world-anchored footprints)', () => {
    const o = obstacle({ distance: 6 });
    const b = building('b1', boxFootprint(o));
    const c0 = config([b]);
    const c90: Config = { ...c0, panels: { ...c0.panels, tiltFromVertical: 90 } };
    const h0 = prismFloorHorizons(c0, floorPlacements(c0), false)!;
    const h90 = prismFloorHorizons(c90, floorPlacements(c90), false)!;
    const straight = Math.round(GAMMA / FLOOR_HORIZON_STEP_DEG);
    // The panel centre moves with the tilt (higher and farther out at 90°): each tilt sees its own horizon.
    expect(h90[0]!.elevations[straight]).not.toBeCloseTo(h0[0]!.elevations[straight], 3);
    for (const [c, h] of [
      [c0, h0],
      [c90, h90],
    ] as const) {
      const ref = obstacleHorizon([o], floorPlacements(c)[0].center, GAMMA, FLOOR_HORIZON_STEP_DEG);
      expect(h[0]!.elevations[straight]).toBeCloseTo(ref.elevations[straight], 9);
    }
    // Moving the location 3 m towards the box (along the facade normal) is the same as a box 3 m closer.
    const [e, n] = facadeToEnu([0, 3], GAMMA);
    const moved: Config = { ...c0, location: { ...c0.location, ...enuToLonLat(anchor, e, n) } };
    const hm = prismFloorHorizons(moved, floorPlacements(moved), false)!;
    const closer = obstacleHorizon(
      [{ ...o, distance: 3 }],
      floorPlacements(c0)[0].center,
      GAMMA,
      FLOOR_HORIZON_STEP_DEG,
    );
    expect(hm[0]!.elevations[straight]).toBeCloseTo(closer.elevations[straight], 4);
  });

  it('applies the rules: removed never, own building never, with the laser scan only manual and edited', () => {
    const near = building('near', boxFootprint(obstacle({ distance: 5, height: 20 })));
    const ownFp = boxFootprint(obstacle({ offsetAlong: 0, distance: -12, width: 20, depth: 12, height: 30 }));
    const own = building('own', ownFp, { height: 30 });
    const c = config([own]);
    expect(prismFloorHorizons(c, floorPlacements(c), false)).toBeNull(); // only the own building
    const removed = config([{ ...near, removed: true }]);
    expect(prismFloorHorizons(removed, floorPlacements(removed), false)).toBeNull();
    const scanned = config([near]);
    expect(prismFloorHorizons(scanned, floorPlacements(scanned), true)).toBeNull(); // in the scan
    expect(prismFloorHorizons(scanned, floorPlacements(scanned), false)).not.toBeNull();
    const edited = config([{ ...near, edited: true }]);
    expect(prismFloorHorizons(edited, floorPlacements(edited), true)).not.toBeNull();
    const manual = config([{ ...near, source: 'manual' }]);
    expect(prismFloorHorizons(manual, floorPlacements(manual), true)).not.toBeNull();
  });

  it('own building: a wing of the same part in front of the facade shades, like a separate part', () => {
    // Facade azimuth 0° (north) at x = 10 on the north wall (y = 0) of an L-shaped part: body y −10…0, a wing
    // x 20…30 reaching 15 m north. The same shape as two parts (body and wing) gave 49.5° at 45° and 57.3° at
    // 70° before, one part nothing (the whole part was «own»).
    const L: [number, number][] = [
      [0, -10],
      [30, -10],
      [30, 15],
      [20, 15],
      [20, 0],
      [0, 0],
    ];
    const at = (e: number, n: number, buildings: Building[], over: Partial<Config['building']> = {}) => {
      clearPrismHorizonMemo();
      const c: Config = {
        ...config(buildings, { facadeAzimuth: 0, ...over }),
        location: { ...DEFAULT_CONFIG.location, ...enuToLonLat(anchor, e, n) },
      };
      return { c, h: prismFloorHorizons(c, floorPlacements(c), false) };
    };
    const one = at(10, 0, [building('b1', L, { height: 20 })]);
    const zone = cmToM(one.c.building.balconyDepth) + 0.5;
    // Reference: the wing in front of the balcony zone as an obstacle box (facade frame u = −e + 10).
    const wing: Obstacle = {
      ...obstacle(),
      offsetAlong: -15,
      width: 10,
      distance: zone,
      depth: 15 - zone,
      height: 20,
    };
    const placements = floorPlacements(one.c);
    placements.forEach((p, k) => {
      const ref = obstacleHorizon([wing], p.center, 0, FLOOR_HORIZON_STEP_DEG);
      let worst = 0;
      ref.elevations.forEach((e, i) => (worst = Math.max(worst, Math.abs(e - one.h![k]!.elevations[i]))));
      expect(worst).toBeLessThan(1e-9);
    });
    // The two-part version agrees except where rays graze the facade (the balcony zone of the wing).
    const main: [number, number][] = [
      [0, -10],
      [30, -10],
      [30, 0],
      [0, 0],
    ];
    const wingPart: [number, number][] = [
      [20, 0],
      [30, 0],
      [30, 15],
      [20, 15],
    ];
    const two = at(10, 0, [building('b1', main, { height: 20 }), building('b2', wingPart, { height: 20 })]);
    for (const az of [45, 70, 80]) {
      const i = Math.round(az / FLOOR_HORIZON_STEP_DEG);
      expect(one.h![0]!.elevations[i]).toBeGreaterThan(40);
      expect(one.h![0]!.elevations[i]).toBeCloseTo(two.h![0]!.elevations[i], 9);
    }
    // Facing south from the south wall (y = −10), nothing of the part is in front: no horizon.
    expect(at(10, -10, [building('b1', L, { height: 20 })], { facadeAzimuth: 180 }).h).toBeNull();
  });

  it('own building: nothing counts while the location is not on its wall (address point inside)', () => {
    const L: [number, number][] = [
      [0, -10],
      [30, -10],
      [30, 15],
      [20, 15],
      [20, 0],
      [0, 0],
    ];
    clearPrismHorizonMemo();
    const c: Config = {
      ...config([building('b1', L, { height: 20 })], { facadeAzimuth: 0 }),
      location: { ...DEFAULT_CONFIG.location, ...enuToLonLat(anchor, 10, -5) },
    };
    expect(prismFloorHorizons(c, floorPlacements(c), false)).toBeNull();
  });

  it('base raises the top (top = base + height); null without an anchor or when nothing rises above', () => {
    const fp = boxFootprint(obstacle({ distance: 10 }));
    const low = config([building('b1', fp, { height: 0.5 })]);
    expect(floorPlacements(low)[0].center.z).toBeGreaterThan(0.5);
    expect(prismFloorHorizons(low, floorPlacements(low), false)).toBeNull(); // below every panel centre
    const lifted = config([building('b1', fp, { height: 1, base: 20 })]);
    const res = prismFloorHorizons(lifted, floorPlacements(lifted), false)!;
    const straight = Math.round(GAMMA / FLOOR_HORIZON_STEP_DEG);
    const z = floorPlacements(lifted)[0].center;
    // The sample at 153.5° is 0.1° off the facade normal: the near face is (10 − n) / cos 0.1° away.
    const t = (10 - z.n) / Math.cos(((straight * FLOOR_HORIZON_STEP_DEG - GAMMA) * Math.PI) / 180);
    expect(res[0]!.elevations[straight]).toBeCloseTo((Math.atan2(21 - z.z, t) * 180) / Math.PI, 9);
    const noAnchor: Config = { ...lifted, horizon: { ...lifted.horizon, buildingImport: null } };
    expect(prismFloorHorizons(noAnchor, floorPlacements(noAnchor), false)).toBeNull();
    expect(prismFloorHorizons(lifted, [], false)).toBeNull();
  });

  it('survives sanitizeConfig (0.1 m grid) within the rounding', () => {
    const o = obstacle();
    const c = sanitizeConfig(config([building('b1', boxFootprint(o))]));
    const res = prismFloorHorizons(c, floorPlacements(c), false)!;
    const ref = obstacleHorizon([o], floorPlacements(c)[1].center, GAMMA, FLOOR_HORIZON_STEP_DEG);
    let worst = 0;
    ref.elevations.forEach((e, i) => (worst = Math.max(worst, Math.abs(e - res[1]!.elevations[i]))));
    expect(worst).toBeLessThan(1); // vertices moved by ≤ 0.07 m at ≥ 10 m
  });

  it('is fast enough for the tilt sweep: 150 buildings, 2000 vertices, 8 floors, 19 tilts', () => {
    const buildings: Building[] = [];
    let seed = 1;
    const rand = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let k = 0; k < 150; k++) {
      const cx = -250 + 500 * rand();
      const cy = -250 + 500 * rand();
      const m = k < 50 ? 14 : 13; // 50 × 14 + 100 × 13 = 2000 vertices
      const r = 5 + 10 * rand();
      const fp = Array.from({ length: m }, (_, j): [number, number] => {
        const a = (2 * Math.PI * j) / m;
        const rr = r * (j % 2 === 0 ? 1 : 0.6);
        return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
      });
      buildings.push(building(`b${k + 1}`, fp, { height: 5 + 30 * rand() }));
    }
    const base = config(buildings, { numFloors: 8 });
    const tilts = Array.from({ length: 19 }, (_, i) => i * 5);
    const run = (): void => {
      for (const tilt of tilts) {
        const c: Config = { ...base, panels: { ...base.panels, tiltFromVertical: tilt } };
        prismFloorHorizons(c, floorPlacements(c), false);
      }
    };
    run(); // warm-up
    const t0 = performance.now();
    run();
    const ms = performance.now() - t0;
    // Measured ≈ 10–20 ms for all 19 tilts (Node, Xeon 2.1 GHz); generous bound for slow CI machines.
    expect(ms).toBeLessThan(500);
  });
});
