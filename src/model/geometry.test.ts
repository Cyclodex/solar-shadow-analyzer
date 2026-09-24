import { describe, it, expect } from 'vitest';
import {
  CELLS_ACROSS_SHORT_SIDE,
  cosIncidence,
  criticalAngleKind,
  facadeFrame,
  floorPlacements,
  instantState,
  instantStateFromSun,
  panelDepthBelowGround,
  panelLayout,
  panelsOverlap,
  profileAngle,
  shadeFromAbove,
  substringBeamLoss,
  sunInFacade,
  toFacade,
} from './geometry';
import { DEFAULT_CONFIG, LIMITS } from './defaults';
import { emptyHorizon } from './horizon';
import { sunPosition, sunVectorEnu } from './sun';
import type {
  Config,
  FacadeVector,
  HorizonProfile,
  PanelLayout,
  ShadeRect,
  ShadeResult,
  SunPosition,
  Vec3,
} from './types';

// ── helpers ──────────────────────────────────

const D = Math.PI / 180;

/** Mulberry32 — small seeded PRNG so random cases are reproducible. */
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

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

function cfg(over: DeepPartial<Config> = {}): Config {
  const c = structuredClone(DEFAULT_CONFIG);
  Object.assign(c.building, over.building);
  Object.assign(c.panels, over.panels);
  Object.assign(c.location, over.location);
  return c;
}

const sunAt = (altitude: number, azimuth: number): SunPosition => ({
  altitude,
  azimuth,
  declination: 0,
  equationOfTime: 0,
});

/** Sun direction from profile angle p and azimuth ψ relative to the facade normal: tan p = tan h / cos ψ. */
function sunFromProfile(p: number, psi: number, facadeAz: number): SunPosition {
  const h = Math.atan(Math.tan(p * D) * Math.cos(psi * D)) / D;
  return sunAt(h, facadeAz + psi);
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const UP: Vec3 = { x: 0, y: 0, z: 1 };

/** Sun unit vector in ENU (x east, y north, z up) from altitude/azimuth — written independently of sun.ts. */
const enuSun = (s: SunPosition): Vec3 => ({
  x: Math.cos(s.altitude * D) * Math.sin(s.azimuth * D),
  y: Math.cos(s.altitude * D) * Math.cos(s.azimuth * D),
  z: Math.sin(s.altitude * D),
});

/** A parallelogram corner + a·e1 + b·e2 (a, b ∈ [0, 1]) with precomputed Cramer vectors for ray tests. */
interface Quad {
  corner: Vec3;
  e1: Vec3;
  e2: Vec3;
}

/**
 * Independent 3D scene of two stacked rows in world ENU coordinates.
 * Facade frame derived from first principles: outward normal N points to azimuth γ; a viewer outside looks along −N,
 * their right hand is (−N) × up = up × N.
 */
function scene(c: Config) {
  const g = c.building.facadeAzimuth * D;
  const N: Vec3 = { x: Math.sin(g), y: Math.cos(g), z: 0 };
  const U = cross(UP, N);
  const L = c.panels.length / 100;
  const w = c.panels.width / 100;
  const gap = c.panels.gap / 100;
  const H = c.building.floorHeight / 100;
  const th = c.panels.tiltFromVertical * D;
  const railN = c.building.balconyDepth / 100;
  const zr = 3.1; // lower rail top, arbitrary
  const count = c.panels.count;
  const rowW = count * w + (count - 1) * gap;
  const spans = Array.from({ length: count }, (_, i) => -rowW / 2 + i * (w + gap));
  const slope = add(mul(N, Math.sin(th) * L), mul(UP, -Math.cos(th) * L)); // top edge → bottom edge
  const row = (z: number): Quad[] =>
    spans.map((u0) => ({
      corner: add(add(mul(U, u0), mul(N, railN)), mul(UP, z)),
      e1: mul(U, w),
      e2: slope,
    }));
  return { N, U, L, w, H, spans, lower: row(zr), upper: row(zr + H) };
}

/** Ray P + t·s vs parallelogram plane: solves a·e1 + b·e2 − t·s = P − corner (Cramer) → [a, b, t], null if parallel. */
function rayPlane(P: Vec3, s: Vec3, q: Quad): [number, number, number] | null {
  const ms = mul(s, -1);
  const det = dot(q.e1, cross(q.e2, ms));
  if (Math.abs(det) < 1e-14) return null;
  const r = sub(P, q.corner);
  return [dot(r, cross(q.e2, ms)) / det, dot(q.e1, cross(r, ms)) / det, dot(q.e1, cross(q.e2, r)) / det];
}

interface BruteResult {
  /** Hit fraction per lower module. */
  perModule: number[];
  /** Grid points where the ray hit disagrees with "inside one of the result rects". */
  mismatches: number;
}

/** Casts a ray toward the sun from an n×n midpoint grid on every lower module and tests all upper quads. */
function bruteForce(c: Config, sun: SunPosition, n: number, rects: ShadeRect[]): BruteResult {
  const sc = scene(c);
  const s = enuSun(sun);
  const ms = mul(s, -1);
  // Per upper quad: a = r·k1/det, b = r·k2/det, t = r·k3/det (scalar triple products rearranged).
  const pre = sc.upper.map((q) => {
    const k1 = cross(q.e2, ms);
    return { q, det: dot(q.e1, k1), k1, k2: cross(ms, q.e1), k3: cross(q.e1, q.e2) };
  });
  const perModule: number[] = [];
  let mismatches = 0;
  sc.lower.forEach((low, i) => {
    let hits = 0;
    for (let ia = 0; ia < n; ia++) {
      const fa = (ia + 0.5) / n;
      const u = sc.spans[i] + fa * sc.w;
      for (let ib = 0; ib < n; ib++) {
        const fb = (ib + 0.5) / n;
        const v = fb * sc.L;
        const P = add(add(low.corner, mul(low.e1, fa)), mul(low.e2, fb));
        let hit = false;
        for (const { q, det, k1, k2, k3 } of pre) {
          if (Math.abs(det) < 1e-14) continue;
          const rx = P.x - q.corner.x;
          const ry = P.y - q.corner.y;
          const rz = P.z - q.corner.z;
          const t = (rx * k3.x + ry * k3.y + rz * k3.z) / det;
          if (t <= 1e-9) continue;
          const a = (rx * k1.x + ry * k1.y + rz * k1.z) / det;
          if (a < 0 || a > 1) continue;
          const b = (rx * k2.x + ry * k2.y + rz * k2.z) / det;
          if (b < 0 || b > 1) continue;
          hit = true;
          break;
        }
        if (hit) hits++;
        const inRect = rects.some((r) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1);
        if (inRect !== hit) mismatches++;
      }
    }
    perModule.push(hits / (n * n));
  });
  return { perModule, mismatches };
}

// ── frames ───────────────────────────────────

describe('facade frame', () => {
  it('south facade: n points south, u points east (right when looking north at it)', () => {
    const f = facadeFrame(180);
    expect(f.n.x).toBeCloseTo(0, 12);
    expect(f.n.y).toBeCloseTo(-1, 12);
    expect(f.u.x).toBeCloseTo(1, 12);
    expect(f.u.y).toBeCloseTo(0, 12);
  });

  it('east facade: viewer looks west, right hand is north', () => {
    const f = facadeFrame(90);
    expect(f.n.x).toBeCloseTo(1, 12);
    expect(f.u.y).toBeCloseTo(1, 12);
    expect(f.u.x).toBeCloseTo(0, 12);
  });

  it('is orthonormal and u = up × n for random azimuths', () => {
    const rnd = prng(11);
    for (let k = 0; k < 50; k++) {
      const f = facadeFrame(rnd() * 360);
      expect(dot(f.n, f.n)).toBeCloseTo(1, 12);
      expect(dot(f.u, f.u)).toBeCloseTo(1, 12);
      expect(dot(f.u, f.n)).toBeCloseTo(0, 12);
      const c = cross(UP, f.n);
      expect(f.u.x).toBeCloseTo(c.x, 12);
      expect(f.u.y).toBeCloseTo(c.y, 12);
    }
  });

  it('toFacade projects onto the frame axes', () => {
    const rnd = prng(12);
    for (let k = 0; k < 50; k++) {
      const g = rnd() * 360;
      const v = { x: rnd() - 0.5, y: rnd() - 0.5, z: rnd() - 0.5 };
      const f = facadeFrame(g);
      const r = toFacade(v, g);
      expect(r.n).toBeCloseTo(dot(v, f.n), 12);
      expect(r.u).toBeCloseTo(dot(v, f.u), 12);
      expect(r.z).toBe(v.z);
    }
  });

  it('sunInFacade equals toFacade(sunVectorEnu(sun))', () => {
    const rnd = prng(13);
    for (let k = 0; k < 50; k++) {
      const sun = sunAt(rnd() * 180 - 90, rnd() * 360);
      const g = rnd() * 360;
      const a = sunInFacade(sun, g);
      const b = toFacade(sunVectorEnu(sun), g);
      expect(a.u).toBeCloseTo(b.u, 12);
      expect(a.n).toBeCloseTo(b.n, 12);
      expect(a.z).toBeCloseTo(b.z, 12);
    }
  });
});

// ── layout ───────────────────────────────────

describe('panelLayout', () => {
  it('default config (113.4 × 176.2 cm, 2 modules, 2 cm gap, θ = 45°, H = 280 cm)', () => {
    const l = panelLayout(DEFAULT_CONFIG);
    const r = Math.SQRT1_2 * 1.134; // L·cos45 = L·sin45
    expect(l.length).toBeCloseTo(1.134, 12);
    expect(l.moduleWidth).toBeCloseTo(1.762, 12);
    expect(l.rowWidth).toBeCloseTo(2 * 1.762 + 0.02, 12); // 3.544
    expect(l.modules[0].u0).toBeCloseTo(-1.772, 12);
    expect(l.modules[0].u1).toBeCloseTo(-0.01, 12);
    expect(l.modules[1].u0).toBeCloseTo(0.01, 12);
    expect(l.modules[1].u1).toBeCloseTo(1.772, 12);
    expect(l.drop).toBeCloseTo(r, 12);
    expect(l.reach).toBeCloseTo(r, 12);
    expect(l.verticalGap).toBeCloseTo(2.8 - r, 12);
    // Grazing ray from the upper lower edge (reach, H − drop) to the lower top edge (0, 0).
    expect(l.criticalProfileAngle).toBeCloseTo(Math.atan((2.8 - r) / r) / D, 10);
    expect(l.tiltFromHorizontal).toBe(45);
    expect(l.moduleArea).toBeCloseTo(1.134 * 1.762, 12);
    expect(l.normal.n).toBeCloseTo(Math.SQRT1_2, 12);
    expect(l.normal.z).toBeCloseTo(Math.SQRT1_2, 12);
    expect(panelsOverlap(l)).toBe(false);
  });

  it('vertical panels: no reach, never shaded (critical angle 90°)', () => {
    const l = panelLayout(cfg({ panels: { tiltFromVertical: 0 } }));
    expect(l.reach).toBe(0);
    expect(l.drop).toBeCloseTo(1.134, 12);
    expect(l.criticalProfileAngle).toBe(90);
    expect(l.normal).toEqual({ u: 0, n: 1, z: 0 });
  });

  it('flat panels: drop 0, critical angle atan(H/L)', () => {
    const l = panelLayout(cfg({ panels: { tiltFromVertical: 90 } }));
    expect(l.drop).toBe(0);
    expect(l.reach).toBeCloseTo(1.134, 12);
    expect(l.criticalProfileAngle).toBeCloseTo(Math.atan(2.8 / 1.134) / D, 10);
    expect(l.normal).toEqual({ u: 0, n: 0, z: 1 });
  });

  it('panels longer than the floor height overlap; critical angle ≤ 0', () => {
    const vertical = panelLayout(
      cfg({ panels: { length: 250, tiltFromVertical: 0 }, building: { floorHeight: 200 } }),
    );
    expect(panelsOverlap(vertical)).toBe(true);
    expect(vertical.criticalProfileAngle).toBe(-90);
    const tilted = panelLayout(
      cfg({ panels: { length: 250, tiltFromVertical: 20 }, building: { floorHeight: 200 } }),
    );
    expect(panelsOverlap(tilted)).toBe(true);
    const drop = 2.5 * Math.cos(20 * D);
    expect(tilted.criticalProfileAngle).toBeCloseTo(Math.atan((2 - drop) / (2.5 * Math.sin(20 * D))) / D, 10);
    expect(tilted.criticalProfileAngle).toBeLessThan(0);
  });

  it('single module is centered at u = 0', () => {
    const l = panelLayout(cfg({ panels: { count: 1, width: 100 } }));
    expect(l.modules).toEqual([{ u0: -0.5, u1: 0.5 }]);
    expect(l.rowWidth).toBe(1);
  });

  it('classifies the critical angle: no row above, overlapping rows, never shaded, or an onset angle', () => {
    const tilted = panelLayout(DEFAULT_CONFIG);
    expect(criticalAngleKind(tilted, false)).toBe('none');
    expect(criticalAngleKind(tilted, true)).toBe('angle');
    const vertical = panelLayout(cfg({ panels: { tiltFromVertical: 0 } }));
    expect(criticalAngleKind(vertical, true)).toBe('never');
    expect(criticalAngleKind(vertical, false)).toBe('none');
    const long = panelLayout(
      cfg({ panels: { length: 250, tiltFromVertical: 0 }, building: { floorHeight: 200 } }),
    );
    expect(criticalAngleKind(long, true)).toBe('overlap');
    expect(criticalAngleKind(long, false)).toBe('none');
  });
});

describe('floorPlacements', () => {
  it('stacks floors by H from storey lowestFloor, panel center half a slope below the rail', () => {
    const p = floorPlacements(cfg({ building: { numFloors: 3, lowestFloor: 1 } }));
    const half = 0.567;
    expect(p).toHaveLength(3);
    p.forEach((f, k) => {
      expect(f.floor).toBe(k);
      expect(f.storey).toBe(1 + k);
      expect(f.slabZ).toBeCloseTo((1 + k) * 2.8, 12);
      expect(f.railTopZ).toBeCloseTo((1 + k) * 2.8 + 1, 12);
      expect(f.railN).toBeCloseTo(1.5, 12);
      expect(f.center.u).toBe(0);
      expect(f.center.n).toBeCloseTo(1.5 + half * Math.SQRT1_2, 12);
      expect(f.center.z).toBeCloseTo((1 + k) * 2.8 + 1 - half * Math.SQRT1_2, 12);
    });
  });
});

describe('panelDepthBelowGround', () => {
  const depth = (c: Config): number => panelDepthBelowGround(panelLayout(c), floorPlacements(c));

  it('is 0 while the lowest row stays above ground (default: 1st floor; ground floor at θ 45°)', () => {
    expect(depth(DEFAULT_CONFIG)).toBe(0);
    expect(depth(cfg({ building: { lowestFloor: 0 } }))).toBe(0);
    expect(panelDepthBelowGround(panelLayout(DEFAULT_CONFIG), [])).toBe(0);
  });

  it('measures how far ground-floor panels reach below the terrain', () => {
    // 113.4 cm module at θ 20°: drop 106.6 cm against a 100 cm railing.
    expect(depth(cfg({ building: { lowestFloor: 0 }, panels: { tiltFromVertical: 20 } }))).toBeCloseTo(
      0.0656,
      4,
    );
    // Portrait 176.2 cm at θ 45°: drop 124.6 cm.
    expect(depth(cfg({ building: { lowestFloor: 0 }, panels: { width: 113.4, length: 176.2 } }))).toBeCloseTo(
      0.2459,
      4,
    );
  });

  it('only the lowest row counts: from the 1st floor up the railing top is above the maximum drop', () => {
    const longest = { tiltFromVertical: 0, length: LIMITS.panels.length.max };
    const lowest = {
      floorHeight: LIMITS.building.floorHeight.min,
      railingHeight: LIMITS.building.railingHeight.min,
    };
    expect(depth(cfg({ building: { ...lowest, lowestFloor: 1 }, panels: longest }))).toBe(0);
    expect(depth(cfg({ building: { ...lowest, lowestFloor: 0 }, panels: longest }))).toBeCloseTo(2, 12);
  });
});

// ── angles ───────────────────────────────────

describe('profileAngle & cosIncidence', () => {
  it('profile angle: tan p = tan h / cos(A − γ); null behind the facade', () => {
    const rnd = prng(21);
    for (let k = 0; k < 50; k++) {
      const h = 1 + rnd() * 88;
      const psi = rnd() * 178 - 89;
      const p = profileAngle(sunInFacade(sunAt(h, 200 + psi), 200));
      expect(p).not.toBeNull();
      expect(p as number).toBeCloseTo(Math.atan(Math.tan(h * D) / Math.cos(psi * D)) / D, 9);
    }
    expect(profileAngle(sunInFacade(sunAt(40, 20), 200))).toBeNull();
    expect(profileAngle({ u: 1, n: 0, z: 0 })).toBeNull();
  });

  it('cosIncidence matches the textbook tilted-plane formula cos β·sin h + sin β·cos h·cos(A − γ)', () => {
    const rnd = prng(22);
    for (let k = 0; k < 100; k++) {
      const theta = rnd() * 90;
      const beta = (90 - theta) * D; // tilt from horizontal, plane azimuth = facade azimuth
      const g = rnd() * 360;
      const sun = sunAt(rnd() * 90, rnd() * 360);
      const l = panelLayout(cfg({ panels: { tiltFromVertical: theta }, building: { facadeAzimuth: g } }));
      const ref =
        Math.cos(beta) * Math.sin(sun.altitude * D) +
        Math.sin(beta) * Math.cos(sun.altitude * D) * Math.cos((sun.azimuth - g) * D);
      expect(cosIncidence(sunInFacade(sun, g), l)).toBeCloseTo(ref, 12);
    }
  });
});

// ── shading ──────────────────────────────────

function rectArea(rects: ShadeRect[], m: { u0: number; u1: number }): number {
  return rects.reduce(
    (a, r) => a + Math.max(0, Math.min(r.u1, m.u1) - Math.max(r.u0, m.u0)) * (r.v1 - r.v0),
    0,
  );
}

describe('shadeFromAbove — analytic cases', () => {
  const G = 180;

  it('sun on the facade normal: onset exactly at the critical profile angle, band L − H/(cos θ + sin θ·tan p)', () => {
    for (const theta of [15, 30, 45, 60, 75, 90]) {
      const c = cfg({ panels: { tiltFromVertical: theta }, building: { facadeAzimuth: G } });
      const l = panelLayout(c);
      const L = 1.134;
      const H = 2.8;
      const th = theta * D;
      const pc = Math.atan((H - L * Math.cos(th)) / (L * Math.sin(th))) / D;
      const at = (p: number) => shadeFromAbove(sunInFacade(sunFromProfile(p, 0, G), G), l);
      expect(at(pc).fraction).toBeLessThan(1e-9);
      expect(at(pc - 0.5).fraction).toBe(0);
      for (const dp of [0.5, 3, 10]) {
        const p = pc + dp;
        if (p >= 89.9) continue;
        // 2D side view: shadow of the upper lower edge (reach, H − drop) along the ray hits the lower slope at v*.
        const vStar = L - H / (Math.cos(th) + Math.sin(th) * Math.tan(p * D));
        const s = at(p);
        expect(s.fraction).toBeCloseTo(vStar / L, 10);
        s.perModule.forEach((f) => expect(f).toBeCloseTo(vStar / L, 10));
        expect(s.du).toBeCloseTo(0, 12);
        expect(s.dv).toBeCloseTo(L - vStar, 10);
        expect(s.rects).toHaveLength(2);
        s.rects.forEach((r, i) => {
          expect(r.u0).toBeCloseTo(l.modules[i].u0, 12);
          expect(r.u1).toBeCloseTo(l.modules[i].u1, 12);
          expect(r.v0).toBe(0);
          expect(r.v1).toBeCloseTo(vStar, 10);
        });
      }
    }
  });

  it('hand-drawn sign check: south facade, morning sun from ESE → shadow falls on the WEST (left) end', () => {
    // World ENU, sun h = 55°, A = 120°: s = (cos55·sin120, cos55·cos120, sin55) = (0.496732, −0.286788, 0.819152).
    // South facade: outward n = −y, panel normal (0, −cos45, sin45) → cosInc = (0.286788 + 0.819152)·√½ = 0.782018.
    // Ray from the lower plane to the upper plane (offset H·sin θ along the normal): t = 2.8·√½ / 0.782018 = 2.531782,
    // so the upper-row point that shades a lower point lies t·s_x = 1.257617 m further EAST and t·0.286788 = 0.726085 m
    // further out, i.e. Δv = 0.726085/√½ = 1.026840 down the slope → shaded band v ∈ [0, 1.134 − 1.026840 = 0.107160].
    // The shadow is the upper row moved 1.257617 m WEST. Viewer outside (south) looks north: left = west = −u.
    // Upper modules [−1.772, −0.01], [0.01, 1.772] − 1.257617 → [−3.029617, −1.267617], [−1.247617, 0.514383]:
    // west module covered 1.762 − 0.02 (gap shadow) = 1.742 m, east module only [0.01, 0.514383] = 0.504383 m.
    const l = panelLayout(cfg({ building: { facadeAzimuth: 180 } }));
    const s = shadeFromAbove(sunInFacade(sunAt(55, 120), 180), l);
    expect(s.du).toBeCloseTo(1.257617, 6);
    expect(s.dv).toBeCloseTo(1.02684, 5);
    const band = 1.134 - 1.0268397345;
    expect(s.perModule[0]).toBeCloseTo((1.742 * band) / (1.762 * 1.134), 6); // west / left: 0.093425
    expect(s.perModule[1]).toBeCloseTo((0.5043833 * band) / (1.762 * 1.134), 6); // east / right: 0.027051
    // East end of the lower row stays lit: no shade beyond u = 0.514383.
    expect(Math.max(...s.rects.map((r) => r.u1))).toBeCloseTo(0.514383, 6);
    expect(Math.min(...s.rects.map((r) => r.u0))).toBeCloseTo(l.modules[0].u0, 12);
    // Mirror: afternoon sun from WSW (A = 240°) → shadow on the east end.
    const m = shadeFromAbove(sunInFacade(sunAt(55, 240), 180), l);
    expect(m.du).toBeCloseTo(-1.257617, 6);
    expect(m.perModule[1]).toBeCloseTo(s.perModule[0], 12);
    expect(m.perModule[0]).toBeCloseTo(s.perModule[1], 12);
  });

  it('vertical panels (θ = 0) are never shaded', () => {
    const l = panelLayout(cfg({ panels: { tiltFromVertical: 0 } }));
    for (const p of [10, 45, 70, 85, 89.9]) {
      for (const psi of [-60, 0, 30]) {
        const s = shadeFromAbove(sunInFacade(sunFromProfile(p, psi, 202), 202), l);
        expect(s.fraction).toBe(0);
        expect(s.rects).toEqual([]);
        expect(s.perModule).toEqual([0, 0]);
      }
    }
  });

  it('sun behind the facade (s_n ≤ 0) or below the horizon → no shade', () => {
    const l = panelLayout(DEFAULT_CONFIG);
    for (const sun of [
      sunAt(60, 22),
      sunAt(80, 202 + 95),
      sunAt(30, 202 + 180),
      sunAt(-5, 202),
      sunAt(0, 202),
    ]) {
      const s = shadeFromAbove(sunInFacade(sun, 202), l);
      expect(s.fraction).toBe(0);
      expect(s.rects).toEqual([]);
    }
    expect(shadeFromAbove({ u: 0.5, n: 0, z: 0.866 }, l).fraction).toBe(0);
  });

  it('lateral sun with |Δu| > row width → no shade although the profile angle exceeds the critical angle', () => {
    // Flat panels (θ = 90): parallel horizontal planes H apart. The ray climbs H over a horizontal run H/tan h
    // in the sun's azimuth, so Δu = −H·sin ψ / tan h and Δv = H·cos ψ / tan h.
    const c = cfg({ panels: { tiltFromVertical: 90, count: 1 }, building: { facadeAzimuth: G } });
    const l = panelLayout(c);
    const H = 2.8;
    const p = Math.atan(3) / D; // tan p = 3 > H/L = 2.47 → above critical
    const psi = 70;
    const sun = sunFromProfile(p, psi, G);
    const sf = sunInFacade(sun, G);
    const tanH = Math.tan(sun.altitude * D);
    const du = (-H * Math.sin(psi * D)) / tanH;
    const dv = (H * Math.cos(psi * D)) / tanH;
    expect(profileAngle(sf) as number).toBeGreaterThan(l.criticalProfileAngle);
    expect(dv).toBeLessThan(l.length); // would shade in 2D
    expect(Math.abs(du)).toBeGreaterThan(l.rowWidth);
    const s = shadeFromAbove(sf, l);
    expect(s.fraction).toBe(0);
    expect(s.rects).toEqual([]);
    expect(s.du).toBeCloseTo(du, 10);
    expect(s.dv).toBeCloseTo(dv, 10);
  });

  it('hand-computed lateral partial shade on two modules with a gap', () => {
    // Flat panels, H = 3, L = 1, w = 1, gap = 0.1 → modules [−1.05, −0.05], [0.05, 1.05].
    // Choose (Δu, Δv) = (0.5, 0.25): horizontal run √(Δu²+Δv²) = H/tan h, direction ψ = atan2(−Δu, Δv).
    const c = cfg({
      panels: { tiltFromVertical: 90, count: 2, width: 100, length: 100, gap: 10 },
      building: { facadeAzimuth: G, floorHeight: 300 },
    });
    const l = panelLayout(c);
    const h = Math.atan(3 / Math.hypot(0.5, 0.25)) / D;
    const psi = Math.atan2(-0.5, 0.25) / D;
    const s = shadeFromAbove(sunInFacade(sunAt(h, G + psi), G), l);
    expect(s.du).toBeCloseTo(0.5, 10);
    expect(s.dv).toBeCloseTo(0.25, 10);
    // Shade = upper modules − Δu = [−1.55, −0.55] ∪ [−0.45, 0.55], v ∈ [0, 0.75].
    // Module 0: [−1.05, −0.55] ∪ [−0.45, −0.05] → 0.9·0.75; module 1: [0.05, 0.55] → 0.5·0.75.
    expect(s.perModule[0]).toBeCloseTo(0.675, 10);
    expect(s.perModule[1]).toBeCloseTo(0.375, 10);
    expect(s.fraction).toBeCloseTo(0.525, 10);
    const want = [
      [-1.05, -0.55],
      [-0.45, -0.05],
      [0.05, 0.55],
    ];
    expect(s.rects).toHaveLength(3);
    s.rects.forEach((r, i) => {
      expect(r.u0).toBeCloseTo(want[i][0], 10);
      expect(r.u1).toBeCloseTo(want[i][1], 10);
      expect(r.v0).toBe(0);
      expect(r.v1).toBeCloseTo(0.75, 10);
    });
  });

  it('gapless row: touching shifted modules merge into one rect per module', () => {
    const c = cfg({
      panels: { tiltFromVertical: 90, count: 3, width: 100, length: 100, gap: 0 },
      building: { facadeAzimuth: G, floorHeight: 300 },
    });
    const l = panelLayout(c);
    const h = Math.atan(3 / Math.hypot(0.3, 0.2)) / D;
    const s = shadeFromAbove(sunInFacade(sunAt(h, G + Math.atan2(-0.3, 0.2) / D), G), l);
    // Upper row − 0.3 = [−1.8, 1.2]: modules [−1.5,−0.5], [−0.5,0.5] fully, [0.5,1.5] → [0.5,1.2].
    expect(s.rects).toHaveLength(3);
    expect(s.perModule[0]).toBeCloseTo(0.8, 10);
    expect(s.perModule[1]).toBeCloseTo(0.8, 10);
    expect(s.perModule[2]).toBeCloseTo(0.7 * 0.8, 10);
  });

  it('near-zenith sun on the normal shades flat panels almost fully: fraction = 1 − H/(tan h·L)', () => {
    const l = panelLayout(cfg({ panels: { tiltFromVertical: 90 }, building: { facadeAzimuth: G } }));
    const h = 89.9;
    const s = shadeFromAbove(sunInFacade(sunAt(h, G), G), l);
    expect(s.fraction).toBeCloseTo(1 - 2.8 / Math.tan(h * D) / 1.134, 10);
  });
});

describe('shadeFromAbove — brute-force 3D ray casting', () => {
  it('agrees with ray casting against the real upper quads for 400 random configs and suns', () => {
    const rnd = prng(20260923);
    const N = 150;
    let partial = 0;
    let lateralMiss = 0;
    let compared = 0;
    for (let k = 0; k < 400; k++) {
      const r = rnd();
      const theta = r < 0.08 ? 0 : r < 0.16 ? 90 : rnd() * 90;
      const c = cfg({
        building: {
          facadeAzimuth: rnd() * 360,
          floorHeight: 200 + rnd() * 300,
          balconyDepth: rnd() * 400,
        },
        panels: {
          length: 30 + rnd() * 220,
          width: 30 + rnd() * 220,
          count: 1 + Math.floor(rnd() * 4),
          gap: rnd() < 0.2 ? 0 : rnd() * 30,
          tiltFromVertical: theta,
        },
      });
      const g = c.building.facadeAzimuth;
      const l = panelLayout(c);
      let sun: SunPosition;
      if (rnd() < 0.8) {
        // Aim around/above the 2D onset so that most cases are partially shaded.
        const pc = l.criticalProfileAngle;
        const pLo = Math.min(80, Math.max(1, pc - 15));
        sun = sunFromProfile(pLo + rnd() * (89.5 - pLo), rnd() * 170 - 85, g);
      } else {
        sun = sunAt(0.5 + rnd() * 89, rnd() * 360);
      }
      const sf = sunInFacade(sun, g);
      const s = shadeFromAbove(sf, l);
      // Internal consistency: perModule = rect area / module area, fraction = mean.
      l.modules.forEach((m, i) =>
        expect(s.perModule[i]).toBeCloseTo(rectArea(s.rects, m) / l.moduleArea, 10),
      );
      expect(s.fraction).toBeCloseTo(s.perModule.reduce((a, b) => a + b, 0) / l.count, 12);
      if (sf.n <= 0) {
        expect(s.fraction).toBe(0); // blocked by the wall by definition
        continue;
      }
      compared++;
      const bf = bruteForce(c, sun, N, s.rects);
      // Rects are exact, so every grid point must be classified like its 3D ray (observed: 0 mismatches);
      // one grid line of slack for points that land exactly on an edge.
      expect(bf.mismatches).toBeLessThanOrEqual(N);
      l.modules.forEach((m, i) => {
        const nRects = s.rects.filter((q) => q.u1 > m.u0 && q.u0 < m.u1).length;
        // Midpoint grid: per rect edge at most half a cell row/column is misclassified → ≤ 2/N + 1/N² per rect.
        const tol = Math.max(1, nRects) * (2 / N + 1 / (N * N)) + 1e-12;
        expect(Math.abs(bf.perModule[i] - s.perModule[i])).toBeLessThanOrEqual(tol);
      });
      if (s.fraction > 0.02 && s.fraction < 0.98) partial++;
      if (s.fraction === 0 && s.dv < l.length && s.dv > 0 && Math.abs(s.du) >= l.rowWidth) lateralMiss++;
      // du, dv: where the ray from the lower corner (u0, v = 0) meets the (infinite) upper plane.
      if (l.normal.z > 1e-9) {
        const sc = scene(c);
        const hit = rayPlane(sc.lower[0].corner, enuSun(sun), sc.upper[0]);
        expect(hit).not.toBeNull();
        const [a, b] = hit as [number, number, number];
        expect(s.du).toBeCloseTo(a * sc.w, 9);
        expect(s.dv).toBeCloseTo(b * sc.L, 9);
      }
    }
    expect(compared).toBeGreaterThan(300);
    expect(partial).toBeGreaterThan(120);
    expect(lateralMiss).toBeGreaterThan(0);
  }, 60_000);
});

describe('shadeFromAbove — rows further up', () => {
  // The row j floors up is the same parallel plane j·H higher → its shade is shadeFromAbove with floorHeight j·H.
  /** Every rect of `inner` lies inside the union of `outer` (same module: u-cover within a v-band that contains it). */
  const inside = (inner: ShadeRect[], outer: ShadeRect[]): boolean =>
    inner.every((r) => {
      const os = outer
        .filter((o) => o.v0 <= r.v0 + 1e-12 && o.v1 >= r.v1 - 1e-12 && o.u1 > r.u0 && o.u0 < r.u1)
        .sort((a, b) => a.u0 - b.u0);
      let x = r.u0;
      for (const o of os) {
        if (o.u0 > x + 1e-12) return false;
        x = Math.max(x, o.u1);
      }
      return x >= r.u1 - 1e-12;
    });

  it('gapless rows and single modules: shade from 2 and 3 floors up lies inside the shade from the floor above', () => {
    // Row − j·du ∩ row ⊆ row − du ∩ row for an interval row, and band [0, L − j·dv] ⊆ [0, L − dv] (dv > 0).
    const rnd = prng(41);
    let nonEmpty = 0;
    for (let k = 0; k < 400; k++) {
      const single = rnd() < 0.3;
      const over = {
        building: { floorHeight: 200 + rnd() * 300, facadeAzimuth: 180 },
        panels: {
          length: 30 + rnd() * 220,
          width: 30 + rnd() * 220,
          count: single ? 1 : 2 + Math.floor(rnd() * 7),
          gap: single ? rnd() * 30 : 0,
          tiltFromVertical: 5 + rnd() * 85,
        },
      };
      const c1 = cfg(over);
      const l1 = panelLayout(c1);
      const pLo = Math.min(80, Math.max(1, l1.criticalProfileAngle));
      const sf = sunInFacade(sunFromProfile(pLo + rnd() * (89.5 - pLo), rnd() * 170 - 85, 180), 180);
      const s1 = shadeFromAbove(sf, l1);
      for (const j of [2, 3]) {
        const H = c1.building.floorHeight * j;
        const sj = shadeFromAbove(
          sf,
          panelLayout(cfg({ ...over, building: { ...over.building, floorHeight: H } })),
        );
        if (sj.rects.length > 0) nonEmpty++;
        expect(inside(sj.rects, s1.rects)).toBe(true);
      }
    }
    expect(nonEmpty).toBeGreaterThan(50);
  });

  it('with module gaps the row two floors up can reach through the gaps (documented limitation)', () => {
    // Flat, L = 1, w = 0.6, gap = 0.3, H = 3 → modules [−0.75, −0.15], [0.15, 0.75]. Sun with (du, dv) = (0.45, 0.25):
    // run hypot(0.45, 0.25) = H/tan h, ψ = atan2(−0.45, 0.25) (as in the lateral test above).
    const over = {
      building: { facadeAzimuth: 180, floorHeight: 300 },
      panels: { tiltFromVertical: 90, length: 100, width: 60, gap: 30, count: 2 },
    };
    const sun = sunAt(Math.atan(3 / Math.hypot(0.45, 0.25)) / D, 180 + Math.atan2(-0.45, 0.25) / D);
    const sf = sunInFacade(sun, 180);
    const s1 = shadeFromAbove(sf, panelLayout(cfg(over)));
    // Row − 0.45 = [−1.2, −0.6] ∪ [−0.3, 0.3], band [0, 0.75]: left module 0.3/0.6·0.75, right module 0.15/0.6·0.75.
    expect(s1.perModule[0]).toBeCloseTo(0.375, 12);
    expect(s1.perModule[1]).toBeCloseTo(0.1875, 12);
    // Two floors up: row − 0.9 = [−1.65, −1.05] ∪ [−0.75, −0.15], band [0, 0.5] → the whole left module width,
    // including the strip [−0.6, −0.3] that the row directly above leaves lit (its gap). True union: 0.5 + 0.25·0.5.
    const s2 = shadeFromAbove(
      sf,
      panelLayout(cfg({ ...over, building: { facadeAzimuth: 180, floorHeight: 600 } })),
    );
    expect(s2.perModule[0]).toBeCloseTo(0.5, 12);
    expect(inside(s2.rects, s1.rects)).toBe(false);
  });
});

// ── substring model ──────────────────────────

function shadeWith(layout: PanelLayout, rects: ShadeRect[]): ShadeResult {
  return { fraction: 0, perModule: layout.modules.map(() => 0), rects, du: 0, dv: 0 };
}

describe('substringBeamLoss', () => {
  // Landscape 180 × 120 cm: cell = 1.2/6 = 0.2 m, 9 cells along u. Substring s = v ∈ [0.4s, 0.4(s+1)].
  const land = panelLayout(cfg({ panels: { length: 120, width: 180, count: 1 } }));
  // Portrait 120 (u) × 180 (v): cell = 0.2 m, 9 cells along v. Substring s = u ∈ [−0.6 + 0.4s, −0.6 + 0.4(s+1)].
  const port = panelLayout(cfg({ panels: { length: 180, width: 120, count: 1 } }));

  it('no rects → no loss; full coverage → 1', () => {
    expect(substringBeamLoss(shadeWith(land, []), land)).toEqual([0]);
    expect(substringBeamLoss(shadeWith(land, [{ u0: -0.9, u1: 0.9, v0: 0, v1: 1.2 }]), land)[0]).toBeCloseTo(
      1,
      12,
    );
    expect(substringBeamLoss(shadeWith(port, [{ u0: -0.6, u1: 0.6, v0: 0, v1: 1.8 }]), port)[0]).toBeCloseTo(
      1,
      12,
    );
  });

  it('landscape: thin sliver on top only hits the top substring, limited by its most shaded cell', () => {
    // Top cell row shaded 0.02/0.2 = 10 % → substring 0 loses 10 %, others 0 → module 10 %/3.
    const full = substringBeamLoss(shadeWith(land, [{ u0: -0.9, u1: 0.9, v0: 0, v1: 0.02 }]), land);
    expect(full[0]).toBeCloseTo(0.1 / 3, 12);
    // Only half of the first cell column (u ∈ [−0.9, −0.8]): worst cell 0.1·0.02 / 0.04 = 5 %.
    const part = substringBeamLoss(shadeWith(land, [{ u0: -0.9, u1: -0.8, v0: 0, v1: 0.02 }]), land);
    expect(part[0]).toBeCloseTo(0.05 / 3, 12);
  });

  it('landscape: band over 1¼ substrings → (1 + 0.5 + 0)/3, above the linear 0.5/1.2', () => {
    // v ∈ [0, 0.5]: substring 0 fully; substring 1's top cell row v ∈ [0.4, 0.6] half shaded.
    const loss = substringBeamLoss(shadeWith(land, [{ u0: -0.9, u1: 0.9, v0: 0, v1: 0.5 }]), land);
    expect(loss[0]).toBeCloseTo(0.5, 12);
    expect(loss[0]).toBeGreaterThan(0.5 / 1.2);
  });

  it('portrait: thin sliver on top touches all three substrings', () => {
    // Each substring's top cell (height 0.2) shaded 0.02/0.2 = 10 % → module 10 %.
    const loss = substringBeamLoss(shadeWith(port, [{ u0: -0.6, u1: 0.6, v0: 0, v1: 0.02 }]), port);
    expect(loss[0]).toBeCloseTo(0.1, 12);
  });

  it('portrait: a stripe covering exactly one substring → 1/3', () => {
    const loss = substringBeamLoss(shadeWith(port, [{ u0: -0.6, u1: -0.2, v0: 0, v1: 1.8 }]), port);
    expect(loss[0]).toBeCloseTo(1 / 3, 12);
  });

  it('non-integer cell count: 113.4 × 176.2 cm → 6 × round(9.32) = 9 cells of 0.1958 m', () => {
    const l = panelLayout(DEFAULT_CONFIG);
    const cl = 1.762 / Math.round(1.762 / (1.134 / 6));
    const m = l.modules[0];
    // First cell column fully shaded over the whole height → every substring has one dark cell → 100 %.
    expect(substringBeamLoss(shadeWith(l, [{ u0: m.u0, u1: m.u0 + cl, v0: 0, v1: 1.134 }]), l)).toEqual([
      expect.closeTo(1, 12),
      0,
    ]);
    // Half of that column → 50 %.
    const half = substringBeamLoss(shadeWith(l, [{ u0: m.u0, u1: m.u0 + cl / 2, v0: 0, v1: 1.134 }]), l);
    expect(half[0]).toBeCloseTo(0.5, 12);
    expect(half[1]).toBe(0);
  });

  it('rects spanning two modules are clipped to each module', () => {
    const l = panelLayout(cfg({ panels: { length: 120, width: 180, count: 2, gap: 0 } }));
    // Modules [−1.8, 0], [0, 1.8]; rect u ∈ [−0.1, 0.1] full height: half a cell column in each module.
    const loss = substringBeamLoss(shadeWith(l, [{ u0: -0.1, u1: 0.1, v0: 0, v1: 1.2 }]), l);
    expect(loss[0]).toBeCloseTo(0.5, 12);
    expect(loss[1]).toBeCloseTo(0.5, 12);
  });

  it('matches a naive cell-by-cell implementation and is ≥ the linear loss for random shade', () => {
    /** Independent reference: loop all cells × all rects with plain rectangle intersection. */
    function naive(shade: ShadeResult, l: PanelLayout): number[] {
      const landscape = l.moduleWidth >= l.length;
      const short = landscape ? l.length : l.moduleWidth;
      const long = landscape ? l.moduleWidth : l.length;
      const cs = short / CELLS_ACROSS_SHORT_SIDE;
      const nl = Math.round(long / cs);
      const cl = long / nl;
      return l.modules.map((m) => {
        let total = 0;
        for (let sIdx = 0; sIdx < 3; sIdx++) {
          let worst = 0;
          for (let p = 2 * sIdx; p < 2 * sIdx + 2; p++) {
            for (let q = 0; q < nl; q++) {
              // Cell rectangle in (u, v).
              const cu0 = m.u0 + (landscape ? q * cl : p * cs);
              const cu1 = cu0 + (landscape ? cl : cs);
              const cv0 = landscape ? p * cs : q * cl;
              const cv1 = cv0 + (landscape ? cs : cl);
              let a = 0;
              for (const r of shade.rects) {
                a +=
                  Math.max(0, Math.min(cu1, r.u1) - Math.max(cu0, r.u0)) *
                  Math.max(0, Math.min(cv1, r.v1) - Math.max(cv0, r.v0));
              }
              worst = Math.max(worst, a / (cs * cl));
            }
          }
          total += Math.min(1, worst);
        }
        return total / 3;
      });
    }
    const rnd = prng(31);
    let nonzero = 0;
    for (let k = 0; k < 300; k++) {
      const c = cfg({
        building: { floorHeight: 200 + rnd() * 300 },
        panels: {
          length: 30 + rnd() * 220,
          width: 30 + rnd() * 220,
          count: 1 + Math.floor(rnd() * 4),
          gap: rnd() * 10,
          tiltFromVertical: 5 + rnd() * 85,
        },
      });
      const l = panelLayout(c);
      const pLo = Math.min(80, Math.max(1, l.criticalProfileAngle - 5));
      const sf: FacadeVector = sunInFacade(
        sunFromProfile(pLo + rnd() * (89.5 - pLo), rnd() * 150 - 75, 180),
        180,
      );
      const s = shadeFromAbove(sf, l);
      const got = substringBeamLoss(s, l);
      const ref = naive(s, l);
      got.forEach((g, i) => {
        expect(g).toBeCloseTo(ref[i], 10);
        expect(g).toBeGreaterThanOrEqual(s.perModule[i] - 1e-12);
        expect(g).toBeLessThanOrEqual(1);
        if (g > 0) nonzero++;
      });
    }
    expect(nonzero).toBeGreaterThan(100);
  });
});

// ── instant state ────────────────────────────

describe('instantState', () => {
  const c = cfg({ building: { numFloors: 3, facadeAzimuth: 180 } });
  const flat = [emptyHorizon(), emptyHorizon(), emptyHorizon()];
  const l = panelLayout(c);

  it('night: every floor night, no shade', () => {
    const st = instantStateFromSun(c, 0, sunAt(-3, 180), flat);
    expect(st.floors.map((f) => f.state)).toEqual(['night', 'night', 'night']);
    st.floors.forEach((f) => expect(f.shade.fraction).toBe(0));
  });

  it('sun behind the facade → behind, profile angle null', () => {
    const st = instantStateFromSun(c, 0, sunAt(40, 30), flat);
    expect(st.floors.map((f) => f.state)).toEqual(['behind', 'behind', 'behind']);
    expect(st.profileAngle).toBeNull();
  });

  it('per-floor horizon blocks only the floors whose horizon is higher than the sun', () => {
    const high: HorizonProfile = { stepDeg: 1, elevations: new Array<number>(360).fill(85) };
    const st = instantStateFromSun(c, 0, sunFromProfile(80, 0, 180), [high, flat[1], flat[2]]);
    expect(st.floors.map((f) => f.state)).toEqual(['horizon', 'lit', 'lit']);
    expect(st.floors[0].shade.fraction).toBe(0);
    expect(st.floors[1].shade.fraction).toBeGreaterThan(0);
    expect(st.floors[2].shade.fraction).toBe(0); // top floor
  });

  it('lit floors below the top get shadeFromAbove; missing horizons count as flat', () => {
    const sun = sunFromProfile(80, 20, 180);
    const st = instantStateFromSun(c, 123, sun, []);
    const sf = sunInFacade(sun, 180);
    expect(st.utcMs).toBe(123);
    expect(st.sunFacade).toEqual(sf);
    expect(st.profileAngle as number).toBeCloseTo(80, 9);
    expect(st.floors.map((f) => f.state)).toEqual(['lit', 'lit', 'lit']);
    expect(st.floors[0].shade).toEqual(shadeFromAbove(sf, l));
    expect(st.floors[1].shade).toEqual(shadeFromAbove(sf, l));
    expect(st.floors[2].shade.fraction).toBe(0);
    st.floors.forEach((f) => expect(f.cosIncidence).toBeCloseTo(cosIncidence(sf, l), 12));
  });

  it('instantState = instantStateFromSun with the NOAA sun position', () => {
    const t = Date.UTC(2025, 5, 21, 11, 0);
    const want = instantStateFromSun(c, t, sunPosition(t, c.location.latitude, c.location.longitude), flat);
    expect(instantState(c, t, flat)).toEqual(want);
    expect(want.floors[0].state).toBe('lit');
  });
});
