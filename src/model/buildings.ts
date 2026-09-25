import type { Building, BuildingImport, FacadeVector, HorizonProfile } from './types';
import { enuToLonLat, facadeTransform, lonLatToEnu, type FacadeTransform, type GeoPoint } from './enu';
import {
  dropDuplicateVertices,
  ensureCcw,
  pointInRing,
  ringArea,
  ringBounds,
  ringDistance,
  segmentDistance,
  type ReadonlyVertex,
  type Vertex,
} from './polygon';
import { LIMITS } from './defaults';
import { clamp, normalizeDeg, toDeg, toRad } from './units';

// ─────────────────────────────────────────────
// SURROUNDING BUILDINGS AS PRISMS (docs/ARCHITECTURE.md, "Umgebung: Adresse, Laserscan, Gebäude")
// - Horizon of flat-topped polygon prisms by an exact edge sweep: every footprint edge covers an azimuth
//   interval as seen from the observer; for each horizon sample inside it the ray/edge distance t is exact,
//   and the nearest crossing of a flat-topped prism is its highest point (tan = (top − z) / t). Equals
//   horizon.ts obstacleHorizon on boxes and a per-sample ray cast on concave polygons (tests). Several
//   observer heights share one pass; courtyards need no special case (keyhole rings, polygon.ts bridgeHoles:
//   the outer ring is crossed first).
// - Facade candidates of the own building (exterior edges, outward true-north azimuth, party walls), the own
//   building of an import (findOwnBuilding), the caps of an import and when the stored buildings belong to
//   another site. The import pruning itself is in buildingImport.ts (used only by the import job).
// - Conversions between the anchor's ENU frame (Building.footprint) and a facade frame (enu.ts); the part
//   of a ring above a line (clipRingAbove, the own building's prisms).
// Coordinates: ENU [east, north] m of the horizon.buildingImport anchor; facade frame [u, n] m of a location
// (u along the facade, n outward), same convention as sunInFacade / obstacleHorizon.
// ─────────────────────────────────────────────

// ── Prism horizon (edge sweep) ───────────────

/** A flat-topped prism in a facade frame. */
export interface Prism {
  /** Footprint [u0, n0, u1, n1, …] in m, open ring (any orientation). */
  ring: Float64Array;
  /** Top above the site ground, m. */
  top: number;
}

/** Ray/edge directions closer to parallel than this (|cross| of unit ray and edge vector, m) are skipped. */
const PARALLEL_EPS = 1e-12;
/** Tolerance of the sample-index range of an edge (in samples): samples on an endpoint's azimuth count. */
const INDEX_EPS = 1e-9;

export interface SampleDirections {
  count: number;
  step: number;
  du: Float64Array;
  dn: Float64Array;
}

const directionCache = new Map<string, SampleDirections>();

/**
 * Horizontal unit directions of the horizon samples (azimuth i · step from north) in the facade frame of
 * facade azimuth γ: du = −sin(A − γ), dn = cos(A − γ) (sunInFacade convention). Cached (few keys in use).
 */
export function sampleDirections(stepDeg: number, facadeAzimuth: number): SampleDirections {
  if (!(stepDeg > 0) || !Number.isFinite(stepDeg)) throw new RangeError(`Invalid horizon step: ${stepDeg}`);
  const count = Math.max(1, Math.round(360 / stepDeg));
  const key = `${count}|${facadeAzimuth}`;
  let d = directionCache.get(key);
  if (!d) {
    const step = 360 / count;
    const du = new Float64Array(count);
    const dn = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const rel = toRad(i * step - facadeAzimuth);
      du[i] = -Math.sin(rel);
      dn[i] = Math.cos(rel);
    }
    d = { count, step, du, dn };
    if (directionCache.size > 32) directionCache.clear();
    directionCache.set(key, d);
  }
  return d;
}

/** Azimuth (degrees from north, [0, 360)) of the facade-frame direction (u, n) for facade azimuth γ. */
export function facadeDirectionAzimuth(u: number, n: number, facadeAzimuth: number): number {
  return normalizeDeg(toDeg(Math.atan2(-u, n)) + facadeAzimuth);
}

/** Even-odd point-in-polygon test on a flat ring [u0, n0, u1, n1, …]. */
function pointInFlatRing(ring: Float64Array, u: number, n: number): boolean {
  let inside = false;
  const m = ring.length / 2;
  for (let i = 0, j = m - 1; i < m; j = i++) {
    const ui = ring[2 * i];
    const ni = ring[2 * i + 1];
    const uj = ring[2 * j];
    const nj = ring[2 * j + 1];
    if (ni > n !== nj > n && u < ((uj - ui) * (n - ni)) / (nj - ni) + ui) inside = !inside;
  }
  return inside;
}

export interface PrismSweepOptions {
  /** Horizon sampling step, degrees (the effective step is 360 / round(360 / stepDeg)). Default 0.5. */
  stepDeg?: number;
  /**
   * Argmax tracking: per height, the index (into `prisms`) of the prism that sets each sample, −1 where none
   * rises above the observer. Filled when given (one Int32Array of the sample count per height).
   */
  owners?: Int32Array[];
}

/**
 * Horizon of flat-topped prisms seen from `observer` (facade frame, m) at several observer heights (m above
 * the site ground), as tan(elevation) per height and sample (azimuth i · step from north; 0 = nothing above
 * the observer). Exact edge sweep: each edge is intersected only with the samples of the azimuth interval it
 * covers, and the largest (top − z) / t over the edges crossed by a sample's ray is the prism's elevation
 * there (a flat top is highest at its nearest crossing). Prisms containing the observer (even-odd) are
 * ignored, like obstacleHorizon; prisms not higher than the lowest observer are skipped.
 * O(Σ edges · samples per edge · heights).
 */
export function prismHorizonTangents(
  prisms: readonly Prism[],
  observer: Pick<FacadeVector, 'u' | 'n'>,
  heights: readonly number[],
  facadeAzimuth: number,
  opts: PrismSweepOptions = {},
): Float64Array[] {
  const { count, step, du, dn } = sampleDirections(opts.stepDeg ?? 0.5, facadeAzimuth);
  const H = heights.length;
  const best = Array.from({ length: H }, () => new Float64Array(count));
  const owners = opts.owners;
  if (owners) for (const o of owners) o.fill(-1);
  if (H === 0) return best;
  let minZ = Infinity;
  for (const z of heights) minZ = Math.min(minZ, z);
  const ou = observer.u;
  const on = observer.n;
  const rise = new Float64Array(H);
  for (let p = 0; p < prisms.length; p++) {
    const prism = prisms[p];
    if (!(prism.top > minZ)) continue; // never above 0° for any height
    const r = prism.ring;
    const m = r.length >> 1;
    if (m < 3 || pointInFlatRing(r, ou, on)) continue;
    for (let h = 0; h < H; h++) rise[h] = prism.top - heights[h];
    for (let a = 0, b = m - 1; a < m; b = a++) {
      const pu = r[2 * b] - ou;
      const pn = r[2 * b + 1] - on;
      const qu = r[2 * a] - ou;
      const qn = r[2 * a + 1] - on;
      // Azimuth interval of the edge (the shorter arc between its endpoints, < 180° unless the observer is
      // on the edge's line, where no ray crosses it at t > 0).
      let a0 = facadeDirectionAzimuth(pu, pn, facadeAzimuth);
      const a1 = facadeDirectionAzimuth(qu, qn, facadeAzimuth);
      let span = a1 - a0;
      if (span > 180) span -= 360;
      else if (span < -180) span += 360;
      if (span < 0) {
        a0 = a1;
        span = -span;
      }
      const i0 = Math.ceil(a0 / step - INDEX_EPS);
      const i1 = Math.floor((a0 + span) / step + INDEX_EPS);
      const eu = qu - pu;
      const en = qn - pn;
      const num = pu * en - pn * eu; // cross(p, e)
      for (let k = i0; k <= i1; k++) {
        const i = k >= count ? k - count : k;
        const den = du[i] * en - dn[i] * eu; // cross(d, e)
        if (Math.abs(den) < PARALLEL_EPS) continue;
        const t = num / den;
        if (!(t > 0)) continue;
        const inv = 1 / t;
        for (let h = 0; h < H; h++) {
          const tan = rise[h] * inv;
          if (tan > best[h][i]) {
            best[h][i] = tan;
            if (owners) owners[h][i] = p;
          }
        }
      }
    }
  }
  return best;
}

/** Horizon profiles (degrees, ≥ 0) per observer height of prismHorizonTangents. */
export function prismHorizons(
  prisms: readonly Prism[],
  observer: Pick<FacadeVector, 'u' | 'n'>,
  heights: readonly number[],
  facadeAzimuth: number,
  stepDeg = 0.5,
): HorizonProfile[] {
  const tangents = prismHorizonTangents(prisms, observer, heights, facadeAzimuth, { stepDeg });
  const step = 360 / Math.max(1, Math.round(360 / stepDeg));
  return tangents.map((row) => ({ stepDeg: step, elevations: Array.from(row, tanToDeg) }));
}

/** Elevation in degrees of a horizon tangent (0 for nothing above the observer). */
export function tanToDeg(tan: number): number {
  return tan > 0 ? toDeg(Math.atan(tan)) : 0;
}

/** Prisms of `buildings` in the facade frame of `transform` (top = base + height above the site ground). */
export function facadePrisms(buildings: readonly Building[], transform: FacadeTransform): Prism[] {
  return buildings.map((b) => {
    const ring = new Float64Array(b.footprint.length * 2);
    b.footprint.forEach((p, k) => {
      const [u, n] = transform.toFacade(p);
      ring[2 * k] = u;
      ring[2 * k + 1] = n;
    });
    return { ring, top: b.base + b.height };
  });
}

/** Coordinates closer than this (m) along the clip line count as the same point (tie of two crossings). */
const CLIP_TIE_EPS = 1e-9;

/** Sutherland–Hodgman against one line: one ring, pieces joined along the line (fallback of clipRingAbove). */
function clipRingAboveSingle(ring: readonly ReadonlyVertex[], c: number): Vertex[] {
  const out: Vertex[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i + ring.length - 1) % ring.length];
    const b = ring[i];
    const aIn = a[1] > c;
    const bIn = b[1] > c;
    if (aIn !== bIn) out.push([a[0] + ((c - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), c]);
    if (bIn) out.push([b[0], b[1]]);
  }
  return dropDuplicateVertices(out);
}

/**
 * The part of a ring above the line y = c (second coordinate > c; vertices on the line count as below), as
 * separate counter-clockwise rings: a concave ring may fall apart into several pieces, and joining them along
 * the line (Sutherland–Hodgman) would add walls across the gaps between them. The crossings with the line,
 * sorted along it, bound the parts of the line inside the ring (from a downward to the next upward crossing of
 * a counter-clockwise ring); each piece follows the ring above the line and jumps along the line from a
 * downward crossing to its partner. Keyhole rings (bridged courtyards) stay keyhole rings. Pieces below
 * 1e-9 m² are dropped. Falls back to one Sutherland–Hodgman ring if the crossings are inconsistent
 * (a self-intersecting ring).
 */
export function clipRingAbove(ring: readonly ReadonlyVertex[], c: number): Vertex[][] {
  const r = ensureCcw(dropDuplicateVertices(ring));
  const m = r.length;
  if (m < 3) return [];
  // Walk order: the vertices above the line and the crossings (+1 upward = entering, −1 downward = leaving).
  const pts: Vertex[] = [];
  const kind: number[] = [];
  let above = 0;
  for (let i = 0; i < m; i++) {
    const a = r[i];
    const b = r[(i + 1) % m];
    const aIn = a[1] > c;
    const bIn = b[1] > c;
    if (aIn) {
      pts.push([a[0], a[1]]);
      kind.push(0);
      above++;
    }
    if (aIn !== bIn) {
      pts.push([a[0] + ((c - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), c]);
      kind.push(bIn ? 1 : -1);
    }
  }
  const crossings: number[] = [];
  for (let i = 0; i < pts.length; i++) if (kind[i] !== 0) crossings.push(i);
  if (crossings.length === 0) return above === m ? [r] : [];
  const fallback = (): Vertex[][] => {
    const single = clipRingAboveSingle(r, c);
    return single.length >= 3 ? [single] : [];
  };
  // Along the line: leaving (−1) at even positions, entering (+1) at odd ones. Ties (a keyhole bridge or a
  // vertex touching the line) are ordered to fit that pattern.
  crossings.sort((p, q) => pts[p][0] - pts[q][0]);
  for (let k = 0; k < crossings.length; k++) {
    const want = k % 2 === 0 ? -1 : 1;
    if (kind[crossings[k]] === want) continue;
    const x = pts[crossings[k]][0];
    let j = k + 1;
    while (j < crossings.length && pts[crossings[j]][0] - x <= CLIP_TIE_EPS && kind[crossings[j]] !== want)
      j++;
    if (j >= crossings.length || pts[crossings[j]][0] - x > CLIP_TIE_EPS) return fallback();
    [crossings[k], crossings[j]] = [crossings[j], crossings[k]];
  }
  const partner = new Int32Array(pts.length).fill(-1);
  for (let k = 0; k < crossings.length; k += 2) partner[crossings[k]] = crossings[k + 1];
  const used = new Uint8Array(pts.length);
  const out: Vertex[][] = [];
  const limit = 2 * pts.length + 4;
  for (const start of crossings) {
    if (kind[start] !== 1 || used[start]) continue;
    const piece: Vertex[] = [];
    let cur = start;
    let steps = 0;
    do {
      used[cur] = 1;
      piece.push(pts[cur]);
      let j = (cur + 1) % pts.length;
      while (kind[j] === 0) {
        piece.push(pts[j]);
        j = (j + 1) % pts.length;
        if (++steps > limit) return fallback();
      }
      if (kind[j] !== -1) return fallback();
      used[j] = 1;
      piece.push(pts[j]);
      cur = partner[j];
      if (cur < 0 || (cur !== start && used[cur]) || ++steps > limit) return fallback();
    } while (cur !== start);
    const clean = dropDuplicateVertices(piece);
    if (clean.length >= 3 && Math.abs(ringArea(clean)) > 1e-9) out.push(clean);
  }
  return out;
}

// ── Frame conversions ────────────────────────

/** Footprint of a building in the facade frame of `transform` ([u, n] m). */
export function footprintToFacade(
  footprint: readonly ReadonlyVertex[],
  transform: FacadeTransform,
): Vertex[] {
  return footprint.map((p) => transform.toFacade(p));
}

/** A rectangle in the facade frame: the quick way to enter a building by hand. */
export interface FacadeRect {
  /** Extent along the facade, m. */
  width: number;
  /** Extent away from the facade, m. */
  depth: number;
  /** Distance of the near side from the facade wall (before rotation), m; the centre is at distance + depth/2. */
  distance: number;
  /** Centre along the facade, m (+ = right, seen from outside facing the facade). */
  offset: number;
  /** Rotation about the centre, degrees clockwise seen from above (like an azimuth). */
  rotation: number;
}

/** Round to the 0.1 m grid of the stored footprints (−0 → 0). */
const dm = (v: number): number => Math.round(v * 10) / 10 + 0;

/** Ranges of a manual rectangle (m, degrees): obstacle-like, at least 1 m wide and deep (≥ 1 m²). */
export const MANUAL_RECT_LIMITS = {
  distance: { min: 0, max: 1000, step: 0.5 },
  offset: { min: -300, max: 300, step: 0.5 },
  width: { min: 1, max: 300, step: 0.5 },
  depth: { min: 1, max: 300, step: 0.5 },
  rotation: { min: -90, max: 90, step: 1 },
} as const;

/** A new manual building (like createObstacle: 15 × 10 m, 20 m in front of the facade, 12 m high). */
export const DEFAULT_MANUAL_RECT: FacadeRect = { width: 15, depth: 10, distance: 20, offset: 0, rotation: 0 };
export const DEFAULT_MANUAL_HEIGHT = 12;

/**
 * ENU footprint (anchor of `transform`) of a facade-frame rectangle: counter-clockwise, on the 0.1 m grid.
 * Null when a corner lies outside LIMITS.neighbour.coord (more than 2 km from the anchor: the location has
 * moved to another site since the import); clamping would collapse the rectangle.
 */
export function rectFootprint(rect: FacadeRect, transform: FacadeTransform): [number, number][] | null {
  const w = Math.max(0, rect.width) / 2;
  const d = Math.max(0, rect.depth) / 2;
  const cu = rect.offset;
  const cn = rect.distance + d;
  const r = toRad(rect.rotation);
  const c = Math.cos(r);
  const s = Math.sin(r);
  const corners: Vertex[] = [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d],
  ];
  const L = LIMITS.neighbour.coord;
  const enu = corners.map(([x, y]): Vertex => {
    // Seen from above, the facade axes (u, n) are a left-handed pair (u × n = −1 in east/north), so a
    // clockwise turn seen from above is counter-clockwise in [u, n]: (x, y) → (x·c − y·s, x·s + y·c).
    const u = cu + x * c - y * s;
    const n = cn + x * s + y * c;
    const [e, no] = transform.toAnchor([u, n]);
    return [dm(e), dm(no)];
  });
  if (enu.some(([e, n]) => !(e >= L.min && e <= L.max && n >= L.min && n <= L.max))) return null;
  return ensureCcw(dropDuplicateVertices(enu));
}

/**
 * Footprint re-anchored from `from` to `to` (both ENU origins): each vertex → WGS84 → ENU of `to`, on the
 * 0.1 m grid. Null when a vertex falls outside LIMITS.neighbour.coord (more than 2 km from the new anchor).
 */
export function reanchorFootprint(
  footprint: readonly ReadonlyVertex[],
  from: GeoPoint,
  to: GeoPoint,
): [number, number][] | null {
  const L = LIMITS.neighbour.coord;
  const out: [number, number][] = [];
  for (const [e, n] of footprint) {
    const g = enuToLonLat(from, e, n);
    const [x, y] = lonLatToEnu(to, g.latitude, g.longitude);
    const p: [number, number] = [dm(x), dm(y)];
    if (p[0] < L.min || p[0] > L.max || p[1] < L.min || p[1] > L.max) return null;
    out.push(p);
  }
  return out;
}

/** Where a building lies as seen from a point (the balcony): distance and direction of its nearest point. */
export interface BuildingBearing {
  /** Distance from the point to the footprint, m (0 inside). */
  distance: number;
  /** True-north azimuth from the point to the nearest point of the footprint (the centroid when inside). */
  azimuth: number;
}

/** Distance and direction of a footprint (anchor ENU) from `origin` (anchor ENU, e.g. the location). */
export function buildingBearing(
  footprint: readonly ReadonlyVertex[],
  origin: ReadonlyVertex,
): BuildingBearing {
  const [ox, oy] = origin;
  let best = Infinity;
  let bx = 0;
  let by = 0;
  const n = footprint.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = footprint[j];
    const b = footprint[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? clamp(((ox - a[0]) * dx + (oy - a[1]) * dy) / len2, 0, 1) : 0;
    const px = a[0] + t * dx;
    const py = a[1] + t * dy;
    const d = Math.hypot(px - ox, py - oy);
    if (d < best) {
      best = d;
      bx = px;
      by = py;
    }
  }
  if (n >= 3 && pointInRing(footprint, ox, oy)) {
    const [cx, cy] = ringCentroid(footprint);
    return { distance: 0, azimuth: normalizeDeg(toDeg(Math.atan2(cx - ox, cy - oy))) };
  }
  return { distance: best, azimuth: normalizeDeg(toDeg(Math.atan2(bx - ox, by - oy))) };
}

/** Area centroid of a ring (vertex mean for degenerate rings). */
export function ringCentroid(ring: readonly ReadonlyVertex[]): Vertex {
  const a = ringArea(ring);
  const n = ring.length;
  if (n === 0) return [0, 0];
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / n, sy / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/**
 * Anchor for new manual buildings: the existing import anchor, else the location (1e-6°) with radius 0 and no
 * date (docs/ARCHITECTURE.md, Config-Vertrag).
 */
export function manualAnchor(current: BuildingImport | null, location: GeoPoint): BuildingImport {
  if (current) return current;
  const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
  return { latitude: r6(location.latitude), longitude: r6(location.longitude), radius: 0, date: '' };
}

/**
 * Source credit of the imported buildings, the same as buildingSources.ts SWISSTOPO_ATTRIBUTION (test): the
 * building list and the print report take it from here, so the tile decoder stays out of the main chunk.
 */
export const SWISSTOPO_CREDIT = '© swisstopo';

/**
 * The stored buildings belong to another site when the location is farther than this from their anchor (m):
 * footprints lie within ±2000 m of it (LIMITS.neighbour.coord), so none can be added at the location either.
 * The location moved without a new import (coordinates, presets, place search, a failed import).
 */
export const OTHER_SITE_DISTANCE = LIMITS.neighbour.coord.max;

/** Horizontal distance of the location from the buildings' anchor (m). */
export function anchorDistance(anchor: GeoPoint, location: GeoPoint): number {
  const [e, n] = lonLatToEnu(anchor, location.latitude, location.longitude);
  return Math.hypot(e, n);
}

/** Facade transform of a config's anchor, location and facade azimuth (null without an anchor). */
export function configFacadeTransform(
  anchor: GeoPoint | null,
  location: GeoPoint,
  facadeAzimuth: number,
): FacadeTransform | null {
  return anchor ? facadeTransform(anchor, location, facadeAzimuth) : null;
}

// ── Facade candidates of the own building ────

/** Shortest edge offered as a facade, m. */
export const FACADE_MIN_LENGTH = 2;
/** Outward offset of the probe points that detect adjoining parts, m (tile vertices are on a 0.41 m grid). */
export const PARTY_WALL_PROBE_M = 0.5;
/** An edge adjoins another part (party wall) when at least this share of its probes lies inside one. */
export const PARTY_WALL_SHARE = 0.5;
/** Probe spacing along an edge, m. */
const PROBE_SPACING_M = 0.5;
/** Probes per edge at most. */
const MAX_PROBES = 400;

/** One edge of a footprint as a facade candidate. */
export interface FacadeEdge {
  /** Edge index: from ring[index] to ring[(index + 1) % length]. */
  index: number;
  a: Vertex;
  b: Vertex;
  /** Outward normal (the facade azimuth it would give), degrees from true north clockwise, [0, 360). */
  azimuth: number;
  /** Length, m. */
  length: number;
  /** Share of the edge (probes) adjoining another part, 0–1. */
  shared: number;
  /** Not exterior: the outside probes lie inside the footprint itself (keyhole bridges, slivers). */
  interior: boolean;
  /** Party wall: adjoins another part (shared ≥ PARTY_WALL_SHARE). Not selectable. */
  party: boolean;
  /** Exterior, not a party wall and at least FACADE_MIN_LENGTH long: can be the balcony facade. */
  selectable: boolean;
}

/**
 * Edges of a footprint (anchor ENU, any orientation) as facade candidates: outward normal as true-north
 * azimuth (ENU north is true north), length, and whether the edge adjoins one of `others` (party wall,
 * probes PARTY_WALL_PROBE_M outside the edge fall inside another part) or is not exterior (keyhole bridge).
 * Courtyard edges of a keyhole ring are exterior and face into the courtyard.
 */
export function facadeEdges(
  footprint: readonly ReadonlyVertex[],
  others: readonly (readonly ReadonlyVertex[])[] = [],
): FacadeEdge[] {
  const ring = ensureCcw(footprint);
  const n = ring.length;
  if (n < 3) return [];
  const [x0, y0, x1, y1] = ringBounds(ring);
  const reach = PARTY_WALL_PROBE_M + 1;
  const near = others
    .filter((o) => o.length >= 3)
    .map((o) => ({ ring: o, box: ringBounds(o) }))
    .filter(
      ({ box }) =>
        box[0] <= x1 + reach && box[2] >= x0 - reach && box[1] <= y1 + reach && box[3] >= y0 - reach,
    );
  const out: FacadeEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const length = Math.hypot(ex, ey);
    if (!(length > 0)) continue;
    // Counter-clockwise ring: the outside is on the right of the edge direction.
    const nx = ey / length;
    const ny = -ex / length;
    const azimuth = normalizeDeg(toDeg(Math.atan2(nx, ny)));
    const probes = Math.min(MAX_PROBES, Math.max(1, Math.ceil(length / PROBE_SPACING_M)));
    let shared = 0;
    let inside = 0;
    for (let j = 0; j < probes; j++) {
      const t = (j + 0.5) / probes;
      const px = a[0] + ex * t + nx * PARTY_WALL_PROBE_M;
      const py = a[1] + ey * t + ny * PARTY_WALL_PROBE_M;
      if (pointInRing(ring, px, py)) inside++;
      else if (
        near.some(
          ({ ring: o, box }) =>
            px >= box[0] && px <= box[2] && py >= box[1] && py <= box[3] && pointInRing(o, px, py),
        )
      )
        shared++;
    }
    const interior = inside / probes >= 0.5;
    const share = shared / probes;
    const party = !interior && share >= PARTY_WALL_SHARE;
    out.push({
      index: i,
      a: [a[0], a[1]],
      b: [b[0], b[1]],
      azimuth,
      length,
      shared: share,
      interior,
      party,
      selectable: !interior && !party && length >= FACADE_MIN_LENGTH,
    });
  }
  return out;
}

/** Point on an edge at fraction t (0 = a, 1 = b), anchor ENU. */
export function edgePoint(edge: Pick<FacadeEdge, 'a' | 'b'>, t: number): Vertex {
  const f = clamp(t, 0, 1);
  return [edge.a[0] + (edge.b[0] - edge.a[0]) * f, edge.a[1] + (edge.b[1] - edge.a[1]) * f];
}

/** Projection of a point onto an edge: fraction t (clamped 0–1) and the distance from the edge, m. */
export function projectOntoEdge(
  edge: Pick<FacadeEdge, 'a' | 'b'>,
  point: ReadonlyVertex,
): { t: number; distance: number } {
  const dx = edge.b[0] - edge.a[0];
  const dy = edge.b[1] - edge.a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((point[0] - edge.a[0]) * dx + (point[1] - edge.a[1]) * dy) / len2, 0, 1) : 0;
  return { t, distance: segmentDistance(point[0], point[1], edge.a, edge.b) };
}

// ── Import: own building, caps ───────────────

/** Imported buildings at most (MAX_BUILDINGS 150 minus a reserve of 30 for buildings added by hand). */
export const IMPORT_MAX_BUILDINGS = 120;
/** Vertices of imported buildings at most (MAX_TOTAL_BUILDING_VERTICES 2000 minus a reserve of 400). */
export const IMPORT_MAX_VERTICES = 1600;
/** Parts closer than this to the own part adjoin it (party walls; kept so the site plan can tell them), m. */
export const ADJOINING_DISTANCE = 0.5;
/** Without a part containing the point, the nearest part within this distance is the own building, m. */
export const OWN_MAX_DISTANCE = 25;
/**
 * Index of the own building among `footprints` (anchor ENU): the first containing `probe` (the point behind
 * the facade origin), else the first containing `point` (the address), else the nearest within
 * OWN_MAX_DISTANCE of `point`; −1 when none.
 */
export function findOwnBuilding(
  footprints: readonly (readonly ReadonlyVertex[])[],
  point: ReadonlyVertex,
  probe?: ReadonlyVertex | null,
): number {
  if (probe) {
    const i = footprints.findIndex((f) => f.length >= 3 && pointInRing(f, probe[0], probe[1]));
    if (i >= 0) return i;
  }
  const inside = footprints.findIndex((f) => f.length >= 3 && pointInRing(f, point[0], point[1]));
  if (inside >= 0) return inside;
  let best = -1;
  let bestD = OWN_MAX_DISTANCE;
  footprints.forEach((f, i) => {
    const d = ringDistance(f, point[0], point[1]);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Smallest distance between two rings' boundaries (0 when they overlap), m. */
export function ringsDistance(a: readonly ReadonlyVertex[], b: readonly ReadonlyVertex[]): number {
  let d = Infinity;
  for (const [x, y] of a) d = Math.min(d, ringDistance(b, x, y));
  for (const [x, y] of b) d = Math.min(d, ringDistance(a, x, y));
  return d;
}

/** Local calendar date 'YYYY-MM-DD' of a timestamp (the import date). */
export function localIsoDate(ms: number): string {
  const d = new Date(ms);
  const p = (v: number): string => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True when imported buildings carry user changes (removed or edited) that a re-import would discard. */
export function hasImportEdits(buildings: readonly Building[]): boolean {
  return buildings.some((b) => b.source === 'swisstopo' && (b.removed === true || b.edited === true));
}
