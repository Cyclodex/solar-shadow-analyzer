import { ShapeUtils, Vector2 } from 'three';
import { OTHER_SITE_DISTANCE } from '../../model/buildings';
import { facadeTransform, type GeoPoint } from '../../model/enu';
import { pointInRing, ringArea, ringBounds, type ReadonlyVertex, type Vertex } from '../../model/polygon';
import { ownBuildingIds, OWN_BUILDING_EXCLUSION } from '../../model/surroundings';
import type { Building } from '../../model/types';
import { clamp } from '../../model/units';
import type { Tuple3 } from './coords';

// ─────────────────────────────────────────────
// SURROUNDING BUILDINGS IN 3D: PURE GEOMETRY (owned by the buildings feature)
// Stored buildings (anchor ENU) → prisms around the facade origin (the scene's world origin: config.location
// on the ground; three.js X = east, Y = up, Z = −north), merged into one non-indexed triangle list with flat
// normals plus an outline, with the vertex range of every prism (fading the ones that hide the panel rows).
// The own building is not one of these prisms: once the location is on its wall (confirmed in the site plan)
// the scene draws its real footprint in place of the schematic box (ownBody, snapped onto the facade line),
// so adjoining neighbours touch it instead of cutting into it.
// ─────────────────────────────────────────────

export type PrismKind = 'imported' | 'edited' | 'manual';

/** A surrounding building in the scene's world frame. */
export interface ScenePrism {
  id: string;
  kind: PrismKind;
  /** Footprint, m east/north of the facade origin (counter-clockwise). */
  ring: Vertex[];
  base: number;
  top: number;
}

/** The own building (facade frame, m): its footprint with the facade edge exactly on n = 0. */
export interface OwnBody {
  /** Footprint [u, n] (counter-clockwise in the facade frame's own orientation does not matter). */
  ring: Vertex[];
  /** The flat stretch of the facade around the origin: u0 ≤ 0 ≤ u1 (windows, balconies). */
  u0: number;
  u1: number;
  /** Roof height above the ground, m. */
  top: number;
}

/** Everything the 3D view needs about the stored buildings. */
export interface SceneBuildings {
  prisms: ScenePrism[];
  own: OwnBody | null;
}

/** The location counts as on the own facade when the footprint's wall is at most this far from it (m) … */
const ON_FACADE_M = 0.3;
/** … and that wall is within this angle of the facade line (degrees; the facade azimuth is whole degrees). */
const ON_FACADE_DEG = 3;
/** Depth behind the snapped wall at which the facade stretch is measured (m). */
const STRETCH_N = 0.05;
/**
 * Buildings whose bounding box stays farther than this from the facade origin (m) are not drawn: they add
 * nothing visible, but as shadow casters they would push the light (and the shadow camera's depth range,
 * sceneLayout MAX_DEPTH_RANGE 3000 m) so far away that the panel rows fall out of it and no shadow shows at
 * all. Imports reach 500 m (LIMITS.surfaceModel.radius), manual rectangles 1000 m + their depth.
 */
export const SCENE_BUILDING_RANGE = 1000;

/**
 * Prisms of the stored buildings relative to the facade origin: removed ones, the own building
 * (ownBuildingIds) and those beyond SCENE_BUILDING_RANGE are left out; none when the location is more than
 * OTHER_SITE_DISTANCE from the anchor (the buildings belong to another site). `kind` marks edited and manual
 * ones.
 */
export function sceneBuildings(
  buildings: readonly Building[],
  anchor: GeoPoint | null,
  location: GeoPoint,
  facadeAzimuth: number,
): SceneBuildings {
  if (!anchor || buildings.length === 0) return { prisms: [], own: null };
  const t = facadeTransform(anchor, location, facadeAzimuth);
  const [ox, oy] = t.origin;
  if (!(Math.hypot(ox, oy) <= OTHER_SITE_DISTANCE)) return { prisms: [], own: null };
  const ownIds = new Set(ownBuildingIds(buildings, anchor, location, facadeAzimuth));
  const prisms: ScenePrism[] = [];
  let own: OwnBody | null = null;
  for (const b of buildings) {
    if (b.removed || b.footprint.length < 3) continue;
    const [x0, y0, x1, y1] = ringBounds(b.footprint);
    const dx = Math.max(x0 - ox, 0, ox - x1);
    const dy = Math.max(y0 - oy, 0, oy - y1);
    if (Math.hypot(dx, dy) > SCENE_BUILDING_RANGE) continue;
    if (ownIds.has(b.id)) {
      own ??= ownBody(
        b.footprint.map((p) => t.toFacade(p)),
        b.base + b.height,
      );
      continue;
    }
    prisms.push({
      id: b.id,
      kind: b.source === 'manual' ? 'manual' : b.edited ? 'edited' : 'imported',
      ring: b.footprint.map(([e, n]): Vertex => [e - ox, n - oy]),
      base: b.base,
      top: b.base + b.height,
    });
  }
  return { prisms, own };
}

/** Sorted crossings of a ring with the line `axis` = `value` (0: u = value → n values; 1: n = value → u). */
function crossings(ring: readonly ReadonlyVertex[], axis: 0 | 1, value: number): number[] {
  const other = axis === 0 ? 1 : 0;
  const out: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (a[axis] > value !== b[axis] > value) {
      const f = (value - a[axis]) / (b[axis] - a[axis]);
      out.push(a[other] + f * (b[other] - a[other]));
    }
  }
  return out.sort((x, y) => x - y);
}

/**
 * The own building in the facade frame when the location lies on its wall: the wall edge straight behind
 * the origin is snapped onto the facade line (a rotation of at most ON_FACADE_DEG about the origin and a
 * shift of at most ON_FACADE_M; the stored location is rounded to 1e-6°, the azimuth to whole degrees), and
 * the flat stretch of the facade around u = 0 is measured just behind it. Null when the location is not on
 * the footprint's wall (not yet confirmed in the site plan).
 */
export function ownBody(ringFacade: readonly ReadonlyVertex[], top: number): OwnBody | null {
  const probe = OWN_BUILDING_EXCLUSION.probeN;
  // The wall straight behind the origin: the crossing of u = 0 above the probe.
  let wall: { n: number; a: ReadonlyVertex; b: ReadonlyVertex } | null = null;
  const m = ringFacade.length;
  for (let i = 0, j = m - 1; i < m; j = i++) {
    const a = ringFacade[j];
    const b = ringFacade[i];
    if (a[0] > 0 === b[0] > 0) continue;
    const n = a[1] + ((0 - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    if (n >= probe && (!wall || n < wall.n)) wall = { n, a, b };
  }
  if (!wall || !(Math.abs(wall.n) <= ON_FACADE_M)) return null;
  let angle = Math.atan2(wall.b[1] - wall.a[1], wall.b[0] - wall.a[0]);
  if (angle > Math.PI / 2) angle -= Math.PI;
  else if (angle < -Math.PI / 2) angle += Math.PI;
  if (Math.abs(angle) > (ON_FACADE_DEG * Math.PI) / 180) return null;
  // Rotate by −angle about (0, wall.n), then shift the wall onto n = 0.
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const ring = ringFacade.map(([u, n]): Vertex => {
    const dn = n - wall.n;
    return [u * c - dn * s, u * s + dn * c];
  });
  const us = crossings(ring, 1, -STRETCH_N);
  for (let k = 0; k + 1 < us.length; k += 2) {
    if (us[k] <= 0 && us[k + 1] >= 0) return { ring, u0: us[k], u1: us[k + 1], top };
  }
  return null;
}

// ── Merged mesh ──────────────────────────────

/** Vertex range of one prism in the merged buffers. */
export interface PrismRange {
  start: number;
  count: number;
}

export interface PrismMesh {
  /** Triangle list (xyz per vertex, three.js world). */
  positions: Float32Array;
  normals: Float32Array;
  /** Ranges into positions/normals (vertices) per prism, in input order. */
  triangles: PrismRange[];
  /** Outline segments (pairs of vertices). */
  lines: Float32Array;
  /** Ranges into lines (vertices) per prism. */
  lineRanges: PrismRange[];
}

/** Vertical outline edges only where the footprint turns by more than this (degrees): no clutter on arcs. */
const OUTLINE_MIN_TURN_DEG = 20;
/** A bottom face only for prisms raised above the ground by more than this (m); else it lies on the ground. */
const BOTTOM_MIN_BASE = 0.05;

/** Triangles of a ring's roof (earcut via three's ShapeUtils), counter-clockwise seen from above. */
function roofTriangles(ring: readonly ReadonlyVertex[]): [number, number, number][] {
  const contour = ring.map(([x, y]) => new Vector2(x, y));
  const tris = ShapeUtils.triangulateShape(contour, []);
  return tris.map(([a, b, c]) => {
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const [cx, cy] = ring[c];
    const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) >= 0;
    return ccw ? [a, b, c] : [a, c, b];
  });
}

/**
 * Merged prisms: walls (flat normals, outward for counter-clockwise rings), roofs and, for raised prisms,
 * bottoms; outline = roof and base rings plus the vertical corners.
 */
export function prismMesh(prisms: readonly ScenePrism[]): PrismMesh {
  const pos: number[] = [];
  const nor: number[] = [];
  const lines: number[] = [];
  const triangles: PrismRange[] = [];
  const lineRanges: PrismRange[] = [];
  const cosTurn = Math.cos((OUTLINE_MIN_TURN_DEG * Math.PI) / 180);
  const vertex = (e: number, n: number, z: number, nx: number, ny: number, nz: number): void => {
    // ENU (e, n, z) → three.js (X, Y, Z) = (e, z, −n); normals alike.
    pos.push(e, z, -n);
    nor.push(nx, nz, -ny);
  };
  for (const p of prisms) {
    const ring = ringArea(p.ring) >= 0 ? p.ring : [...p.ring].reverse();
    const n = ring.length;
    const start = pos.length / 3;
    const lineStart = lines.length / 3;
    const { base, top } = p;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % n];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-6) continue;
      // Outward normal of a counter-clockwise ring: right of the edge direction.
      const nx = (by - ay) / len;
      const ny = -(bx - ax) / len;
      vertex(ax, ay, base, nx, ny, 0);
      vertex(bx, by, base, nx, ny, 0);
      vertex(bx, by, top, nx, ny, 0);
      vertex(ax, ay, base, nx, ny, 0);
      vertex(bx, by, top, nx, ny, 0);
      vertex(ax, ay, top, nx, ny, 0);
      lines.push(ax, top, -ay, bx, top, -by);
      if (base > BOTTOM_MIN_BASE) lines.push(ax, base, -ay, bx, base, -by);
      // Vertical edge at vertex b where the outline turns.
      const [cx, cy] = ring[(i + 2) % n];
      const len2 = Math.hypot(cx - bx, cy - by);
      if (len2 > 1e-6 && ((bx - ax) * (cx - bx) + (by - ay) * (cy - by)) / (len * len2) < cosTurn) {
        lines.push(bx, base, -by, bx, top, -by);
      }
    }
    for (const [a, b, c] of roofTriangles(ring)) {
      for (const k of [a, b, c]) vertex(ring[k][0], ring[k][1], top, 0, 0, 1);
      if (base > BOTTOM_MIN_BASE) for (const k of [a, c, b]) vertex(ring[k][0], ring[k][1], base, 0, 0, -1);
    }
    triangles.push({ start, count: pos.length / 3 - start });
    lineRanges.push({ start: lineStart, count: lines.length / 3 - lineStart });
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    triangles,
    lines: new Float32Array(lines),
    lineRanges,
  };
}

/** Vertex indices of the prisms selected by `pick` (index buffer of the opaque or the faded mesh). */
export function rangeIndex(ranges: readonly PrismRange[], pick: (i: number) => boolean): Uint32Array {
  let total = 0;
  ranges.forEach((r, i) => {
    if (pick(i)) total += r.count;
  });
  const out = new Uint32Array(total);
  let k = 0;
  ranges.forEach((r, i) => {
    if (!pick(i)) return;
    for (let v = 0; v < r.count; v++) out[k++] = r.start + v;
  });
  return out;
}

// ── Shadow camera ────────────────────────────

/**
 * Half-width of the square around the facade origin (m) whose buildings the shadow map is fitted to: their
 * shadows on the ground and on each other show there. Farther buildings only set the light's depth range
 * (they still cast onto the fitted area, e.g. the panels). Keeps the map's texels small near the panels.
 */
export const SHADOW_FIT_BUILDING_HALF = 60;

/** Shadow-camera points of the prisms (three.js world): fitted (clamped to the near square) and depth. */
export function buildingShadowPoints(prisms: readonly ScenePrism[]): { fit: Tuple3[]; depth: Tuple3[] } {
  const H = SHADOW_FIT_BUILDING_HALF;
  const fit: Tuple3[] = [];
  const depth: Tuple3[] = [];
  for (const box of prismBoxes(prisms)) {
    for (const [x, y] of [
      [box.x0, box.y0],
      [box.x1, box.y0],
      [box.x0, box.y1],
      [box.x1, box.y1],
    ] as const) {
      depth.push([x, box.top, -y]);
    }
    if (box.x1 < -H || box.x0 > H || box.y1 < -H || box.y0 > H) continue;
    for (const x of [clamp(box.x0, -H, H), clamp(box.x1, -H, H)]) {
      for (const y of [clamp(box.y0, -H, H), clamp(box.y1, -H, H)]) {
        fit.push([x, box.base, -y], [x, box.top, -y]);
      }
    }
  }
  return { fit, depth };
}

// ── Which prisms hide the panel rows ─────────

/** A point in ENU metres around the facade origin (x east, y north, z up). */
export interface EnuPoint {
  x: number;
  y: number;
  z: number;
}

/** Bounding box of a prism for the quick rejection of the view test. */
export interface PrismBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  base: number;
  top: number;
}

export function prismBoxes(prisms: readonly ScenePrism[]): PrismBox[] {
  return prisms.map((p) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of p.ring) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1, base: p.base, top: p.top };
  });
}

/**
 * Whether the segment a → b passes through the prism (flat top, vertical walls): a crossing of its
 * footprint boundary at a height between base and top. Enough for the view test: the targets (panel rows)
 * lie outside every neighbour, so a segment through the volume crosses a wall on its way out or in.
 */
export function segmentHitsPrism(
  a: EnuPoint,
  b: EnuPoint,
  ring: readonly ReadonlyVertex[],
  base: number,
  top: number,
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [px, py] = ring[j];
    const ex = ring[i][0] - px;
    const ey = ring[i][1] - py;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((px - a.x) * ey - (py - a.y) * ex) / den;
    const s = ((px - a.x) * dy - (py - a.y) * dx) / den;
    if (t < 0 || t > 1 || s < 0 || s > 1) continue;
    const z = a.z + t * (b.z - a.z);
    if (z >= base && z <= top) return true;
  }
  return false;
}

/**
 * Indices of the prisms that hide any of `targets` from the camera at `cam` (both ENU around the facade
 * origin). A prism containing the camera hides nothing (its faces are culled from inside).
 */
export function blockingPrisms(
  cam: EnuPoint,
  targets: readonly EnuPoint[],
  prisms: readonly ScenePrism[],
  boxes: readonly PrismBox[],
): Set<number> {
  const out = new Set<number>();
  if (targets.length === 0) return out;
  let x0 = cam.x;
  let y0 = cam.y;
  let x1 = cam.x;
  let y1 = cam.y;
  let zMin = cam.z;
  for (const t of targets) {
    x0 = Math.min(x0, t.x);
    y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x);
    y1 = Math.max(y1, t.y);
    zMin = Math.min(zMin, t.z);
  }
  prisms.forEach((p, i) => {
    const box = boxes[i];
    if (box.x1 < x0 || box.x0 > x1 || box.y1 < y0 || box.y0 > y1 || box.top < zMin) return;
    const inside =
      cam.x >= box.x0 &&
      cam.x <= box.x1 &&
      cam.y >= box.y0 &&
      cam.y <= box.y1 &&
      cam.z >= p.base &&
      cam.z <= p.top &&
      pointInRing(p.ring, cam.x, cam.y);
    if (inside) return;
    if (targets.some((t) => segmentHitsPrism(cam, t, p.ring, p.base, p.top))) out.add(i);
  });
  return out;
}
