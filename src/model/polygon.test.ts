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

  it('drops repeats left next to each other (keyhole ring whose courtyard is simplified away): idempotent', () => {
    // 61-gon (r = 20 m) with a 0.2 m shaft joined by bridgeHoles: 67 vertices, the bridge vertices appear twice.
    const outer = Array.from({ length: 61 }, (_, i): [number, number] => [
      20 * Math.cos((2 * Math.PI * i) / 61),
      20 * Math.sin((2 * Math.PI * i) / 61),
    ]);
    const hole = Array.from({ length: 4 }, (_, i): [number, number] => [
      2 + 0.2 * Math.cos((Math.PI * i) / 2),
      1 + 0.2 * Math.sin((Math.PI * i) / 2),
    ]);
    const ring = bridgeHoles(outer, [hole]);
    expect(ring).toHaveLength(67);
    const once = simplifyRing(ring, 64);
    expect(once.length).toBeLessThanOrEqual(64);
    expect(dropDuplicateVertices(once)).toEqual(once);
    expect(simplifyRing(once, 64)).toEqual(once);
  });

  it('matches the plain O(n²) Visvalingam–Whyatt (smallest triangle first, ties: earliest vertex)', () => {
    const reference = (ring: Ring, max: number): Ring => {
      const out = ring.map((p): [number, number] => [p[0], p[1]]);
      const tri = (k: number): number => {
        const n = out.length;
        const [a, b, c] = [out[(k - 1 + n) % n]!, out[k]!, out[(k + 1) % n]!];
        return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      };
      while (out.length > Math.max(3, max)) {
        let best = 0;
        for (let k = 1; k < out.length; k++) if (tri(k) < tri(best)) best = k;
        out.splice(best, 1);
      }
      return dropDuplicateVertices(out);
    };
    let seed = 7;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let t = 0; t < 200; t++) {
      const n = 5 + Math.floor(rnd() * 120);
      // Whole-metre coordinates: many equal triangle areas (ties) and repeated vertices.
      const ring = Array.from({ length: n }, (_, i): [number, number] => {
        const a = (2 * Math.PI * i) / n;
        const r = 10 + rnd() * 8;
        return [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))];
      });
      const max = 3 + Math.floor(rnd() * (n - 4));
      expect(simplifyRing(ring, max)).toEqual(reference(ring, max));
    }
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
