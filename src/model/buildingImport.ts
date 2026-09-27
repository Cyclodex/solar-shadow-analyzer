import {
  ADJOINING_DISTANCE,
  edgePoint,
  facadeEdges,
  IMPORT_MAX_BUILDINGS,
  IMPORT_MAX_VERTICES,
  prismHorizonTangents,
  ringsDistance,
  sampleDirections,
  tanToDeg,
  type Prism,
} from './buildings';
import { LIMITS } from './defaults';
import {
  bridgeHoles,
  dropDuplicateVertices,
  ensureCcw,
  ringArea,
  ringBounds,
  ringDistance,
  simplifyRing,
  type ReadonlyVertex,
  type Vertex,
} from './polygon';
import { MAX_BUILDING_VERTICES, MIN_BUILDING_AREA } from './share';
import { clamp, toRad } from './units';

// ─────────────────────────────────────────────
// SWISSTOPO BUILDING IMPORT: CANDIDATES AND PRUNING (owned by the buildings feature, docs/ARCHITECTURE.md
// "Umgebung")
// Only the import job uses this (model/buildingImportJob.ts, in the building-import worker), so it stays out
// of the main chunk; the prism sweep, frames and facade edges it builds on are in buildings.ts.
// - Candidates: tile parts on the stored grid (courtyards bridged, simplified like sanitizeConfig).
// - Pruning: the buildings that set the horizon (argmax per sample) for the candidate facades of the own
//   building, plus the own building, its adjoining parts and near context, within the caps (planImport).
// ─────────────────────────────────────────────

/** Round to the 0.1 m grid of the stored footprints (−0 → 0). */
const dm = (v: number): number => Math.round(v * 10) / 10 + 0;

/**
 * Context radius, m: buildings whose footprint comes this close to the site are kept for the site plan and
 * the 3D view even when they set no horizon (the near field the 3D shadow fit covers, 60 m), within the caps.
 */
export const CONTEXT_RADIUS = 60;
/** Pruning observers: points along each candidate facade at most this far apart, m … */
export const STATION_SPACING = 3;
/** … and this far inside the facade's ends, m. */
export const STATION_INSET = 0;
/** Pruning observer heights: every PRUNE_HEIGHT_STEP m from PRUNE_HEIGHT_MIN up to the top, at most … */
export const PRUNE_HEIGHT_MIN = 0.5;
export const PRUNE_HEIGHT_STEP = 3;
export const PRUNE_MAX_HEIGHTS = 16;
/** Horizon step of the pruning sweeps, degrees (= FLOOR_HORIZON_STEP_DEG of the floor horizons). */
export const PRUNE_STEP_DEG = 0.5;

/** A building part prepared for storing: footprint on the stored grid, height and base. */
export interface ImportCandidate {
  /** Anchor ENU, 0.1 m grid, counter-clockwise, ≤ MAX_BUILDING_VERTICES, courtyards bridged (keyhole). */
  footprint: [number, number][];
  /** Height of the top above the base, m (LIMITS.neighbour.height). */
  height: number;
  /** Base above the site ground, m. */
  base: number;
}

/** Minimal shape of a vector-tile building part (buildingSources.ts BuildingPart). */
export interface PartLike {
  footprint: readonly ReadonlyVertex[];
  holes?: readonly (readonly ReadonlyVertex[])[];
  height: number;
  minHeight: number;
}

/**
 * Stored form of a part: courtyards bridged into one keyhole ring, 0.1 m grid (clamped to ±2000 m),
 * duplicates removed, counter-clockwise, simplified to MAX_BUILDING_VERTICES (like sanitizeConfig, so the
 * import stores what it scored); base = render_min_height, height = render_height − base. Null when the ring
 * degenerates (fewer than 3 vertices or less than MIN_BUILDING_AREA).
 */
export function importCandidate(part: PartLike): ImportCandidate | null {
  const L = LIMITS.neighbour;
  const raw = part.holes && part.holes.length > 0 ? bridgeHoles(part.footprint, part.holes) : part.footprint;
  let ring = ensureCcw(
    dropDuplicateVertices(
      raw.map((p): Vertex => [
        clamp(dm(p[0]), L.coord.min, L.coord.max),
        clamp(dm(p[1]), L.coord.min, L.coord.max),
      ]),
    ),
  );
  if (ring.length > MAX_BUILDING_VERTICES) ring = ensureCcw(simplifyRing(ring, MAX_BUILDING_VERTICES));
  if (ring.length < 3 || Math.abs(ringArea(ring)) < MIN_BUILDING_AREA) return null;
  const base = clamp(dm(part.minHeight), L.base.min, L.base.max);
  const height = clamp(dm(part.height - part.minHeight), L.height.min, L.height.max);
  return { footprint: ring, base, height };
}

/** A pruning observer station: a point on a candidate facade line and its facade azimuth. */
export interface PruneStation {
  /** Anchor ENU of the facade-frame origin (a point on the facade wall line), m. */
  origin: Vertex;
  facadeAzimuth: number;
}

/**
 * Pruning stations: points along every selectable facade of the own footprint, `spacing` m apart at most
 * (default STATION_SPACING), from `inset` m inside one end to `inset` m inside the other (default
 * STATION_INSET; the midpoint of a shorter facade), plus `extra` (e.g. the configured facade origin).
 */
export function pruneStations(
  ownFootprint: readonly ReadonlyVertex[] | null,
  others: readonly (readonly ReadonlyVertex[])[],
  extra: readonly PruneStation[] = [],
  opts: { spacing?: number; inset?: number } = {},
): PruneStation[] {
  const spacing = opts.spacing ?? STATION_SPACING;
  const inset = opts.inset ?? STATION_INSET;
  const out: PruneStation[] = [...extra];
  if (!ownFootprint) return out;
  for (const e of facadeEdges(ownFootprint, others)) {
    if (!e.selectable) continue;
    const usable = Math.max(0, e.length - 2 * inset);
    const k = usable > 0 ? Math.ceil(usable / spacing) + 1 : 1;
    for (let j = 0; j < k; j++) {
      const along = k === 1 ? e.length / 2 : inset + (usable * j) / (k - 1);
      out.push({ origin: edgePoint(e, along / e.length), facadeAzimuth: e.azimuth });
    }
  }
  return out;
}

/**
 * Observer heights of the pruning (m above ground): `required` (e.g. the configured floors) plus every
 * PRUNE_HEIGHT_STEP m from PRUNE_HEIGHT_MIN below `top` and `top` itself (the highest possible observer sees
 * the farthest buildings), at most PRUNE_MAX_HEIGHTS (the grid evenly thinned, keeping its ends; the required
 * ones stay), sorted.
 */
export function pruneHeights(top: number, required: readonly number[] = []): number[] {
  const t = Math.max(top, PRUNE_HEIGHT_MIN);
  const grid: number[] = [];
  for (let z = PRUNE_HEIGHT_MIN; z < t; z += PRUNE_HEIGHT_STEP) grid.push(z);
  grid.push(t);
  const req = [...new Set(required.filter((z) => Number.isFinite(z)))];
  const room = Math.max(2, PRUNE_MAX_HEIGHTS - req.length);
  const picked =
    grid.length <= room
      ? grid
      : Array.from({ length: room }, (_, i) => grid[Math.round((i * (grid.length - 1)) / (room - 1))]);
  return [...new Set([...req, ...picked])].sort((a, b) => a - b);
}

/**
 * Argmax tracking over stations × normal offsets × heights: for each footprint, the highest elevation
 * (degrees) at which it sets the horizon (is the highest prism of a sample) in the front half-space of some
 * station (|A − γ| < 90°: the sun behind the facade never reaches the panels). 0 = never sets it. Removing a
 * footprint with score s changes those horizons by at most s (the runner-up takes over), and not at all when
 * s = 0. `exclude` (e.g. the own part) never counts. Awaits `pause` between stations (keeps the page
 * responsive) and stops early (returning the scores so far) when `signal` is aborted.
 */
export async function horizonScores(
  footprints: readonly (readonly ReadonlyVertex[])[],
  tops: readonly number[],
  stations: readonly PruneStation[],
  heights: readonly number[],
  normalOffsets: readonly number[],
  opts: { exclude?: readonly number[]; pause?: () => Promise<void>; signal?: AbortSignal } = {},
): Promise<Float64Array> {
  const scores = new Float64Array(footprints.length);
  const excluded = new Set(opts.exclude ?? []);
  if (heights.length === 0) return scores;
  const minZ = Math.min(...heights);
  const offsets = normalOffsets.length > 0 ? normalOffsets : [0];
  const minN = Math.min(...offsets);
  for (const st of stations) {
    if (opts.signal?.aborted) break;
    const g = toRad(st.facadeAzimuth);
    const c = Math.cos(g);
    const s = Math.sin(g);
    const [ox, oy] = st.origin;
    // Facade-frame prisms of this station. Rays in front of the facade (dn > 0) never reach a prism lying
    // entirely at n ≤ the observer's n; one no higher than the lowest observer never rises above 0°.
    const prisms: Prism[] = [];
    const index: number[] = [];
    footprints.forEach((f, i) => {
      if (excluded.has(i) || !(tops[i] > minZ) || f.length < 3) return;
      const ring = new Float64Array(f.length * 2);
      let front = false;
      f.forEach(([e, n], k) => {
        const dx = e - ox;
        const dy = n - oy;
        const nn = dx * s + dy * c;
        ring[2 * k] = -dx * c + dy * s;
        ring[2 * k + 1] = nn;
        if (nn > minN) front = true;
      });
      if (!front) return;
      prisms.push({ ring, top: tops[i] });
      index.push(i);
    });
    if (prisms.length > 0) {
      const dirs = sampleDirections(PRUNE_STEP_DEG, st.facadeAzimuth);
      const owners = heights.map(() => new Int32Array(dirs.count));
      for (const nOff of offsets) {
        const tans = prismHorizonTangents(prisms, { u: 0, n: nOff }, heights, st.facadeAzimuth, {
          stepDeg: PRUNE_STEP_DEG,
          owners,
        });
        for (let h = 0; h < heights.length; h++) {
          const row = tans[h];
          const own = owners[h];
          for (let i = 0; i < dirs.count; i++) {
            const o = own[i];
            if (o < 0 || !(dirs.dn[i] > 1e-9)) continue; // nothing, or not in front of the facade
            const el = tanToDeg(row[i]);
            const k = index[o];
            if (el > scores[k]) scores[k] = el;
          }
        }
      }
    }
    if (opts.pause) await opts.pause();
  }
  return scores;
}

/** Why an imported building is kept. */
export type ImportReason = 'own' | 'adjoining' | 'horizon' | 'context';

export interface ImportPlan {
  /** Kept candidates in store order (own, adjoining, horizon setters by score, context by distance). */
  kept: { index: number; reason: ImportReason; score: number }[];
  /** Index of the own part among the candidates (−1 none). */
  own: number;
  /** Candidates that set some horizon (score > 0). */
  horizonSetters: number;
  /** Horizon setters dropped by the caps, and the largest horizon change that can cause (degrees). */
  droppedSetters: number;
  maxDroppedScore: number;
  /** Vertices of the kept footprints. */
  vertices: number;
}

export interface ImportPlanInput {
  candidates: readonly ImportCandidate[];
  /** Horizon scores per candidate (horizonScores). */
  scores: ArrayLike<number>;
  /** Own part (findOwnBuilding) or −1. */
  own: number;
  /** Site point (anchor ENU) for the context distance, usually [0, 0] (the import centre). */
  site: ReadonlyVertex;
  maxBuildings?: number;
  maxVertices?: number;
  contextRadius?: number;
}

/**
 * Which candidates to store, within maxBuildings / maxVertices (default IMPORT_MAX_*), in this order:
 * 1. the own part (site plan, facade candidates; excluded from its own horizon by ownBuildingIds);
 * 2. parts adjoining it (≤ ADJOINING_DISTANCE: the site plan tells party walls from facades with them);
 * 3. horizon setters by descending score (dropping the lowest ones first bounds the horizon change by the
 *    largest dropped score, reported as maxDroppedScore);
 * 4. context: the other parts within contextRadius of the site, nearest first (site plan and 3D view).
 * A candidate that does not fit is skipped and smaller later ones may still fit (greedy).
 */
export function planImport(input: ImportPlanInput): ImportPlan {
  const {
    candidates,
    scores,
    own,
    site,
    maxBuildings = IMPORT_MAX_BUILDINGS,
    maxVertices = IMPORT_MAX_VERTICES,
    contextRadius = CONTEXT_RADIUS,
  } = input;
  const kept: ImportPlan['kept'] = [];
  const taken = new Uint8Array(candidates.length);
  let vertices = 0;
  let droppedSetters = 0;
  let maxDroppedScore = 0;
  const take = (i: number, reason: ImportReason): boolean => {
    if (taken[i]) return true;
    const v = candidates[i].footprint.length;
    if (kept.length >= maxBuildings || vertices + v > maxVertices) return false;
    taken[i] = 1;
    vertices += v;
    kept.push({ index: i, reason, score: scores[i] ?? 0 });
    return true;
  };
  const distance = candidates.map((c) => ringDistance(c.footprint, site[0], site[1]));
  if (own >= 0 && own < candidates.length) {
    take(own, 'own');
    const ownRing = candidates[own].footprint;
    const [x0, y0, x1, y1] = ringBounds(ownRing);
    const r = ADJOINING_DISTANCE;
    candidates
      .map((c, i) => ({ i, c }))
      .filter(({ i, c }) => {
        if (i === own) return false;
        const [a0, b0, a1, b1] = ringBounds(c.footprint);
        return a0 <= x1 + r && a1 >= x0 - r && b0 <= y1 + r && b1 >= y0 - r;
      })
      .filter(({ c }) => ringsDistance(ownRing, c.footprint) <= r)
      .sort((p, q) => distance[p.i] - distance[q.i])
      .forEach(({ i }) => take(i, 'adjoining'));
  }
  const setters = candidates
    .map((_, i) => i)
    .filter((i) => (scores[i] ?? 0) > 0)
    .sort((p, q) => (scores[q] ?? 0) - (scores[p] ?? 0) || distance[p] - distance[q]);
  for (const i of setters) {
    if (!take(i, 'horizon')) {
      droppedSetters++;
      maxDroppedScore = Math.max(maxDroppedScore, scores[i] ?? 0);
    }
  }
  candidates
    .map((_, i) => i)
    .filter((i) => !taken[i] && distance[i] <= contextRadius)
    .sort((p, q) => distance[p] - distance[q])
    .forEach((i) => take(i, 'context'));
  return { kept, own, horizonSetters: setters.length, droppedSetters, maxDroppedScore, vertices };
}
