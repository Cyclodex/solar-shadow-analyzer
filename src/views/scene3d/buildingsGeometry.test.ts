import { describe, expect, it } from 'vitest';
import { enuToLonLat, facadeTransform } from '../../model/enu';
import type { Vertex } from '../../model/polygon';
import type { Building } from '../../model/types';
import { toRad } from '../../model/units';
import {
  blockingPrisms,
  buildingShadowPoints,
  ownBody,
  prismBoxes,
  prismMesh,
  rangeIndex,
  sceneBuildings,
  segmentHitsPrism,
  SHADOW_FIT_BUILDING_HALF,
  type ScenePrism,
} from './buildingsGeometry';

const ANCHOR = { latitude: 46.958474, longitude: 7.45363 };

const rect = (e0: number, n0: number, e1: number, n1: number): [number, number][] => [
  [e0, n0],
  [e1, n0],
  [e1, n1],
  [e0, n1],
];

const b = (id: string, footprint: [number, number][], over: Partial<Building> = {}): Building => ({
  id,
  name: '',
  footprint,
  base: 0,
  height: 15,
  source: 'swisstopo',
  ...over,
});

describe('sceneBuildings', () => {
  const buildings = [
    b('b1', rect(-5, 0, 5, 12), { height: 21 }), // own: north of the location, facade south
    b('b2', rect(-5, -30, 5, -20)),
    b('b3', rect(20, -30, 30, -20), { removed: true }),
    b('b4', rect(-30, -30, -20, -20), { edited: true, base: 2, height: 9 }),
    b('b5', rect(40, 0, 50, 10), { source: 'manual' }),
  ];
  const location = enuToLonLat(ANCHOR, 1, 0); // on the south wall of b1

  it('prisms around the facade origin; removed and own buildings are left out; kinds', () => {
    const s = sceneBuildings(buildings, ANCHOR, location, 180);
    expect(s.prisms.map((p) => [p.id, p.kind, p.base, p.top])).toEqual([
      ['b2', 'imported', 0, 15],
      ['b4', 'edited', 2, 11],
      ['b5', 'manual', 0, 15],
    ]);
    // Relative to the location (1 m east of the anchor).
    expect(s.prisms[0].ring[0][0]).toBeCloseTo(-6, 6);
    expect(s.prisms[0].ring[0][1]).toBeCloseTo(-30, 6);
    // The own building: its real footprint with the facade on n = 0. A south facade's u points east, so
    // seen from the location (1 m east of the anchor) the west corner is at u = −6, the east one at u = 4.
    expect(s.own).not.toBeNull();
    expect(s.own!.u0).toBeCloseTo(-6, 6);
    expect(s.own!.u1).toBeCloseTo(4, 6);
    expect(s.own!.top).toBe(21);
  });

  it('no own body while the location is not on the wall (e.g. the address point inside)', () => {
    const inside = enuToLonLat(ANCHOR, 0, 6);
    const s = sceneBuildings(buildings, ANCHOR, inside, 180);
    expect(s.own).toBeNull();
    expect(s.prisms.map((p) => p.id)).toEqual(['b2', 'b4', 'b5']); // b1 still excluded (own)
    expect(sceneBuildings(buildings, null, location, 180)).toEqual({ prisms: [], own: null });
  });
});

describe('ownBody', () => {
  it('snaps a slightly rotated and shifted wall onto the facade line', () => {
    // Footprint in the facade frame, its wall 0.2° off and 5 cm in front of the origin.
    const a = toRad(0.2);
    const ring: Vertex[] = (
      [
        [-8, 0.05],
        [-8, -10],
        [7, -10],
        [7, 0.05],
      ] as Vertex[]
    ).map(([u, n]) => [u * Math.cos(a) - n * Math.sin(a), u * Math.sin(a) + n * Math.cos(a)]);
    const body = ownBody(ring, 18)!;
    // The wall vertices now lie on n = 0 exactly (to rounding), the back on n ≈ −10.05.
    const wall = body.ring.filter(([, n]) => n > -1);
    expect(wall).toHaveLength(2);
    for (const [, n] of wall) expect(Math.abs(n)).toBeLessThan(1e-9);
    expect(body.u0).toBeCloseTo(-8, 1);
    expect(body.u1).toBeCloseTo(7, 1);
    expect(body.top).toBe(18);
  });

  it('a stepped facade: the stretch around the origin ends where the wall steps back', () => {
    const ring: Vertex[] = [
      [-10, 0],
      [-10, -12],
      [10, -12],
      [10, -3],
      [4, -3],
      [4, 0],
    ];
    const body = ownBody(ring, 12)!;
    expect(body.u0).toBeCloseTo(-10, 9);
    expect(body.u1).toBeCloseTo(4, 9);
  });

  it('null when the wall is too far or too oblique', () => {
    expect(ownBody(rect(-5, -10, 5, -0.5), 10)).toBeNull(); // 0.5 m behind the origin
    const oblique: Vertex[] = [
      [-5, -0.3],
      [5, 0.3],
      [5, -10],
      [-5, -10],
    ]; // 3.4°
    expect(ownBody(oblique, 10)).toBeNull();
  });
});

describe('prismMesh', () => {
  const box: ScenePrism = { id: 'a', kind: 'imported', ring: rect(0, 0, 10, 4), base: 0, top: 6 };
  const raised: ScenePrism = { id: 'b', kind: 'manual', ring: rect(20, 0, 24, 4).reverse(), base: 3, top: 5 };

  it('walls, roof and (raised) bottom with outward flat normals and per-prism ranges', () => {
    const m = prismMesh([box, raised]);
    // Box: 4 walls × 6 + roof 2 × 3 = 30 vertices; raised (clockwise input): 24 + 6 + bottom 6 = 36.
    expect(m.triangles).toEqual([
      { start: 0, count: 30 },
      { start: 30, count: 36 },
    ]);
    expect(m.positions.length).toBe(66 * 3);
    // Every triangle's winding matches its normal (front faces outward) and normals are unit length.
    for (let v = 0; v < 66; v += 3) {
      const p = (k: number): number[] => [...m.positions.slice(3 * (v + k), 3 * (v + k) + 3)];
      const [a, b1, c] = [p(0), p(1), p(2)];
      const e1 = [b1[0] - a[0], b1[1] - a[1], b1[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const nrm = [...m.normals.slice(3 * v, 3 * v + 3)];
      expect(Math.hypot(...nrm)).toBeCloseTo(1, 12);
      expect(cross[0] * nrm[0] + cross[1] * nrm[1] + cross[2] * nrm[2]).toBeGreaterThan(0);
    }
    // three.js coordinates: the box's south wall (n = 0 → Z = 0) faces +Z (south), its roof +Y.
    const south = [...m.normals.slice(0, 3)];
    expect(south[0]).toBeCloseTo(0, 12);
    expect(south[2]).toBeCloseTo(1, 12);
    expect([...m.normals.slice(24 * 3, 24 * 3 + 3)]).toEqual([0, 1, -0]);
    // Heights: the box spans Y 0…6, the raised prism 3…5.
    const ys = (r: { start: number; count: number }): number[] =>
      Array.from({ length: r.count }, (_, k) => m.positions[3 * (r.start + k) + 1]);
    expect(Math.min(...ys(m.triangles[0]))).toBe(0);
    expect(Math.max(...ys(m.triangles[0]))).toBe(6);
    expect(Math.min(...ys(m.triangles[1]))).toBe(3);
    // Outline: roof ring 4 + corners 4 (box); raised also its base ring.
    expect(m.lineRanges[0].count).toBe(16);
    expect(m.lineRanges[1].count).toBe(24);
  });

  it('concave footprints are triangulated inside the ring (area preserved)', () => {
    const l: ScenePrism = {
      id: 'l',
      kind: 'imported',
      ring: [
        [0, 0],
        [10, 0],
        [10, 4],
        [4, 4],
        [4, 10],
        [0, 10],
      ],
      base: 0,
      top: 3,
    };
    const m = prismMesh([l]);
    let area = 0;
    for (let v = 0; v < m.positions.length / 3; v += 3) {
      if (m.normals[3 * v + 1] !== 1) continue;
      const x = (k: number): number => m.positions[3 * (v + k)];
      const z = (k: number): number => m.positions[3 * (v + k) + 2];
      area += Math.abs((x(1) - x(0)) * (z(2) - z(0)) - (x(2) - x(0)) * (z(1) - z(0))) / 2;
    }
    expect(area).toBeCloseTo(10 * 4 + 4 * 6, 9);
  });

  it('rangeIndex lists the vertices of the picked prisms', () => {
    const ranges = [
      { start: 0, count: 3 },
      { start: 3, count: 2 },
      { start: 5, count: 1 },
    ];
    expect([...rangeIndex(ranges, (i) => i !== 1)]).toEqual([0, 1, 2, 5]);
    expect([...rangeIndex(ranges, () => false)]).toEqual([]);
  });
});

describe('view test (fading)', () => {
  const across: ScenePrism = { id: 'x', kind: 'imported', ring: rect(-10, 10, 10, 20), base: 0, top: 15 };
  const low: ScenePrism = { id: 'y', kind: 'imported', ring: rect(-10, 30, 10, 40), base: 0, top: 3 };
  const prisms = [across, low];
  const boxes = prismBoxes(prisms);
  const targets = [
    { x: -1, y: 1, z: 6 },
    { x: 1, y: 1, z: 6 },
  ];

  it('segmentHitsPrism: through the walls within the height range only', () => {
    expect(segmentHitsPrism({ x: 0, y: 40, z: 8 }, { x: 0, y: 0, z: 6 }, across.ring, 0, 15)).toBe(true);
    expect(segmentHitsPrism({ x: 0, y: 40, z: 60 }, { x: 0, y: 0, z: 6 }, across.ring, 0, 15)).toBe(false);
    expect(segmentHitsPrism({ x: 30, y: 15, z: 8 }, { x: 20, y: 15, z: 8 }, across.ring, 0, 15)).toBe(false);
  });

  it('blockingPrisms: the ones between the camera and the rows; none from inside or above', () => {
    expect([...blockingPrisms({ x: 0, y: 50, z: 8 }, targets, prisms, boxes)]).toEqual([0]);
    // High enough to look over both.
    expect([...blockingPrisms({ x: 0, y: 50, z: 60 }, targets, prisms, boxes)]).toEqual([]);
    // From inside the one across the street: it hides nothing (culled from inside).
    expect([...blockingPrisms({ x: 0, y: 15, z: 5 }, targets, prisms, boxes)]).toEqual([]);
    // Low camera behind both: the low one hides the rows too.
    expect([...blockingPrisms({ x: 0, y: 50, z: 1 }, targets, prisms, boxes)].sort()).toEqual([0, 1]);
    expect([...blockingPrisms({ x: 0, y: 50, z: 8 }, [], prisms, boxes)]).toEqual([]);
  });
});

describe('buildingShadowPoints', () => {
  it('depth: every prism top; fit: the near ones, clamped to the square', () => {
    const near: ScenePrism = { id: 'n', kind: 'imported', ring: rect(10, -20, 80, -10), base: 0, top: 12 };
    const far: ScenePrism = { id: 'f', kind: 'imported', ring: rect(200, 0, 210, 10), base: 0, top: 30 };
    const { fit, depth } = buildingShadowPoints([near, far]);
    expect(depth).toHaveLength(8);
    expect(depth).toContainEqual([210, 30, -10]);
    expect(fit).toHaveLength(8);
    const H = SHADOW_FIT_BUILDING_HALF;
    for (const [x, , z] of fit) {
      expect(Math.abs(x)).toBeLessThanOrEqual(H);
      expect(Math.abs(z)).toBeLessThanOrEqual(H);
    }
    expect(fit).toContainEqual([H, 12, 10]);
  });
});

describe('facade frame check', () => {
  it('sceneBuildings and facadeTransform agree on the facade origin', () => {
    const loc = enuToLonLat(ANCHOR, 3, -2);
    const t = facadeTransform(ANCHOR, loc, 90);
    expect(t.origin[0]).toBeCloseTo(3, 6);
    const s = sceneBuildings([b('q', rect(10, -5, 20, 5))], ANCHOR, loc, 90);
    expect(s.prisms[0].ring[0][0]).toBeCloseTo(7, 6);
    expect(s.prisms[0].ring[0][1]).toBeCloseTo(-3, 6);
  });
});
