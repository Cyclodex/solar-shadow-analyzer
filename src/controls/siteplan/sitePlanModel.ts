import {
  edgePoint,
  facadeEdges,
  findOwnBuilding,
  projectOntoEdge,
  type FacadeEdge,
} from '../../model/buildings';
import { enuToLonLat, facadeToEnu, type GeoPoint } from '../../model/enu';
import { pointInRing, ringBounds, type ReadonlyVertex, type Vertex } from '../../model/polygon';
import { OWN_BUILDING_EXCLUSION } from '../../model/surroundings';
import type { Building } from '../../model/types';
import { angleDiff, clamp, normalizeDeg } from '../../model/units';

// ─────────────────────────────────────────────
// SITE PLAN: PURE GEOMETRY (owned by the buildings feature, docs/ARCHITECTURE.md "Umgebung")
// Which stored building is the own one, its facade candidates, where the configured location sits on them
// (the balcony placement), the placement → config.location / facade azimuth, and the map view (centre and
// width in metres, anchor ENU: x = east, y = north).
// ─────────────────────────────────────────────

/** The balcony on a facade: an edge of the own footprint and the distance of the balcony centre from its start. */
export interface Placement {
  edge: FacadeEdge;
  /** Metres from edge.a (the left end seen from outside, facing the facade) to the panel-row centre. */
  along: number;
}

/**
 * The location lies on a facade when it is at most this far from the edge line (m): the stored location is
 * rounded to 1e-6° (≤ 0.07 m), so an applied placement always matches.
 */
export const PLACEMENT_TOLERANCE_M = 0.25;
/** … and the facade azimuth (whole degrees, LIMITS) differs from the edge's outward normal by at most this. */
export const PLACEMENT_TOLERANCE_DEG = 0.5 + 1e-6;
/** Positions along a facade are set on this grid (m). */
export const ALONG_STEP = 0.1;
/**
 * The balcony centre stays this far from the facade's ends (m): the probe 0.5 m behind it (ownBuildingIds, the
 * own building of the prisms and of this plan) then lies inside the own footprint, not on a side wall.
 */
export const ALONG_INSET = 0.5;

/** Grid steps per metre (divide by it: 3 / 10 is exactly 0.3, unlike 3 · 0.1). */
const PER_M = Math.round(1 / ALONG_STEP);
const snapAlong = (v: number): number => Math.round(v * PER_M) / PER_M + 0;

/** The probe point 0.5 m behind the facade origin (anchor ENU), as surroundings.ts ownBuildingIds uses it. */
export function probePoint(origin: ReadonlyVertex, facadeAzimuth: number): Vertex {
  const [e, n] = facadeToEnu([0, OWN_BUILDING_EXCLUSION.probeN], facadeAzimuth);
  return [origin[0] + e, origin[1] + n];
}

/**
 * The building the site plan treats as the own building (not removed): `chosenId` (the user picked it in the
 * plan), else the one containing the probe behind the facade origin (the configured facade), else
 * `importedId` (the import's own building), else the one containing the location, else the nearest within
 * 25 m (model/buildings.ts findOwnBuilding). Null when none qualifies.
 */
export function sitePlanOwnBuilding(
  buildings: readonly Building[],
  origin: ReadonlyVertex | null,
  facadeAzimuth: number,
  importedId: string | null = null,
  chosenId: string | null = null,
): Building | null {
  const candidates = buildings.filter((b) => !b.removed && b.footprint.length >= 3);
  const byId = (id: string | null): Building | null =>
    (id !== null && candidates.find((b) => b.id === id)) || null;
  const chosen = byId(chosenId);
  if (chosen) return chosen;
  if (!origin) return byId(importedId);
  const [px, py] = probePoint(origin, facadeAzimuth);
  const behind = candidates.find((b) => pointInRing(b.footprint, px, py));
  if (behind) return behind;
  const imported = byId(importedId);
  if (imported) return imported;
  const i = findOwnBuilding(
    candidates.map((b) => b.footprint),
    origin,
  );
  return i >= 0 ? candidates[i] : null;
}

/** Facade candidates of the own building; party walls come from the other (not removed) buildings. */
export function ownFacadeEdges(own: Building, buildings: readonly Building[]): FacadeEdge[] {
  const others = buildings.filter((b) => b.id !== own.id && !b.removed).map((b) => b.footprint);
  return facadeEdges(own.footprint, others);
}

/**
 * Where the configured location sits: on a selectable edge (within PLACEMENT_TOLERANCE_M of it) whose outward
 * normal is the configured facade azimuth (within PLACEMENT_TOLERANCE_DEG). The nearest such edge; null when
 * the location is not on a facade of the own building (e.g. still the address point).
 */
export function currentPlacement(
  edges: readonly FacadeEdge[],
  origin: ReadonlyVertex,
  facadeAzimuth: number,
): Placement | null {
  let best: Placement | null = null;
  let bestD = PLACEMENT_TOLERANCE_M;
  for (const edge of edges) {
    if (!edge.selectable || Math.abs(angleDiff(edge.azimuth, facadeAzimuth)) > PLACEMENT_TOLERANCE_DEG)
      continue;
    const { t, distance } = projectOntoEdge(edge, origin);
    if (distance <= bestD) {
      bestD = distance;
      best = { edge, along: t * edge.length };
    }
  }
  return best;
}

/**
 * A first guess while the location is not on a facade (after an address pick): the selectable edge facing
 * closest to the configured facade azimuth (ties: the nearer, then the longer one), with the balcony where
 * the location projects onto it (its middle when that falls near or beyond an end). Null without selectable
 * edges.
 */
export function suggestedPlacement(
  edges: readonly FacadeEdge[],
  origin: ReadonlyVertex,
  facadeAzimuth: number,
): Placement | null {
  let best: { edge: FacadeEdge; key: number[] } | null = null;
  const before = (a: number[], b: number[]): boolean => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  };
  for (const edge of edges) {
    if (!edge.selectable) continue;
    // 5° buckets: nearly parallel edges count as facing the same way; then the nearer, then the longer one.
    const key = [
      Math.round(Math.abs(angleDiff(edge.azimuth, facadeAzimuth)) / 5),
      Math.round(projectOntoEdge(edge, origin).distance),
      -edge.length,
    ];
    if (!best || before(key, best.key)) best = { edge, key };
  }
  if (!best) return null;
  // Where the location projects onto the facade; outside its middle 90 % (clamped to an end) its middle.
  const { t } = projectOntoEdge(best.edge, origin);
  const along = t > 0.05 && t < 0.95 ? t * best.edge.length : best.edge.length / 2;
  return { edge: best.edge, along: clampAlong(best.edge, along) };
}

/** Range of `along` on an edge: ALONG_INSET from both ends, on the grid (the middle of a very short edge). */
export function alongRange(edge: Pick<FacadeEdge, 'length'>): { min: number; max: number } {
  const inset = Math.min(ALONG_INSET, edge.length / 2);
  const min = Math.ceil(inset * PER_M - 1e-9) / PER_M;
  const max = Math.floor((edge.length - inset) * PER_M + 1e-9) / PER_M;
  const mid = snapAlong(edge.length / 2);
  return max >= min ? { min, max } : { min: mid, max: mid };
}

/** `along` on the grid, within alongRange. */
export function clampAlong(edge: Pick<FacadeEdge, 'length'>, along: number): number {
  const { min, max } = alongRange(edge);
  return clamp(snapAlong(along), min, max);
}

/** A placement at the point of an edge nearest to `point` (anchor ENU), on the grid. */
export function placementAt(edge: FacadeEdge, point: ReadonlyVertex): Placement {
  const { t } = projectOntoEdge(edge, point);
  return { edge, along: clampAlong(edge, t * edge.length) };
}

/** Anchor ENU of the balcony centre of a placement. */
export function placementPoint(p: Placement): Vertex {
  return edgePoint(p.edge, p.edge.length > 0 ? p.along / p.edge.length : 0);
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/**
 * What a placement sets: config.location latitude/longitude (the balcony centre on the facade line, 1e-6°)
 * and building.facadeAzimuth (the edge's outward normal in whole degrees, 0…359).
 */
export function placementConfig(
  anchor: GeoPoint,
  p: Placement,
): { latitude: number; longitude: number; facadeAzimuth: number } {
  const [e, n] = placementPoint(p);
  const g = enuToLonLat(anchor, e, n);
  return {
    latitude: round6(g.latitude),
    longitude: round6(g.longitude),
    facadeAzimuth: normalizeDeg(Math.round(p.edge.azimuth)),
  };
}

/** Same edge and the same position (within half a grid step). */
export function samePlacement(a: Placement | null, b: Placement | null): boolean {
  if (!a || !b) return a === b;
  return a.edge.index === b.edge.index && Math.abs(a.along - b.along) < ALONG_STEP / 2;
}

// ── Map view ─────────────────────────────────

/** Visible part of the plan: centre (anchor ENU, m) and width (m). */
export interface MapView {
  cx: number;
  cy: number;
  /** Width of the view, m. */
  span: number;
}

/** Narrowest and widest view, m. */
export const MIN_SPAN = 8;
export const MAX_SPAN = 1500;
/** Initial view: at least this wide (m) … */
export const FIT_MIN_SPAN = 50;
/** … and this many times the own building's extent. */
const FIT_FACTOR = 2.2;

/** View width within MIN_SPAN … MAX_SPAN. */
export const clampSpan = (span: number): number => clamp(span, MIN_SPAN, MAX_SPAN);

/**
 * Initial view: centred on the own footprint (with the location), FIT_FACTOR times its extent and at least
 * FIT_MIN_SPAN wide; `aspect` = height / width of the map.
 */
export function fitView(
  footprint: readonly ReadonlyVertex[] | null,
  points: readonly ReadonlyVertex[],
  aspect: number,
): MapView {
  const all = [...(footprint ?? []), ...points];
  if (all.length === 0) return { cx: 0, cy: 0, span: FIT_MIN_SPAN * 2 };
  const [x0, y0, x1, y1] = ringBounds(all);
  const extent = Math.max(x1 - x0, (y1 - y0) / Math.max(aspect, 0.1));
  return {
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    span: clampSpan(Math.max(FIT_MIN_SPAN, extent * FIT_FACTOR)),
  };
}

/** The view zoomed by `factor` (> 1 = closer), keeping the world point `focus` where it is on screen. */
export function zoomView(view: MapView, factor: number, focus: ReadonlyVertex = [view.cx, view.cy]): MapView {
  const span = clampSpan(view.span / factor);
  const k = span / view.span;
  return { cx: focus[0] + (view.cx - focus[0]) * k, cy: focus[1] + (view.cy - focus[1]) * k, span };
}

/** Length of the scale bar: the largest 1, 2 or 5 × 10^k m not longer than `maxMetres`. */
export function scaleBarLength(maxMetres: number): number {
  if (!(maxMetres > 0)) return 0;
  const p = 10 ** Math.floor(Math.log10(maxMetres));
  for (const m of [5, 2, 1]) if (m * p <= maxMetres) return m * p;
  return p;
}
