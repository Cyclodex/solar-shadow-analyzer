import { describe, expect, it } from 'vitest';
import type { Building, FacadeVector, Obstacle } from './types';
import {
  ADJOINING_DISTANCE,
  CONTEXT_RADIUS,
  FACADE_MIN_LENGTH,
  IMPORT_MAX_BUILDINGS,
  IMPORT_MAX_VERTICES,
  OWN_MAX_DISTANCE,
  PRUNE_HEIGHT_MIN,
  PRUNE_MAX_HEIGHTS,
  STATION_SPACING,
  buildingBearing,
  clipRingAbove,
  edgePoint,
  facadeDirectionAzimuth,
  facadeEdges,
  facadePrisms,
  findOwnBuilding,
  hasImportEdits,
  horizonScores,
  importCandidate,
  localIsoDate,
  manualAnchor,
  planImport,
  prismHorizonTangents,
  prismHorizons,
  projectOntoEdge,
  pruneHeights,
  pruneStations,
  reanchorFootprint,
  rectFootprint,
  ringCentroid,
  ringsDistance,
  tanToDeg,
  type ImportCandidate,
  type Prism,
  type PruneStation,
} from './buildings';
import { enuToLonLat, facadeToEnu, facadeTransform, lonLatToEnu } from './enu';
import { obstacleHorizon } from './horizon';
import { MAX_BUILDING_VERTICES } from './share';
import { bridgeHoles, pointInRing, ringArea, type Vertex } from './polygon';
import { normalizeDeg, toDeg, toRad } from './units';

/** Deterministic pseudo-random numbers (LCG), 0 ≤ x < 1. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const flat = (ring: readonly (readonly [number, number])[]): Float64Array => Float64Array.from(ring.flat());

const boxPrism = (o: Obstacle): Prism => {
  const u0 = o.offsetAlong - o.width / 2;
  const u1 = o.offsetAlong + o.width / 2;
  const n0 = o.distance;
  const n1 = o.distance + o.depth;
  return {
    ring: flat([
      [u0, n0],
      [u1, n0],
      [u1, n1],
      [u0, n1],
    ]),
    top: o.height,
  };
};

/** Nearest hit of a horizontal ray with any edge, per sample: an independent per-azimuth ray cast. */
function rayCastTangents(
  prisms: readonly Prism[],
  obs: { u: number; n: number },
  z: number,
  gamma: number,
  step = 0.5,
) {
  const count = Math.round(360 / step);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const rel = toRad(i * (360 / count) - gamma);
    const du = -Math.sin(rel);
    const dn = Math.cos(rel);
    for (const p of prisms) {
      const r = p.ring;
      const m = r.length / 2;
      let inside = false;
      for (let a = 0, b = m - 1; a < m; b = a++) {
        const [ua, na, ub, nb] = [r[2 * a], r[2 * a + 1], r[2 * b], r[2 * b + 1]];
        if (na > obs.n !== nb > obs.n && obs.u < ((ub - ua) * (obs.n - na)) / (nb - na) + ua)
          inside = !inside;
      }
      if (inside || p.top <= z) continue;
      let tMin = Infinity;
      for (let a = 0, b = m - 1; a < m; b = a++) {
        // Ray o + t·d against segment P + s·(Q − P): solve with Cramer's rule.
        const pu = r[2 * b] - obs.u;
        const pn = r[2 * b + 1] - obs.n;
        const eu = r[2 * a] - r[2 * b];
        const en = r[2 * a + 1] - r[2 * b + 1];
        const det = du * -en - dn * -eu;
        if (Math.abs(det) < 1e-12) continue;
        const t = (pu * -en - pn * -eu) / det;
        const s = (du * pn - dn * pu) / det;
        if (t > 0 && s >= 0 && s <= 1) tMin = Math.min(tMin, t);
      }
      if (tMin < Infinity) out[i] = Math.max(out[i], (p.top - z) / tMin);
    }
  }
  return out;
}

/** Brute force: march along each ray in `dt` steps until the first point inside a footprint. */
function marchDistances(
  prisms: readonly Prism[],
  obs: { u: number; n: number },
  gamma: number,
  maxT: number,
  dt: number,
) {
  const rings = prisms.map((p) =>
    Array.from({ length: p.ring.length / 2 }, (_, k): [number, number] => [p.ring[2 * k], p.ring[2 * k + 1]]),
  );
  const count = 720;
  return Array.from({ length: count }, (_, i) => {
    if (i % 2 === 1) return NaN;
    const rel = toRad(i * 0.5 - gamma);
    const du = -Math.sin(rel);
    const dn = Math.cos(rel);
    let best = Infinity;
    rings.forEach((ring) => {
      if (pointInRing(ring, obs.u, obs.n)) return;
      for (let t = dt; t <= maxT; t += dt) {
        if (pointInRing(ring, obs.u + t * du, obs.n + t * dn)) {
          best = Math.min(best, t);
          break;
        }
      }
    });
    return best;
  });
}

describe('prismHorizonTangents (edge sweep)', () => {
  it('equals obstacleHorizon on boxes (≤ 1e-12°), all floors in one pass', () => {
    const rand = rng(7);
    let worst = 0;
    for (const gamma of [0, 37.3, 90, 202, 311.7]) {
      const boxes: Obstacle[] = Array.from({ length: 25 }, (_, i) => ({
        id: `o${i}`,
        name: '',
        offsetAlong: -150 + 300 * rand(),
        distance: 3 + 200 * rand(),
        width: 2 + 40 * rand(),
        depth: 2 + 30 * rand(),
        height: 2 + 30 * rand(),
      }));
      // Boxes behind the facade as well (the sweep works in every direction, like obstacleHorizon).
      boxes.push({ id: 'back', name: '', offsetAlong: 5, distance: -40, width: 20, depth: 10, height: 25 });
      const observers: FacadeVector[] = [0.6, 3.4, 6.2, 9, 11.8, 20.2].map((z) => ({ u: 0.37, n: 1.93, z }));
      const tans = prismHorizonTangents(
        boxes.map(boxPrism),
        observers[0],
        observers.map((o) => o.z),
        gamma,
      );
      observers.forEach((o, h) => {
        const ref = obstacleHorizon(boxes, o, gamma, 0.5).elevations;
        expect(tans[h]).toHaveLength(ref.length);
        ref.forEach((e, i) => (worst = Math.max(worst, Math.abs(e - tanToDeg(tans[h][i])))));
      });
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('equals an independent per-azimuth ray cast on concave polygons (≤ 1e-9°)', () => {
    const rand = rng(11);
    const prisms: Prism[] = [];
    for (let k = 0; k < 40; k++) {
      // Star-shaped, strongly concave polygons (every other vertex pulled in), 5–9 spikes.
      const spikes = 5 + Math.floor(5 * rand());
      const cu = -120 + 240 * rand();
      const cn = -60 + 180 * rand();
      const R = 4 + 14 * rand();
      const ring: [number, number][] = [];
      for (let j = 0; j < 2 * spikes; j++) {
        const a = (Math.PI * j) / spikes + 0.3 * rand();
        const r = j % 2 === 0 ? R : R * (0.3 + 0.2 * rand());
        ring.push([cu + r * Math.cos(a), cn + r * Math.sin(a)]);
      }
      prisms.push({ ring: flat(ring), top: 3 + 30 * rand() });
    }
    const obs = { u: 1.1, n: 2.3 };
    for (const gamma of [0, 123.4, 250]) {
      const zs = [0.8, 5, 12];
      const tans = prismHorizonTangents(prisms, obs, zs, gamma);
      zs.forEach((z, h) => {
        const ref = rayCastTangents(prisms, obs, z, gamma);
        let worst = 0;
        ref.forEach((tan, i) => (worst = Math.max(worst, Math.abs(tanToDeg(tan) - tanToDeg(tans[h][i])))));
        expect(worst).toBeLessThan(1e-9);
      });
    }
  });

  it(
    'matches a brute-force march on a U-shaped building and a courtyard (keyhole ring)',
    { timeout: 30000 },
    () => {
      // U open towards the facade, observer inside the notch: rays hit the inner walls first.
      const u: [number, number][] = [
        [-15, 5],
        [-9, 5],
        [-9, 20],
        [9, 20],
        [9, 5],
        [15, 5],
        [15, 30],
        [-15, 30],
      ];
      // Courtyard building beside the observer: outer 30 × 30 m, hole 14 × 12 m (keyhole ring).
      const court: [number, number][] = [
        [20, -20],
        [50, -20],
        [50, 10],
        [20, 10],
        [20, -20],
        [28, -14],
        [28, -2],
        [42, -2],
        [42, -14],
        [28, -14],
      ];
      const prisms: Prism[] = [
        { ring: flat(u), top: 14 },
        { ring: flat(court), top: 20 },
      ];
      const obs = { u: 0.2, n: 7.3 };
      const z = 2;
      const dt = 0.01;
      let compared = 0;
      const combined = prismHorizonTangents(prisms, obs, [z], 180)[0];
      const single = prisms.map((p) => prismHorizonTangents([p], obs, [z], 180)[0]);
      prisms.forEach((p, k) => {
        const march = marchDistances([p], obs, 180, 60, dt);
        march.forEach((t, i) => {
          if (i % 2 === 1) return; // every 1° (runtime)
          const tan = single[k][i];
          if (!Number.isFinite(t)) {
            expect(tan).toBe(0);
            return;
          }
          // The first inside point of the march lies at most one step behind the exact crossing.
          const exact = (p.top - z) / tan;
          expect(exact).toBeLessThanOrEqual(t + 1e-9);
          expect(t - exact).toBeLessThanOrEqual(dt + 1e-9);
          compared++;
        });
      });
      expect(compared).toBeGreaterThan(150);
      combined.forEach((tan, i) => expect(tan).toBe(Math.max(single[0][i], single[1][i])));
    },
  );

  it('observer in a courtyard: the courtyard walls set the horizon (keyhole ring, point outside)', () => {
    // Outer 30 × 30 m, courtyard 10 × 10 m centred at (0, 20); observer in the courtyard centre.
    const ring: [number, number][] = [
      [-15, 5],
      [15, 5],
      [15, 35],
      [-15, 35],
      [-15, 5],
      [-5, 15],
      [-5, 25],
      [5, 25],
      [5, 15],
      [-5, 15],
    ];
    expect(pointInRing(ring, 0, 20)).toBe(false);
    const [tan] = prismHorizonTangents([{ ring: flat(ring), top: 12 }], { u: 0, n: 20 }, [2], 0);
    // Straight along +n (azimuth = γ = 0): wall at 5 m → atan(10 / 5).
    expect(tanToDeg(tan[0])).toBeCloseTo(toDeg(Math.atan2(10, 5)), 10);
    // Diagonal to a courtyard corner: 5·√2 m.
    expect(tanToDeg(tan[90])).toBeCloseTo(toDeg(Math.atan2(10, 5 * Math.SQRT2)), 10);
  });

  it('ignores prisms containing the observer and prisms not above it; handles either orientation', () => {
    const box: [number, number][] = [
      [-5, 10],
      [5, 10],
      [5, 20],
      [-5, 20],
    ];
    const ccw = prismHorizonTangents([{ ring: flat(box), top: 10 }], { u: 0, n: 0 }, [2], 0)[0];
    const cw = prismHorizonTangents([{ ring: flat([...box].reverse()), top: 10 }], { u: 0, n: 0 }, [2], 0)[0];
    expect(Array.from(cw)).toEqual(Array.from(ccw));
    expect(tanToDeg(ccw[0])).toBeCloseTo(toDeg(Math.atan2(8, 10)), 12);
    expect(
      Math.max(...prismHorizonTangents([{ ring: flat(box), top: 10 }], { u: 0, n: 15 }, [2], 0)[0]),
    ).toBe(0);
    expect(Math.max(...prismHorizonTangents([{ ring: flat(box), top: 2 }], { u: 0, n: 0 }, [2], 0)[0])).toBe(
      0,
    );
    expect(prismHorizonTangents([], { u: 0, n: 0 }, [], 0)).toEqual([]);
  });

  it('tracks the prism that sets each sample: keeping only those leaves the horizon unchanged', () => {
    const rand = rng(3);
    const prisms: Prism[] = Array.from({ length: 120 }, () => {
      const cu = -150 + 300 * rand();
      const cn = 3 + 200 * rand();
      const w = 3 + 20 * rand();
      const d = 3 + 20 * rand();
      return {
        ring: flat([
          [cu, cn],
          [cu + w, cn],
          [cu + w, cn + d],
          [cu, cn + d],
        ]),
        top: 3 + 25 * rand(),
      };
    });
    const zs = [1, 6, 15];
    const owners = zs.map(() => new Int32Array(720));
    const all = prismHorizonTangents(prisms, { u: 0, n: 2 }, zs, 202, { owners });
    const keep = new Set<number>();
    owners.forEach((row) => row.forEach((o) => o >= 0 && keep.add(o)));
    expect(keep.size).toBeGreaterThan(5);
    expect(keep.size).toBeLessThan(prisms.length);
    const kept = [...keep].map((i) => prisms[i]);
    const again = prismHorizonTangents(kept, { u: 0, n: 2 }, zs, 202);
    zs.forEach((_, h) => expect(Array.from(again[h])).toEqual(Array.from(all[h])));
    // Every sample without an owner is flat.
    owners.forEach((row, h) => row.forEach((o, i) => o < 0 && expect(all[h][i]).toBe(0)));
  });

  it('prismHorizons gives profiles in degrees with the effective step', () => {
    const p = prismHorizons(
      [boxPrism({ id: 'a', name: '', offsetAlong: 0, distance: 10, width: 10, depth: 10, height: 12 })],
      { u: 0, n: 0 },
      [2],
      0,
      1,
    );
    expect(p[0].stepDeg).toBe(1);
    expect(p[0].elevations).toHaveLength(360);
    expect(p[0].elevations[0]).toBeCloseTo(45, 12);
    expect(p[0].elevations[180]).toBe(0);
  });

  it('facadeDirectionAzimuth inverts the sample directions', () => {
    for (const gamma of [0, 45, 202]) {
      for (const az of [0, 10, 90, 181, 359.5]) {
        const rel = toRad(az - gamma);
        expect(facadeDirectionAzimuth(-Math.sin(rel), Math.cos(rel), gamma)).toBeCloseTo(az, 9);
      }
    }
  });
});

describe('clipRingAbove', () => {
  const area = (rings: Vertex[][]): number => rings.reduce((a, r) => a + ringArea(r), 0);
  const inside = (rings: Vertex[][], x: number, y: number): boolean =>
    rings.filter((r) => pointInRing(r, x, y)).length % 2 === 1;

  it('square: the part above the line, counter-clockwise; all above or all below', () => {
    const sq: Vertex[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const [piece, ...rest] = clipRingAbove(sq, 4);
    expect(rest).toHaveLength(0);
    expect(ringArea(piece)).toBeCloseTo(60, 12);
    expect(clipRingAbove([...sq].reverse(), 4).map(ringArea)).toEqual([60]); // clockwise input
    expect(clipRingAbove(sq, -1).map(ringArea)).toEqual([100]);
    expect(clipRingAbove(sq, 10)).toEqual([]); // vertices on the line count as below
    expect(clipRingAbove(sq, 12)).toEqual([]);
  });

  it('a U falls apart into separate pieces (no wall across the gap)', () => {
    // U open to the north: legs x 0…3 and 7…10 up to y = 10, base y 0…2.
    const u: Vertex[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [7, 10],
      [7, 2],
      [3, 2],
      [3, 10],
      [0, 10],
    ];
    const pieces = clipRingAbove(u, 5);
    expect(pieces).toHaveLength(2);
    expect(pieces.map(ringArea).sort()).toEqual([15, 15]);
    expect(inside(pieces, 5, 7)).toBe(false); // the gap stays open
    expect(inside(pieces, 1, 7)).toBe(true);
    expect(inside(pieces, 9, 7)).toBe(true);
  });

  it('keyhole ring: a line through the bridge or the courtyard', () => {
    const outer: Vertex[] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ];
    const hole: Vertex[] = [
      [6, 6],
      [6, 14],
      [14, 14],
      [14, 6],
    ];
    const keyhole = bridgeHoles(outer, [hole]);
    for (const c of [3, 10, 17]) {
      const pieces = clipRingAbove(keyhole, c);
      // Area above the line: outer part minus the courtyard part.
      const expected = 20 * (20 - c) - 8 * Math.max(0, Math.min(14, 20) - Math.max(6, c));
      expect(area(pieces)).toBeCloseTo(expected, 9);
      expect(inside(pieces, 10, (Math.max(c, 6) + 14) / 2)).toBe(false); // the courtyard
      expect(inside(pieces, 2, (c + 20) / 2)).toBe(true);
    }
  });

  it('random star polygons: pieces cover exactly the part above the line (area and point samples)', () => {
    const rand = rng(11);
    for (let k = 0; k < 60; k++) {
      const m = 5 + Math.floor(rand() * 20);
      const ring: Vertex[] = Array.from({ length: m }, (_, j) => {
        const a = (2 * Math.PI * j) / m;
        const r = 3 + 10 * rand();
        return [r * Math.cos(a), r * Math.sin(a)];
      });
      const c = -8 + 16 * rand();
      const pieces = clipRingAbove(ring, c);
      const mirrored = ring.map(([x, y]): Vertex => [x, -y]);
      const below = clipRingAbove(mirrored, -c); // the part below the line, mirrored
      expect(area(pieces) + area(below)).toBeCloseTo(Math.abs(ringArea(ring)), 9);
      for (const p of pieces) {
        expect(ringArea(p)).toBeGreaterThan(0);
        // Every stretch along the line lies inside the ring (no wall across a gap between pieces).
        p.forEach((a, i) => {
          const b = p[(i + 1) % p.length];
          if (a[1] !== c || b[1] !== c) return;
          expect(pointInRing(ring, (a[0] + b[0]) / 2, c + 1e-7)).toBe(true);
        });
      }
      for (let s = 0; s < 200; s++) {
        const x = -14 + 28 * rand();
        const y = -14 + 28 * rand();
        expect(inside(pieces, x, y)).toBe(y > c && pointInRing(ring, x, y));
      }
    }
  });
});

describe('frame conversions', () => {
  const anchor = { latitude: 46.947849, longitude: 7.449978 };
  const location = enuToLonLat(anchor, 12.3, -4.5);

  it('facadePrisms puts the footprint into the facade frame with top = base + height', () => {
    const t = facadeTransform(anchor, location, 153.4);
    const fp: [number, number][] = [
      [20, 0],
      [30, 0],
      [30, 10],
    ];
    const [p] = facadePrisms(
      [{ id: 'b1', name: '', footprint: fp, base: 2.5, height: 10, source: 'manual' }],
      t,
    );
    expect(p.top).toBe(12.5);
    const back = t.toAnchor([p.ring[2], p.ring[3]]);
    expect(back[0]).toBeCloseTo(30, 9);
    expect(back[1]).toBeCloseTo(0, 9);
  });

  it('rectFootprint: rectangle in front of the facade, 0.1 m grid, CCW; rotation clockwise from above', () => {
    const gamma = 0; // facade faces north: u points west, n north
    const t = facadeTransform(anchor, anchor, gamma);
    const fp = rectFootprint({ width: 10, depth: 4, distance: 6, offset: 3, rotation: 0 }, t)!;
    expect(ringArea(fp)).toBeCloseTo(40, 6);
    // u = 3 (west) → east −3; n from 6 to 10 (north).
    const xs = fp.map((p) => p[0]).sort((a, b) => a - b);
    const ys = fp.map((p) => p[1]).sort((a, b) => a - b);
    expect([xs[0], xs[3], ys[0], ys[3]]).toEqual([-8, 2, 6, 10]);
    // Rotated by 30° clockwise: the width axis (u, west = 270°) now points to 300°.
    const rot = rectFootprint({ width: 10, depth: 4, distance: 6, offset: 0, rotation: 30 }, t)!;
    const edges = rot.map((p, i) => {
      const q = rot[(i + 1) % rot.length];
      return {
        len: Math.hypot(q[0] - p[0], q[1] - p[1]),
        az: normalizeDeg(toDeg(Math.atan2(q[0] - p[0], q[1] - p[1]))),
      };
    });
    const long = edges.filter((e) => Math.abs(e.len - 10) < 0.2).map((e) => e.az % 180);
    expect(long).toHaveLength(2);
    for (const az of long) expect(az).toBeCloseTo(300 % 180, 0);
    expect(ringArea(rot)).toBeGreaterThan(0);
    for (const [e, n] of rot) {
      expect(Math.round(e * 10) / 10).toBe(e);
      expect(Math.round(n * 10) / 10).toBe(n);
    }
  });

  it('rectFootprint follows the facade azimuth and location', () => {
    const t = facadeTransform(anchor, location, 202);
    const fp = rectFootprint({ width: 2, depth: 2, distance: 9, offset: 0, rotation: 0 }, t)!;
    const [cu, cn] = t.toFacade(ringCentroid(fp));
    expect(cu).toBeCloseTo(0, 1);
    expect(cn).toBeCloseTo(10, 1);
  });

  it('rectFootprint: null instead of a collapsed ring more than 2 km from the anchor', () => {
    const rect = { width: 15, depth: 10, distance: 20, offset: 0, rotation: 0 };
    // The location 94 km away (Zürich, anchor in Bern): clamping made it one vertex [2000, 2000] before.
    const zurich = { latitude: 47.3769, longitude: 8.5417 };
    expect(rectFootprint(rect, facadeTransform(anchor, zurich, 180))).toBeNull();
    // Reaching over the limit by a few metres: null as well; inside it: a full rectangle.
    const edge = enuToLonLat(anchor, 1990, 0);
    expect(rectFootprint(rect, facadeTransform(anchor, edge, 90))).toBeNull();
    expect(rectFootprint(rect, facadeTransform(anchor, edge, 270))).toHaveLength(4);
  });

  it('reanchorFootprint keeps the world position; null beyond ±2000 m', () => {
    const other = enuToLonLat(anchor, 150, -80);
    const fp: [number, number][] = [
      [10, 10],
      [20, 10],
      [20, 25],
    ];
    const moved = reanchorFootprint(fp, anchor, other)!;
    moved.forEach((p, i) => {
      const g = enuToLonLat(other, p[0], p[1]);
      const back = lonLatToEnu(anchor, g.latitude, g.longitude);
      expect(back[0]).toBeCloseTo(fp[i][0], 1);
      expect(back[1]).toBeCloseTo(fp[i][1], 1);
    });
    expect(moved[0][0]).toBeCloseTo(-140, 1);
    expect(reanchorFootprint(fp, anchor, enuToLonLat(anchor, 2500, 0))).toBeNull();
  });

  it('buildingBearing: distance and direction of the nearest point (centroid when inside)', () => {
    const sq: [number, number][] = [
      [10, -5],
      [20, -5],
      [20, 5],
      [10, 5],
    ];
    const b = buildingBearing(sq, [0, 0]);
    expect(b.distance).toBeCloseTo(10, 12);
    expect(b.azimuth).toBeCloseTo(90, 12);
    const inside = buildingBearing(sq, [12, 0]);
    expect(inside.distance).toBe(0);
    expect(inside.azimuth).toBeCloseTo(90, 9);
    expect(buildingBearing(sq, [15, 20]).azimuth).toBeCloseTo(180, 9);
  });

  it('manualAnchor keeps an import anchor, else the location (1e-6°, radius 0)', () => {
    const imp = { latitude: 46.9, longitude: 7.4, radius: 300, date: '2026-09-25' };
    expect(manualAnchor(imp, anchor)).toBe(imp);
    expect(manualAnchor(null, { latitude: 46.12345678, longitude: 7.87654321 })).toEqual({
      latitude: 46.123457,
      longitude: 7.876543,
      radius: 0,
      date: '',
    });
  });
});

describe('facadeEdges', () => {
  const sq: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ];

  it('outward true-north azimuth and length of each edge (either orientation)', () => {
    const edges = facadeEdges(sq);
    expect(edges.map((e) => [e.azimuth, e.length])).toEqual([
      [180, 10],
      [90, 8],
      [0, 10],
      [270, 8],
    ]);
    expect(edges.every((e) => e.selectable && !e.party && !e.interior)).toBe(true);
    const cw = facadeEdges([...sq].reverse());
    expect(cw.map((e) => e.azimuth).sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
    // A rotated rectangle: outward normal of the south-east side at 153.4°.
    const g = toRad(153.4);
    const n: Vertex = [Math.sin(g), Math.cos(g)];
    const u: Vertex = [-Math.cos(g), Math.sin(g)];
    const rot = [
      [0, 0],
      [12, 0],
      [12, -9],
      [0, -9],
    ].map(([a, b]): [number, number] => [a * u[0] + b * n[0], a * u[1] + b * n[1]]);
    expect(facadeEdges(rot).some((e) => Math.abs(e.azimuth - 153.4) < 1e-9)).toBe(true);
  });

  it('party walls: edges adjoining another part are not selectable; short edges neither', () => {
    const left: [number, number][] = [
      [-10, 0],
      [0, 0],
      [0, 8],
      [-10, 8],
    ];
    const right: [number, number][] = [
      [10.2, -1],
      [20, -1],
      [20, 9],
      [10.2, 9],
    ];
    const edges = facadeEdges(sq, [left, right]);
    const byAz = new Map(edges.map((e) => [e.azimuth, e]));
    expect(byAz.get(90)!.party).toBe(true); // 0.2 m gap to the right part
    expect(byAz.get(270)!.party).toBe(true);
    expect(byAz.get(90)!.shared).toBe(1);
    expect(byAz.get(0)!.selectable).toBe(true);
    expect(byAz.get(180)!.selectable).toBe(true);
    const tiny = facadeEdges([
      [0, 0],
      [FACADE_MIN_LENGTH - 0.5, 0],
      [FACADE_MIN_LENGTH - 0.5, 10],
      [0, 10],
    ]);
    expect(tiny.filter((e) => e.length < FACADE_MIN_LENGTH).every((e) => !e.selectable)).toBe(true);
    // A neighbour along half of the edge: shared 0.5 → party (≥ PARTY_WALL_SHARE).
    const half = facadeEdges(sq, [
      [
        [0, 8],
        [5, 8],
        [5, 20],
        [0, 20],
      ],
    ]);
    expect(half.find((e) => e.azimuth === 0)!.shared).toBeCloseTo(0.5, 9);
  });

  it('keyhole ring: courtyard edges face into the courtyard, bridges are interior', () => {
    const ring: [number, number][] = [
      [0, 0],
      [30, 0],
      [30, 30],
      [0, 30],
      [0, 0],
      [10, 10],
      [10, 20],
      [20, 20],
      [20, 10],
      [10, 10],
    ];
    const edges = facadeEdges(ring);
    const bridges = edges.filter((e) => Math.abs(e.length - Math.hypot(10, 10)) < 1e-9);
    expect(bridges).toHaveLength(2);
    expect(bridges.every((e) => e.interior && !e.selectable)).toBe(true);
    const court = edges.filter((e) => e.length === 10);
    expect(court.map((e) => e.azimuth).sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
    // The courtyard's north wall (y = 20) faces south, into the courtyard.
    const north = court.find((e) => e.a[1] === 20 && e.b[1] === 20)!;
    expect(north.azimuth).toBe(180);
    expect(court.every((e) => e.selectable)).toBe(true);
  });

  it('edgePoint / projectOntoEdge', () => {
    const e = { a: [0, 0] as Vertex, b: [10, 0] as Vertex };
    expect(edgePoint(e, 0.25)).toEqual([2.5, 0]);
    expect(edgePoint(e, 2)).toEqual([10, 0]);
    expect(projectOntoEdge(e, [4, 3])).toEqual({ t: 0.4, distance: 3 });
  });
});

describe('import: candidates, own building, stations, heights', () => {
  it('importCandidate: courtyards bridged, 0.1 m grid, CCW, ≤ MAX_BUILDING_VERTICES, height above base', () => {
    const c = importCandidate({
      footprint: [
        [0.04, 0],
        [30.06, 0],
        [30, 30],
        [0, 30],
      ],
      holes: [
        [
          [10, 10],
          [10, 20],
          [20, 20],
          [20, 10],
        ],
      ],
      height: 21,
      minHeight: 3,
    })!;
    expect(c.base).toBe(3);
    expect(c.height).toBe(18);
    expect(ringArea(c.footprint)).toBeCloseTo(30.05 * 30 - 100, 0);
    expect(pointInRing(c.footprint, 15, 15)).toBe(false);
    expect(c.footprint[0]).toEqual([0, 0]);
    const many = Array.from({ length: 200 }, (_, i): [number, number] => [
      20 * Math.cos((2 * Math.PI * i) / 200),
      20 * Math.sin((2 * Math.PI * i) / 200),
    ]);
    expect(
      importCandidate({ footprint: many, height: 10, minHeight: 0 })!.footprint.length,
    ).toBeLessThanOrEqual(MAX_BUILDING_VERTICES);
    expect(
      importCandidate({
        footprint: [
          [0, 0],
          [0.5, 0],
          [0.5, 0.5],
        ],
        height: 10,
        minHeight: 0,
      }),
    ).toBeNull();
  });

  it('findOwnBuilding: probe first, then containing the point, then nearest within OWN_MAX_DISTANCE', () => {
    const a: [number, number][] = [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ];
    const b: [number, number][] = [
      [10, -5],
      [20, -5],
      [20, 5],
      [10, 5],
    ];
    expect(findOwnBuilding([a, b], [0, 0])).toBe(0);
    expect(findOwnBuilding([a, b], [0, 0], [15, 0])).toBe(1);
    expect(findOwnBuilding([a, b], [7, 0])).toBe(0); // 2 m from a, 3 m from b
    expect(findOwnBuilding([a, b], [0, 5 + OWN_MAX_DISTANCE + 1])).toBe(-1);
  });

  it('pruneStations: every selectable facade, ≤ STATION_SPACING apart from end to end, plus extras', () => {
    const own: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 1],
      [0, 1],
    ];
    const extra: PruneStation = { origin: [1, 2], facadeAzimuth: 17 };
    const st = pruneStations(own, [], [extra]);
    expect(st[0]).toBe(extra);
    const south = st.filter((s) => s.facadeAzimuth === 180);
    expect(south.length).toBe(Math.ceil(20 / STATION_SPACING) + 1);
    const xs = south.map((s) => s.origin[0]).sort((p, q) => p - q);
    expect(xs[0]).toBe(0);
    expect(xs.at(-1)).toBe(20);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(STATION_SPACING + 1e-9);
    // The 1 m short sides are facades too (≥ FACADE_MIN_LENGTH? no: 1 m < 2 m) → none there.
    expect(st.filter((s) => s.facadeAzimuth === 90)).toHaveLength(0);
    expect(pruneStations(null, [], [extra])).toEqual([extra]);
  });

  it('pruneHeights: grid from PRUNE_HEIGHT_MIN, the top itself, required heights, at most PRUNE_MAX_HEIGHTS', () => {
    expect(pruneHeights(10)).toEqual([PRUNE_HEIGHT_MIN, 3.5, 6.5, 9.5, 10]);
    expect(pruneHeights(10, [4.2])).toEqual([PRUNE_HEIGHT_MIN, 3.5, 4.2, 6.5, 9.5, 10]);
    const tall = pruneHeights(120, [7]);
    expect(tall.length).toBeLessThanOrEqual(PRUNE_MAX_HEIGHTS);
    expect(tall[0]).toBe(PRUNE_HEIGHT_MIN);
    expect(tall.at(-1)).toBe(120);
    expect(tall).toContain(7);
  });
});

describe('horizonScores and planImport', () => {
  /** A street scene: own building on the south side, a row of buildings across the street, some far away. */
  function scene(seed: number) {
    const rand = rng(seed);
    const cands: ImportCandidate[] = [];
    const rect = (x0: number, y0: number, w: number, d: number, h: number): void => {
      cands.push({
        footprint: [
          [x0, y0],
          [x0 + w, y0],
          [x0 + w, y0 + d],
          [x0, y0 + d],
        ],
        base: 0,
        height: h,
      });
    };
    rect(-6, -12, 12, 12, 18); // 0: own, north facade on y = 0
    rect(-18, -12, 12, 12, 16); // 1: adjoining west
    rect(6, -12, 12, 12, 20); // 2: adjoining east
    for (let k = 0; k < 12; k++) rect(-60 + 10 * k, 15, 9, 10, 8 + 14 * rand()); // across the street
    for (let k = 0; k < 40; k++) {
      const a = 2 * Math.PI * rand();
      const r = 70 + 200 * rand();
      rect(r * Math.sin(a), r * Math.cos(a), 6 + 10 * rand(), 6 + 10 * rand(), 5 + 30 * rand());
    }
    rect(-6, -40, 12, 10, 25); // behind the own building (south)
    return cands;
  }

  it('keeps every building that sets a horizon: the pruned set reproduces it at the stations', async () => {
    const cands = scene(5);
    const fps = cands.map((c) => c.footprint);
    const tops = cands.map((c) => c.base + c.height);
    const own = findOwnBuilding(fps, [0, -0.5]);
    expect(own).toBe(0);
    const stations = pruneStations(
      fps[own],
      fps.filter((_, i) => i !== own),
    );
    // Street (north) and back (south) facades; the side walls adjoin the neighbours.
    expect([...new Set(stations.map((s) => s.facadeAzimuth))].sort((a, b) => a - b)).toEqual([0, 180]);
    const heights = [0.5, 3.5, 6.5, 9.5, 12.5, 15.5, 18];
    const offsets = [1.5, 2.07];
    let pauses = 0;
    const scores = await horizonScores(fps, tops, stations, heights, offsets, {
      exclude: [own],
      pause: async () => void pauses++,
    });
    expect(pauses).toBe(stations.length);
    expect(scores[own]).toBe(0);
    // The building behind the own one sets the horizon of the back (south) facade, 18 m away and 25 m high.
    expect(scores[scores.length - 1]).toBeGreaterThan(45);
    const setters = [...scores.keys()].filter((i) => scores[i] > 0);
    expect(setters.length).toBeGreaterThan(5);
    for (const st of stations) {
      const t = {
        toFacade: (p: readonly [number, number]): [number, number] => {
          const g = toRad(st.facadeAzimuth);
          const dx = p[0] - st.origin[0];
          const dy = p[1] - st.origin[1];
          return [-dx * Math.cos(g) + dy * Math.sin(g), dx * Math.sin(g) + dy * Math.cos(g)];
        },
      };
      const prism = (i: number): Prism => ({ ring: flat(fps[i].map((p) => t.toFacade(p))), top: tops[i] });
      const others = fps.map((_, i) => i).filter((i) => i !== own);
      for (const n of offsets) {
        const all = prismHorizonTangents(others.map(prism), { u: 0, n }, heights, st.facadeAzimuth);
        const kept = prismHorizonTangents(setters.map(prism), { u: 0, n }, heights, st.facadeAzimuth);
        for (let h = 0; h < heights.length; h++) {
          for (let i = 0; i < 720; i++) {
            const front = Math.cos(toRad(i * 0.5 - st.facadeAzimuth)) > 1e-9;
            if (front) expect(kept[h][i]).toBe(all[h][i]);
          }
        }
      }
    }
  });

  it('planImport: own, adjoining, horizon setters by score, context by distance, within the caps', () => {
    const cands = scene(9);
    const scores = new Float64Array(cands.length);
    scores[5] = 30;
    scores[7] = 10;
    scores[20] = 2;
    const plan = planImport({ candidates: cands, scores, own: 0, site: [0, 0] });
    expect(plan.kept.slice(0, 3).map((k) => [k.index, k.reason])).toEqual([
      [0, 'own'],
      [1, 'adjoining'],
      [2, 'adjoining'],
    ]);
    expect(plan.kept.slice(3, 6).map((k) => k.index)).toEqual([5, 7, 20]);
    expect(plan.kept.slice(3, 6).every((k) => k.reason === 'horizon')).toBe(true);
    const context = plan.kept.filter((k) => k.reason === 'context');
    expect(context.length).toBeGreaterThan(0);
    const dist = (i: number): number =>
      ringsDistance(cands[i].footprint, [
        [0, 0],
        [0, 0],
        [0, 0],
      ]);
    for (const k of context) expect(dist(k.index)).toBeLessThanOrEqual(CONTEXT_RADIUS + 1e-9);
    for (let i = 1; i < context.length; i++)
      expect(dist(context[i].index)).toBeGreaterThanOrEqual(dist(context[i - 1].index) - 1e-9);
    expect(plan.horizonSetters).toBe(3);
    expect(plan.droppedSetters).toBe(0);
    expect(plan.vertices).toBe(plan.kept.length * 4);
    expect(IMPORT_MAX_BUILDINGS).toBeLessThanOrEqual(150);
    expect(IMPORT_MAX_VERTICES).toBeLessThanOrEqual(2000);
    expect(ADJOINING_DISTANCE).toBeGreaterThan(0);
  });

  it('planImport: the caps drop the lowest setters first and report the largest dropped score', () => {
    const cands = scene(2);
    const scores = new Float64Array(cands.length);
    for (let i = 3; i < 15; i++) scores[i] = i; // 12 setters, scores 3 … 14
    const plan = planImport({
      candidates: cands,
      scores,
      own: 0,
      site: [0, 0],
      maxBuildings: 8,
      contextRadius: 0,
    });
    expect(plan.kept).toHaveLength(8);
    expect(plan.kept.filter((k) => k.reason === 'horizon').map((k) => k.index)).toEqual([14, 13, 12, 11, 10]);
    expect(plan.droppedSetters).toBe(7);
    expect(plan.maxDroppedScore).toBe(9);
    const byVertices = planImport({
      candidates: cands,
      scores,
      own: -1,
      site: [0, 0],
      maxVertices: 10,
      contextRadius: 0,
    });
    expect(byVertices.kept).toHaveLength(2);
    expect(byVertices.vertices).toBe(8);
  });
});

describe('small helpers', () => {
  it('hasImportEdits only for removed/edited imported buildings', () => {
    const b = (over: Partial<Building>): Building => ({
      id: 'b1',
      name: '',
      footprint: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      base: 0,
      height: 10,
      source: 'swisstopo',
      ...over,
    });
    expect(hasImportEdits([b({})])).toBe(false);
    expect(hasImportEdits([b({ source: 'manual' })])).toBe(false);
    expect(hasImportEdits([b({ removed: true })])).toBe(true);
    expect(hasImportEdits([b({ edited: true })])).toBe(true);
  });

  it('localIsoDate is the local calendar date', () => {
    const d = new Date(2026, 8, 5, 23, 30);
    expect(localIsoDate(d.getTime())).toBe('2026-09-05');
  });

  it('ringsDistance and ringCentroid', () => {
    const a: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ];
    const b = a.map(([x, y]): [number, number] => [x + 5, y]);
    expect(ringsDistance(a, b)).toBe(3);
    expect(ringsDistance(a, a)).toBe(0);
    expect(ringCentroid(a)).toEqual([1, 1]);
    expect(facadeToEnu([0, 1], 90)[0]).toBeCloseTo(1, 12);
  });
});
