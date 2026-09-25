import { describe, expect, it } from 'vitest';
import {
  bridgeHoles,
  clipRingToBox,
  dropDuplicateVertices,
  ensureCcw,
  pointInRing,
  ringArea,
  ringBounds,
  ringDistance,
  simplifyRing,
  type Ring,
} from './polygon';

const sq = (x: number, y: number, s: number): Ring => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];

describe('ringArea / ensureCcw', () => {
  it('signed shoelace area: CCW positive, CW negative', () => {
    expect(ringArea(sq(0, 0, 2))).toBe(4);
    expect(ringArea([...sq(0, 0, 2)].reverse())).toBe(-4);
    expect(ringArea([[0, 0]])).toBe(0);
  });

  it('reverses clockwise rings keeping the first vertex; CCW rings are copied', () => {
    const cw: Ring = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    expect(ensureCcw(cw)).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    const ccw = sq(0, 0, 1);
    expect(ensureCcw(ccw)).toEqual(ccw);
    expect(ensureCcw(ccw)).not.toBe(ccw);
  });
});

describe('dropDuplicateVertices', () => {
  it('removes consecutive duplicates and a closing vertex', () => {
    expect(
      dropDuplicateVertices([
        [0, 0],
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ]),
    ).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    expect(
      dropDuplicateVertices(
        [
          [0, 0],
          [0.01, 0],
          [1, 0],
        ],
        0.05,
      ),
    ).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });
});

describe('pointInRing / ringDistance', () => {
  const l: Ring = [
    [0, 0],
    [10, 0],
    [10, 4],
    [4, 4],
    [4, 10],
    [0, 10],
  ];

  it('even-odd containment of a concave (L-shaped) ring', () => {
    expect(pointInRing(l, 2, 2)).toBe(true);
    expect(pointInRing(l, 8, 2)).toBe(true);
    expect(pointInRing(l, 8, 8)).toBe(false);
    expect(pointInRing(l, -1, 2)).toBe(false);
  });

  it('distance to the area: 0 inside, nearest edge outside', () => {
    expect(ringDistance(l, 2, 2)).toBe(0);
    expect(ringDistance(l, 8, 8)).toBeCloseTo(4, 12); // to the edge y = 4 (x ≥ 4) and x = 4 (y ≥ 4)
    expect(ringDistance(l, 13, -4)).toBeCloseTo(5, 12); // corner (10, 0)
  });
});

describe('simplifyRing', () => {
  it('keeps rings that are small enough and removes the least significant vertices first', () => {
    const r: Ring = [
      [0, 0],
      [5, 0.01],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(simplifyRing(r, 5)).toEqual(r);
    expect(simplifyRing(r, 4)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(simplifyRing(r, 1)).toHaveLength(3);
  });
});

describe('bridgeHoles', () => {
  it('joins a courtyard to the outer ring: same area, the courtyard is outside', () => {
    const outer = sq(0, 0, 20);
    const hole = sq(8, 8, 4);
    const ring = bridgeHoles(outer, [hole]);
    expect(ringArea(ring)).toBeCloseTo(400 - 16, 9);
    expect(pointInRing(ring, 10, 10)).toBe(false); // courtyard
    expect(pointInRing(ring, 2, 2)).toBe(true);
    expect(pointInRing(ring, 18, 10)).toBe(true);
    expect(ring).toHaveLength(4 + 4 + 2);
  });
});

describe('clipRingToBox', () => {
  it('clips to the box; intersection points lie exactly on the box edges', () => {
    const tri: Ring = [
      [-5, 0],
      [5, 0],
      [5, 10],
    ];
    const c = clipRingToBox(tri, 0, 0, 10, 10);
    expect(ringArea(c)).toBeCloseTo(50 - 12.5, 9);
    expect(c.some(([x]) => x === 0)).toBe(true);
    expect(clipRingToBox(sq(20, 20, 5), 0, 0, 10, 10)).toEqual([]);
    expect(clipRingToBox(sq(2, 2, 5), 0, 0, 10, 10)).toEqual(sq(2, 2, 5));
  });

  it('two halves clipped at a shared edge add up to the whole', () => {
    const r: Ring = [
      [1, 1],
      [9, 2],
      [7, 9],
      [2, 6],
    ];
    const left = clipRingToBox(r, 0, 0, 5, 10);
    const right = clipRingToBox(r, 5, 0, 10, 10);
    expect(ringArea(left) + ringArea(right)).toBeCloseTo(ringArea(r), 9);
  });

  it('ringBounds', () => {
    expect(ringBounds(sq(1, 2, 3))).toEqual([1, 2, 4, 5]);
  });
});
