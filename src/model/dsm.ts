import type { HorizonProfile } from './types';
import {
  BUILDING_TILE_ZOOM,
  assembleBuildingParts,
  buildingTileUrl,
  decodeBuildingTile,
  maybeGunzip,
  tileToLonLat,
  tilesForRadius,
  type BuildingPart,
  type DecodedTile,
} from './buildingSources';
import {
  CogFormatError,
  RangeNotSupportedError,
  cogTilesForWindow,
  copyTileInto,
  decodeCogTile,
  fetchByteRange,
  fetchCogHeader,
  mergeCogRanges,
  type CogImage,
  type CogRange,
} from './cog';
import { facadeToEnu, enuToFacade, type GeoPoint } from './enu';
import { NetError, fetchBytesWithRetry, fetchReadWithRetry, type RetryOptions } from './fetchRetry';
import { FLOOR_HORIZON_STEP_DEG } from './horizon';
import { lv95LocalFrame, lv95ToWgs84, wgs84ToLv95, type Lv95Point } from './lv95';
import { pointInRing, ringBounds, ringDistance, type ReadonlyVertex } from './polygon';
import { OWN_BUILDING_EXCLUSION, ownExclusionZone, type OwnExclusionZone } from './surroundings';
import { toRad } from './units';

// ─────────────────────────────────────────────
// LASER-SCAN (swissSURFACE3D) HORIZON
// docs/ARCHITECTURE.md, "Umgebung: Adresse, Laserscan, Gebäude". Runs in the terrain worker (workers/*): the
// page sends a job (site + observer groups), this module finds the scan tiles (STAC v1, newest year per 1 km
// tile), reads the full-resolution window (radius + DSM_WINDOW_MARGIN_M around the site, LV95) from up to four
// COGs (model/cog.ts), replaces masked cells by the ground (swissALTI3D 2 m) and ray-marches every observer.
//
// Geometry: the window is a grid in LV95 (0.5 m cells, the files' own lattice). Rays are cast at true-north
// azimuths in ENU metres around config.location and mapped into LV95 by lv95LocalFrame (convergence and scale:
// ≤ 1 cm within 300 m). Observer = panel-row centre of a floor (facade frame u = 0, n, z above the ground at the
// location); ground from the height service (api3.geo.admin.ch, the DTM at the point) or, if that fails, the
// 2 m DTM. Horizon angle = atan2(z_dsm − (ground + z), d); scan and ground are both LHN95 heights (never mixed
// with Terrarium heights).
// Sampling (binding): steps of DSM_RAY_STEP_M = 0.25 m out to the radius, nearest cell, and per output azimuth
// (FLOOR_HORIZON_STEP_DEG = 0.5°) the maximum over DSM_SUB_RAYS + 1 rays spread across that azimuth's bin
// (± 0.25°): thin objects between two ray directions (tree crowns, poles, edges) are not lost, so the horizon
// errs on the high side. The research measured RMS 0.77–15.8° for one ray per 1° against the maximum over all
// cells of the bin; dsm.test.ts compares the result with such a brute force over every cell.
// Own building (surroundings.ts ownExclusionZone): samples behind the facade plane (n < 0.5 m) and in the own
// balcony zone (0 ≤ n ≤ balcony depth + 0.5 m within the own building's extent along the facade) are skipped.
// Masks: cells of removed or edited buildings (dsmMaskPolygons) and, without trees, every cell outside the union
// of all swisstopo building footprints (vector tiles, fetched here) become ground, except outside CH/FL where
// the footprints are missing (DecodedTile.outside).
// Worker memory: parsed headers, compressed tiles (for small site moves and aborted loads), the window mosaic,
// the ground model and the masked raster of the last site stay in memory, so new observers (tilt, floors) and
// new masks are recomputed without refetching. Nothing here throws: jobs return typed results.
// ─────────────────────────────────────────────

/** STAC v1 items endpoint of a collection. */
export function stacItemsUrl(collection: string): string {
  return `https://data.geo.admin.ch/api/stac/v1/collections/${collection}/items`;
}
/** Surface model (buildings, trees): swissSURFACE3D Raster, 0.5 m. */
export const DSM_COLLECTION = 'ch.swisstopo.swisssurface3d-raster';
export const DSM_ASSET_SUFFIX = '_0.5_2056_5728.tif';
/** Terrain model (ground under masked cells): swissALTI3D, 2 m. */
export const DTM_COLLECTION = 'ch.swisstopo.swissalti3d';
export const DTM_ASSET_SUFFIX = '_2_2056_5728.tif';
/** Point height (ground at the site). */
export const HEIGHT_SERVICE_URL = 'https://api3.geo.admin.ch/rest/services/height';
/** Extent of the swissSURFACE3D Raster collection [west, south, east, north] (STAC, 2026-09-25). */
export const DSM_COLLECTION_BBOX: readonly [number, number, number, number] = [
  5.9503666, 45.7213375, 10.4998461, 47.8216742,
];
/** Distance between samples along a ray, m. */
export const DSM_RAY_STEP_M = 0.25;
/** Ray intervals per output azimuth step (the bin max takes DSM_SUB_RAYS + 1 rays, the edges shared). */
export const DSM_SUB_RAYS = 4;
/**
 * Window margin around radius, m: observers sit up to balcony depth (≤ 4 m) + half a panel (≤ 1.25 m) in front
 * of the site, and their rays reach `radius` from there.
 */
export const DSM_WINDOW_MARGIN_M = 8;
/**
 * Ground masks of removed/edited buildings reach this far beyond the footprint, m: the vector-tile footprints
 * leave roof edges outside (see ARCHITECTURE, measured at Breitenrain), which would otherwise stay as a rim
 * at roof height.
 */
export const DSM_REMOVE_BUFFER_M = 1;
/** Without trees, cells up to this far outside a building footprint keep the scan (roof edges), m. */
export const DSM_KEEP_BUFFER_M = 1;
/** Bump when the computation changes: cached horizons of older versions are ignored. */
export const DSM_ALGORITHM_VERSION = 1;

/** Largest pages followed per STAC query. */
const STAC_MAX_PAGES = 10;
/** Parallel range requests. */
const RANGE_CONCURRENCY = 4;
/** Tiles closer than this in the file are fetched with one range (GDAL: 8 bytes between tiles). */
const RANGE_MERGE_GAP = 1024;
/** Upper size of a merged range (one DSM tile ≈ 0.54 MB is a range of its own). */
const RANGE_MERGE_MAX = 640_000;
/** Compressed tiles kept in memory (bytes). */
const TILE_CACHE_BYTES = 24_000_000;

const JSON_RETRY: Omit<RetryOptions, 'signal' | 'fetchImpl'> = {
  retries: 3,
  maxDelayMs: 4000,
  deadlineMs: 20000,
  attemptTimeoutMs: 15000,
};
/** A 0.54 MB range needs 8.6 s at 0.5 Mbit/s: allow 30 s per attempt, retry within a minute. */
const RANGE_RETRY: Omit<RetryOptions, 'signal' | 'fetchImpl'> = {
  retries: 3,
  maxDelayMs: 4000,
  deadlineMs: 60000,
  attemptTimeoutMs: 30000,
};
const VECTOR_TILE_RETRY: Omit<RetryOptions, 'signal' | 'fetchImpl'> = {
  retries: 3,
  maxDelayMs: 4000,
  deadlineMs: 15000,
  attemptTimeoutMs: 10000,
};

// ── Job types ────────────────────────────────

/** Own-building exclusion inputs (surroundings.ts ownExclusionZone). */
export interface DsmExclusion {
  balconyDepthM: number;
  rowWidthM: number;
  /**
   * Own footprint(s) in the facade frame [u, n] (stored buildings containing the probe point), null when
   * unknown: then the vector tiles decide if they are loaded (trees off), else ± (rowWidth / 2 + 2 m).
   */
  ownFootprint: [number, number][] | null;
}

/** Everything the scan horizons depend on besides the observers (compare dsmHorizon.ts surfaceSiteKey). */
export interface DsmSite {
  /** The facade origin (config.location), degrees. */
  latitude: number;
  longitude: number;
  facadeAzimuth: number;
  /** Traced radius, m. */
  radius: number;
  /** false: cells outside building footprints become ground. */
  trees: boolean;
  /** Footprints (anchor ENU) whose cells become ground: dsmMaskPolygons with their anchor. */
  masks: { anchor: GeoPoint; polygons: [number, number][][] } | null;
  exclusion: DsmExclusion;
}

/** Observers sharing a panel-row position: facade frame u = 0, `n` m out, `heights` m above the ground. */
export interface DsmObserverGroup {
  n: number;
  heights: number[];
}

export interface DsmJobRequest {
  site: DsmSite;
  groups: DsmObserverGroup[];
}

export interface DsmSiteInfo {
  /** Acquisition years of the scan tiles used, ascending. */
  dataYears: number[];
  /** Bytes of the data used (headers, scan and ground tiles, vector tiles, STAC, height). */
  bytes: number;
  /** Share of the circle (radius around the site) covered by scan data, 0–1 (0.001). */
  coverage: number;
  /** Ground at the site (LHN95), m, and where it came from. */
  ground: number;
  groundSource: 'height-service' | 'terrain-model';
  /** Scan files and internal tiles read. */
  files: number;
  tiles: number;
}

export interface DsmStats {
  /** HTTP requests made by this job (every attempt). */
  requests: number;
  /** Bytes downloaded by this job (0 when everything came from memory). */
  downloaded: number;
  ms: { stac: number; download: number; decode: number; mask: number; rays: number; total: number };
}

export type DsmErrorKind = 'aborted' | 'network' | 'http' | 'timeout' | 'data';

export interface DsmError {
  kind: DsmErrorKind;
  /** Technical message (English). */
  message: string;
  status?: number;
}

export type DsmJobResult =
  | {
      status: 'ok';
      /** Per group, per height: the horizon (step FLOOR_HORIZON_STEP_DEG, degrees ≥ 0). */
      horizons: HorizonProfile[][];
      info: DsmSiteInfo;
      stats: DsmStats;
    }
  /** No scan data at the site (outside CH/FL). */
  | { status: 'unavailable'; stats: DsmStats }
  | { status: 'error'; error: DsmError; stats: DsmStats };

export interface DsmProgress {
  /** 0…1 over download and computation. */
  fraction: number;
  /** Bytes downloaded so far and in total (0 when nothing needs downloading). */
  bytes: number;
  totalBytes: number;
}

export interface DsmJobOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (p: DsmProgress) => void;
  /** Retry parameters for every request (tests: instant sleep). */
  retry?: Omit<RetryOptions, 'signal' | 'fetchImpl'>;
}

// ── STAC ─────────────────────────────────────

/** A 1 km scan or terrain tile from STAC. */
export interface StacTile {
  /** LV95 km of the south-west corner, 'EEEE-NNNN'. */
  key: string;
  east: number;
  north: number;
  year: number;
  href: string;
}

const ITEM_ID_RE = /_(\d{4})_(\d{4})-(\d{4})$/;

/** Tiles of one STAC items page (asset ending in `assetSuffix`) and the next page's URL. */
export function parseStacItems(
  json: unknown,
  assetSuffix: string,
): { tiles: StacTile[]; next: string | null } {
  const tiles: StacTile[] = [];
  const root = (json ?? {}) as { features?: unknown; links?: unknown };
  const features = Array.isArray(root.features) ? (root.features as unknown[]) : [];
  for (const f of features) {
    const item = (f ?? {}) as { id?: unknown; assets?: unknown };
    const m = typeof item.id === 'string' ? ITEM_ID_RE.exec(item.id) : null;
    if (!m || typeof item.assets !== 'object' || item.assets === null) continue;
    for (const [name, asset] of Object.entries(item.assets as Record<string, unknown>)) {
      const href = (asset as { href?: unknown } | null)?.href;
      if (!name.endsWith(assetSuffix) || typeof href !== 'string') continue;
      const east = Number(m[2]) * 1000;
      const north = Number(m[3]) * 1000;
      tiles.push({ key: `${m[2]}-${m[3]}`, east, north, year: Number(m[1]), href });
    }
  }
  const links = Array.isArray(root.links) ? (root.links as unknown[]) : [];
  const next = links.find((l) => (l as { rel?: unknown } | null)?.rel === 'next') as
    { href?: unknown } | undefined;
  return { tiles, next: typeof next?.href === 'string' ? next.href : null };
}

/** The newest year of every tile key (ties: the later entry), sorted by key. */
export function newestPerTile(tiles: readonly StacTile[]): StacTile[] {
  const best = new Map<string, StacTile>();
  for (const t of tiles) {
    const b = best.get(t.key);
    if (!b || t.year >= b.year) best.set(t.key, t);
  }
  return [...best.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ── Grids ────────────────────────────────────

/** A north-up LV95 grid: cell (i, j) spans x0 + i·cell … and y1 − j·cell downwards. */
export interface GridSpec {
  x0: number;
  y1: number;
  cell: number;
  width: number;
  height: number;
}

export interface Raster extends GridSpec {
  /** Heights (m, LHN95), NaN = no data. Row-major from the north-west. */
  data: Float32Array;
}

/** Grid on the `cell` lattice covering the square of half-size `half` around `center`. */
export function gridAround(center: Lv95Point, half: number, cell: number): GridSpec {
  const x0 = Math.floor((center.east - half) / cell) * cell;
  const x1 = Math.ceil((center.east + half) / cell) * cell;
  const y0 = Math.floor((center.north - half) / cell) * cell;
  const y1 = Math.ceil((center.north + half) / cell) * cell;
  return { x0, y1, cell, width: Math.round((x1 - x0) / cell), height: Math.round((y1 - y0) / cell) };
}

const gridKey = (g: GridSpec): string => `${g.x0}|${g.y1}|${g.cell}|${g.width}|${g.height}`;

/** Bilinear value at (x, y) from cell centres; NaN neighbours are left out (NaN if all are). */
export function sampleBilinear(r: Raster, x: number, y: number): number {
  const fx = (x - r.x0) / r.cell - 0.5;
  const fy = (r.y1 - y) / r.cell - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const ax = fx - i;
  const ay = fy - j;
  let sum = 0;
  let wsum = 0;
  for (let dj = 0; dj <= 1; dj++) {
    for (let di = 0; di <= 1; di++) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= r.width || jj >= r.height) continue;
      const v = r.data[jj * r.width + ii];
      if (v !== v) continue;
      const w = (di ? ax : 1 - ax) * (dj ? ay : 1 - ay);
      sum += w * v;
      wsum += w;
    }
  }
  return wsum > 1e-9 ? sum / wsum : NaN;
}

/**
 * Sets `mask` cells whose centre lies inside the polygon (outer ring + holes, even-odd) to `value`
 * (scanline). Coordinates in the grid's LV95 metres.
 */
export function fillPolygon(
  g: GridSpec,
  rings: readonly (readonly ReadonlyVertex[])[],
  mask: Uint8Array,
  value: number,
): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const p of r) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  if (!(maxY > minY)) return;
  const j0 = Math.max(0, Math.floor((g.y1 - maxY) / g.cell - 0.5));
  const j1 = Math.min(g.height - 1, Math.ceil((g.y1 - minY) / g.cell - 0.5));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const yc = g.y1 - (j + 0.5) * g.cell;
    xs.length = 0;
    for (const r of rings) {
      for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
        const [xa, ya] = r[a];
        const [xb, yb] = r[b];
        if (ya > yc !== yb > yc) xs.push(xa + ((yc - ya) * (xb - xa)) / (yb - ya));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.cell - 0.5));
      const i1 = Math.min(g.width - 1, Math.ceil((xs[k + 1] - g.x0) / g.cell - 0.5) - 1);
      for (let i = i0; i <= i1; i++) mask[j * g.width + i] = value;
    }
  }
}

/** Like fillPolygon for one ring, plus every cell whose centre is within `buffer` m of it. */
export function fillPolygonBuffered(
  g: GridSpec,
  ring: readonly ReadonlyVertex[],
  buffer: number,
  mask: Uint8Array,
  value: number,
): void {
  fillPolygon(g, [ring], mask, value);
  if (!(buffer > 0) || ring.length < 2) return;
  const [bx0, by0, bx1, by1] = ringBounds(ring);
  const i0 = Math.max(0, Math.floor((bx0 - buffer - g.x0) / g.cell));
  const i1 = Math.min(g.width - 1, Math.floor((bx1 + buffer - g.x0) / g.cell));
  const j0 = Math.max(0, Math.floor((g.y1 - by1 - buffer) / g.cell));
  const j1 = Math.min(g.height - 1, Math.floor((g.y1 - by0 + buffer) / g.cell));
  for (let j = j0; j <= j1; j++) {
    const yc = g.y1 - (j + 0.5) * g.cell;
    for (let i = i0; i <= i1; i++) {
      const k = j * g.width + i;
      if (mask[k] === value) continue;
      if (ringDistance(ring, g.x0 + (i + 0.5) * g.cell, yc) <= buffer) mask[k] = value;
    }
  }
}

/**
 * Sets every cell whose centre lies within `radius` m of the centre of a set cell (morphological dilation with a
 * disk; only cells on the edge of the set region spread).
 */
export function dilateMask(g: GridSpec, mask: Uint8Array, radius: number): void {
  const rc = radius / g.cell;
  const reach = Math.floor(rc + 1e-9);
  if (reach < 1) return;
  const offsets: [number, number][] = [];
  for (let dj = -reach; dj <= reach; dj++) {
    for (let di = -reach; di <= reach; di++) if (di * di + dj * dj <= rc * rc + 1e-9) offsets.push([di, dj]);
  }
  const src = mask.slice();
  const { width: w, height: h } = g;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (!src[k]) continue;
      const edge =
        (i > 0 && !src[k - 1]) ||
        (i < w - 1 && !src[k + 1]) ||
        (j > 0 && !src[k - w]) ||
        (j < h - 1 && !src[k + w]);
      if (!edge) continue;
      for (const [di, dj] of offsets) {
        const ii = i + di;
        const jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < w && jj < h) mask[jj * w + ii] = 1;
      }
    }
  }
}

/** Share of the cells of the circle (radius m around `center`) with data, 0–1 rounded to 0.001. */
export function circleCoverage(r: Raster, center: Lv95Point, radius: number): number {
  let total = 0;
  let valid = 0;
  const r2 = radius * radius;
  for (let j = 0; j < r.height; j++) {
    const dy = r.y1 - (j + 0.5) * r.cell - center.north;
    if (dy * dy > r2) continue;
    for (let i = 0; i < r.width; i++) {
      const dx = r.x0 + (i + 0.5) * r.cell - center.east;
      if (dx * dx + dy * dy > r2) continue;
      total++;
      const v = r.data[j * r.width + i];
      if (v === v) valid++;
    }
  }
  return total > 0 ? Math.round((valid / total) * 1000) / 1000 : 0;
}

// ── Ray march ────────────────────────────────

/** Geometry of one ray march: site frame, ground and exclusion. */
export interface MarchGeometry {
  /** ENU metres around the site (true north) → LV95. */
  toLv95: (east: number, north: number) => Lv95Point;
  facadeAzimuth: number;
  /** Ground at the site, m (same datum as the raster). */
  ground: number;
  radius: number;
  zone: OwnExclusionZone;
}

export interface MarchOptions {
  stepDeg?: number;
  subRays?: number;
  rayStep?: number;
}

/**
 * Horizon of every height of one observer group (index = height): rays from (u = 0, n) in the facade frame,
 * DSM_RAY_STEP_M steps up to the radius, nearest cell, samples in the own-building zone skipped; each output
 * azimuth takes the maximum of the subRays + 1 rays across its bin (± stepDeg / 2). Degrees ≥ 0.
 */
export function marchDsmHorizons(
  raster: Raster,
  geo: MarchGeometry,
  group: DsmObserverGroup,
  opts: MarchOptions = {},
): HorizonProfile[] {
  const stepDeg = opts.stepDeg ?? FLOOR_HORIZON_STEP_DEG;
  const sub = Math.max(1, Math.round(opts.subRays ?? DSM_SUB_RAYS));
  const rayStep = opts.rayStep ?? DSM_RAY_STEP_M;
  const nOut = Math.max(1, Math.round(360 / stepDeg));
  const outStep = 360 / nOut;
  const nRays = nOut * sub;
  const nH = group.heights.length;
  const zo = Float64Array.from(group.heights, (h) => geo.ground + h);
  const best = new Float64Array(nRays * nH);
  const { data, width: w, height: hgt, cell, x0, y1 } = raster;
  // Affine ENU → LV95 (directions) and the observer.
  const p0 = geo.toLv95(0, 0);
  const pe = geo.toLv95(1, 0);
  const pn = geo.toLv95(0, 1);
  const a = pe.east - p0.east;
  const c = pe.north - p0.north;
  const b = pn.east - p0.east;
  const d = pn.north - p0.north;
  const [oe, on] = facadeToEnu([0, group.n], geo.facadeAzimuth);
  const o = geo.toLv95(oe, on);
  const fx0 = (o.east - x0) / cell;
  const fy0 = (y1 - o.north) / cell;
  const kMax = Math.floor(geo.radius / rayStep + 1e-9);
  const { behindN, balconyN, u0, u1 } = geo.zone;
  const nObs = group.n;
  const EPS = 1e-12;
  for (let r = 0; r < nRays; r++) {
    const az = toRad((r * outStep) / sub);
    const s = Math.sin(az);
    const co = Math.cos(az);
    const dx = a * s + b * co;
    const dy = c * s + d * co;
    const rel = az - toRad(geo.facadeAzimuth);
    const du = -Math.sin(rel);
    const dn = Math.cos(rel);
    // Samples in front of the facade plane: n(t) = nObs + t·dn ≥ behindN.
    let tLo = rayStep;
    let tHi = geo.radius;
    if (dn > EPS) tLo = Math.max(tLo, (behindN - nObs) / dn);
    else if (dn < -EPS) tHi = Math.min(tHi, (behindN - nObs) / dn);
    else if (nObs < behindN) continue;
    // Own balcony zone: u ∈ [u0, u1] (u(t) = t·du) and n(t) ≤ balconyN → skipped interval [tIn, tOut].
    let tIn = -Infinity;
    let tOut = Infinity;
    if (Math.abs(du) > EPS) {
      const ta = u0 / du;
      const tb = u1 / du;
      tIn = Math.max(tIn, Math.min(ta, tb));
      tOut = Math.min(tOut, Math.max(ta, tb));
    } else if (u0 > 0 || u1 < 0) {
      tIn = Infinity;
    }
    if (dn > EPS) tOut = Math.min(tOut, (balconyN - nObs) / dn);
    else if (dn < -EPS) tIn = Math.max(tIn, (balconyN - nObs) / dn);
    else if (nObs > balconyN) tIn = Infinity;
    const kLo = Math.max(1, Math.ceil(tLo / rayStep - 1e-9));
    const kHi = Math.min(kMax, Math.floor(tHi / rayStep + 1e-9));
    let kIn = Infinity;
    let kOut = -Infinity;
    if (tIn <= tOut) {
      kIn = Math.ceil(tIn / rayStep - 1e-9);
      kOut = Math.floor(tOut / rayStep + 1e-9);
    }
    const sx = (rayStep * dx) / cell;
    const sy = (-rayStep * dy) / cell;
    const base = r * nH;
    for (let k = kLo; k <= kHi; k++) {
      if (k >= kIn && k <= kOut) {
        k = kOut;
        continue;
      }
      const fx = fx0 + k * sx;
      const fy = fy0 + k * sy;
      if (fx < 0 || fy < 0 || fx >= w || fy >= hgt) break; // left the window (the observer is inside it)
      const z = data[(fy | 0) * w + (fx | 0)];
      if (z !== z) continue;
      const inv = 1 / (k * rayStep);
      for (let h = 0; h < nH; h++) {
        const v = (z - zo[h]) * inv;
        if (v > best[base + h]) best[base + h] = v;
      }
    }
  }
  const half = sub / 2;
  const out: HorizonProfile[] = [];
  for (let h = 0; h < nH; h++) {
    const e = new Array<number>(nOut);
    for (let i = 0; i < nOut; i++) {
      let m = 0;
      // Rays from −stepDeg/2 to +stepDeg/2 around the output azimuth (odd `sub`: the nearest ones inside).
      for (let q = Math.ceil(i * sub - half); q <= Math.floor(i * sub + half); q++) {
        const rr = ((q % nRays) + nRays) % nRays;
        const v = best[rr * nH + h];
        if (v > m) m = v;
      }
      e[i] = (Math.atan(m) * 180) / Math.PI;
    }
    out.push({ stepDeg: outStep, elevations: e });
  }
  return out;
}

// ── Download estimate (UI) ───────────────────

/**
 * Mean size of a full-resolution DSM tile (512 × 512 px, LZW), bytes: the 16 tiles of swisssurface3d-raster
 * 2023 2601-1200 (Bern), research 2026-09-25. Built-up areas; forests and fields compress differently.
 */
export const MEAN_DSM_TILE_BYTES = 543_487;
/** Mean 2 m DTM tile (128 × 128 px): swissalti3d 2025 2601-1200, 763,208 B / 16 tiles (2026-09-25). */
export const MEAN_DTM_TILE_BYTES = 47_700;
/** Mean swisstopo vector tile (z14): Kramgasse 49, Bern, 694 kB / 4 tiles (2026-09-25). */
export const MEAN_VECTOR_TILE_BYTES = 173_500;
/** Header range per COG file. */
const HEADER_BYTES = 16_384;

/** Tile edges within one km of the scan and 2 m terrain files (2000 / 500 px in 512 / 128 px tiles). */
const KM_TILE_EDGES = [0, 256, 512, 768, 1000];

/** Mean number of intervals of a periodic partition (period, edges) hit by a random interval of `length`. */
function meanIntervalsHit(length: number, edges: readonly number[], period: number): number {
  const samples = 4000;
  let sum = 0;
  for (let k = 0; k < samples; k++) {
    const s = ((k + 0.5) / samples) * period;
    const e = s + length;
    let n = 0;
    for (let base = 0; base < e; base += period) {
      for (let q = 0; q + 1 < edges.length; q++) {
        const lo = base + edges[q];
        const hi = base + edges[q + 1];
        if (hi > s && lo < e) n++;
      }
    }
    sum += n;
  }
  return sum / samples;
}

/**
 * Expected download for a site (bytes): scan tiles of the square window (radius + margin) at a random
 * position on the swisstopo tile grid × MEAN_DSM_TILE_BYTES, plus the headers; with `ground` (masks or trees
 * off) the 2 m terrain tiles, with `vectorTiles` (trees off) the building tiles (z14, 1.67 km at 47° N).
 * An estimate: real sites vary (research: 4.9–8.8 MB at 300 m for six sites).
 */
export function estimateDsmBytes(
  radius: number,
  opts: { ground?: boolean; vectorTiles?: boolean } = {},
): number {
  const key = `${radius}|${opts.ground === true}|${opts.vectorTiles === true}`;
  let bytes = estimates.get(key);
  if (bytes === undefined) {
    bytes = estimate(radius, opts);
    estimates.set(key, bytes);
  }
  return bytes;
}

const estimates = new Map<string, number>();

function estimate(radius: number, opts: { ground?: boolean; vectorTiles?: boolean }): number {
  const side = 2 * (radius + DSM_WINDOW_MARGIN_M);
  const tiles = meanIntervalsHit(side, KM_TILE_EDGES, 1000) ** 2;
  const files = meanIntervalsHit(side, [0, 1000], 1000) ** 2;
  let bytes = tiles * MEAN_DSM_TILE_BYTES + files * HEADER_BYTES;
  if (opts.ground) bytes += tiles * MEAN_DTM_TILE_BYTES + files * HEADER_BYTES;
  if (opts.vectorTiles) bytes += meanIntervalsHit(side, [0, 1670], 1670) ** 2 * MEAN_VECTOR_TILE_BYTES;
  return bytes;
}

// ── Worker memory ────────────────────────────

/** Least-recently-used map with a size budget. */
class Lru<V> {
  private readonly map = new Map<string, { v: V; size: number }>();
  private total = 0;
  constructor(
    private readonly maxEntries: number,
    private readonly maxSize = Infinity,
  ) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.v;
  }
  set(key: string, v: V, size = 1): void {
    const old = this.map.get(key);
    if (old) {
      this.total -= old.size;
      this.map.delete(key);
    }
    this.map.set(key, { v, size });
    this.total += size;
    while (this.map.size > this.maxEntries || (this.total > this.maxSize && this.map.size > 1)) {
      const [k, e] = this.map.entries().next().value as [string, { v: V; size: number }];
      this.map.delete(k);
      this.total -= e.size;
    }
  }
  clear(): void {
    this.map.clear();
    this.total = 0;
  }
}

interface MosaicData {
  raster: Raster;
  /** Tiles (STAC) the mosaic was read from. */
  tiles: StacTile[];
  /** Bytes of headers and tiles. */
  bytes: number;
  cogTiles: number;
}

const headerCache = new Lru<{ image: CogImage; bytes: number }>(32);
const tileBytesCache = new Lru<Uint8Array>(256, TILE_CACHE_BYTES);
const stacCache = new Lru<{ tiles: StacTile[]; bytes: number }>(16);
const mosaicCache = new Lru<MosaicData>(3);
const groundCache = new Lru<number>(64);
const vectorTileCache = new Lru<{ tile: DecodedTile; bytes: number }>(16);
const maskedCache = new Lru<{ raster: Raster; zone: OwnExclusionZone | null; extraBytes: number }>(1);

/** Forgets everything kept in memory (tests). */
export function clearDsmCaches(): void {
  for (const c of [
    headerCache,
    tileBytesCache,
    stacCache,
    mosaicCache,
    groundCache,
    vectorTileCache,
    maskedCache,
  ]) {
    c.clear();
  }
}

// ── Loading ──────────────────────────────────

/** State of one job: options, statistics and download progress. */
interface Ctx {
  opts: DsmJobOptions;
  signal: AbortSignal | undefined;
  fetchImpl: typeof fetch;
  stats: DsmStats;
  /** Bytes to download and downloaded (progress). */
  plan: number;
  done: number;
  /** Reports the progress so far (download, then computation). */
  report: () => void;
}

class AbortedError extends Error {}

function checkAbort(ctx: Ctx): void {
  if (ctx.signal?.aborted) throw new AbortedError('The laser-scan load was aborted.');
}

function retryOpts(ctx: Ctx, base: Omit<RetryOptions, 'signal' | 'fetchImpl'>): RetryOptions {
  return { ...base, ...ctx.opts.retry, signal: ctx.signal, fetchImpl: ctx.fetchImpl };
}

async function timed<T>(ctx: Ctx, key: keyof DsmStats['ms'], run: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await run();
  } finally {
    ctx.stats.ms[key] += performance.now() - t0;
  }
}

/** WGS84 bbox [w, s, e, n] of an LV95 grid (corners, padded by 0.0005°). */
function gridBboxWgs(g: GridSpec): [number, number, number, number] {
  const x1 = g.x0 + g.width * g.cell;
  const y0 = g.y1 - g.height * g.cell;
  const corners = [
    lv95ToWgs84(g.x0, y0),
    lv95ToWgs84(x1, y0),
    lv95ToWgs84(g.x0, g.y1),
    lv95ToWgs84(x1, g.y1),
  ];
  const pad = 0.0005;
  const r = (v: number): number => Math.round(v * 1e6) / 1e6;
  return [
    r(Math.min(...corners.map((p) => p.longitude)) - pad),
    r(Math.min(...corners.map((p) => p.latitude)) - pad),
    r(Math.max(...corners.map((p) => p.longitude)) + pad),
    r(Math.max(...corners.map((p) => p.latitude)) + pad),
  ];
}

/** Newest STAC tiles of `collection` intersecting the grid (every page of the bbox query). */
async function stacTiles(ctx: Ctx, collection: string, suffix: string, g: GridSpec): Promise<StacTile[]> {
  const bbox = gridBboxWgs(g);
  const first = `${stacItemsUrl(collection)}?bbox=${bbox.join(',')}&limit=100`;
  let hit = stacCache.get(first);
  if (!hit) {
    const all: StacTile[] = [];
    let bytes = 0;
    let url: string | null = first;
    for (let page = 0; url && page < STAC_MAX_PAGES; page++) {
      checkAbort(ctx);
      const pageUrl: string = url;
      const { json, size } = await fetchReadWithRetry(
        pageUrl,
        async (res) => {
          const text = await res.text();
          return { json: JSON.parse(text) as unknown, size: text.length };
        },
        retryOpts(ctx, JSON_RETRY),
      );
      bytes += size;
      ctx.stats.downloaded += size;
      const parsed = parseStacItems(json, suffix);
      all.push(...parsed.tiles);
      url = parsed.next;
    }
    hit = { tiles: newestPerTile(all), bytes };
    stacCache.set(first, hit);
  }
  const x1 = g.x0 + g.width * g.cell;
  const y0 = g.y1 - g.height * g.cell;
  return hit.tiles.filter(
    (t) => t.east < x1 && t.east + 1000 > g.x0 && t.north < g.y1 && t.north + 1000 > y0,
  );
}

async function cogHeader(ctx: Ctx, href: string): Promise<{ image: CogImage; bytes: number }> {
  const hit = headerCache.get(href);
  if (hit) return hit;
  const h = await fetchCogHeader(href, retryOpts(ctx, RANGE_RETRY));
  ctx.stats.downloaded += h.bytes;
  const entry = { image: h.image, bytes: h.bytes };
  headerCache.set(href, entry);
  return entry;
}

/** Runs `tasks` with at most `limit` at once; the first failure rejects (the others stop starting). */
async function runLimited(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (next < tasks.length && !failed) {
      const task = tasks[next++];
      try {
        await task();
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

/**
 * Mosaic of the grid from the files (newest tile per km), NaN where no file has data. Tiles are fetched in
 * merged ranges (compressed bytes kept in memory) and decoded as they arrive.
 */
async function readMosaic(ctx: Ctx, grid: GridSpec, files: readonly StacTile[]): Promise<MosaicData> {
  const key = `${gridKey(grid)}|${files.map((f) => f.href).join(',')}`;
  const hit = mosaicCache.get(key);
  if (hit) return hit;
  const headers = await timed(ctx, 'download', () => Promise.all(files.map((f) => cogHeader(ctx, f.href))));
  const data = new Float32Array(grid.width * grid.height).fill(NaN);
  let bytes = headers.reduce((s, h) => s + h.bytes, 0);
  let cogTiles = 0;
  const plans: { href: string; image: CogImage; col0: number; row0: number; ranges: CogRange[] }[] = [];
  files.forEach((f, i) => {
    const image = headers[i].image;
    if (Math.abs(image.resX - grid.cell) > 1e-9 || Math.abs(image.resY - grid.cell) > 1e-9) {
      throw new CogFormatError(`${f.href}: pixel size ${image.resX} m, expected ${grid.cell} m`);
    }
    const col0 = Math.round((grid.x0 - image.originX) / image.resX);
    const row0 = Math.round((image.originY - grid.y1) / image.resY);
    const tiles = cogTilesForWindow(image, col0, row0, col0 + grid.width, row0 + grid.height);
    cogTiles += tiles.length;
    bytes += tiles.reduce((s, t) => s + t.byteCount, 0);
    const missing = tiles.filter((t) => !tileBytesCache.get(`${f.href}#${t.index}`));
    plans.push({
      href: f.href,
      image,
      col0,
      row0,
      ranges: mergeCogRanges(missing, RANGE_MERGE_GAP, RANGE_MERGE_MAX),
    });
    // Tiles already in memory: decode now.
    for (const t of tiles) {
      const cached = tileBytesCache.get(`${f.href}#${t.index}`);
      if (!cached) continue;
      const t0 = performance.now();
      copyTileInto(image, t, decodeCogTile(image, cached), data, grid.width, grid.height, col0, row0);
      ctx.stats.ms.decode += performance.now() - t0;
    }
  });
  ctx.plan += plans.reduce((s, p) => s + p.ranges.reduce((q, r) => q + (r.end - r.start), 0), 0);
  ctx.report();
  const tasks = plans.flatMap((p) =>
    p.ranges.map((range) => async (): Promise<void> => {
      checkAbort(ctx);
      const body = await fetchByteRange(p.href, range.start, range.end, retryOpts(ctx, RANGE_RETRY));
      ctx.stats.downloaded += body.length;
      ctx.done += body.length;
      const t0 = performance.now();
      for (const t of range.tiles) {
        const slice = body.slice(t.offset - range.start, t.offset - range.start + t.byteCount);
        tileBytesCache.set(`${p.href}#${t.index}`, slice, slice.length);
        copyTileInto(
          p.image,
          t,
          decodeCogTile(p.image, slice),
          data,
          grid.width,
          grid.height,
          p.col0,
          p.row0,
        );
      }
      ctx.stats.ms.decode += performance.now() - t0;
      ctx.report();
    }),
  );
  await timed(ctx, 'download', () => runLimited(tasks, RANGE_CONCURRENCY));
  const mosaic: MosaicData = { raster: { ...grid, data }, tiles: [...files], bytes, cogTiles };
  mosaicCache.set(key, mosaic);
  return mosaic;
}

/** Ground at LV95 (east, north) from the height service ({"height":"558.8"}); throws on failure. */
async function heightService(ctx: Ctx, p: Lv95Point): Promise<number> {
  const url = `${HEIGHT_SERVICE_URL}?easting=${p.east.toFixed(2)}&northing=${p.north.toFixed(2)}&sr=2056`;
  const hit = groundCache.get(url);
  if (hit !== undefined) return hit;
  const { value, size } = await fetchReadWithRetry(
    url,
    async (res) => {
      const text = await res.text();
      return { value: Number((JSON.parse(text) as { height?: unknown }).height), size: text.length };
    },
    retryOpts(ctx, JSON_RETRY),
  );
  ctx.stats.downloaded += size;
  if (!Number.isFinite(value)) throw new CogFormatError(`Height service: no height at ${p.east}, ${p.north}`);
  groundCache.set(url, value);
  return value;
}

/** 2 m terrain model over the grid (+ one cell for interpolation), newest tile per km. */
async function readTerrain(ctx: Ctx, grid: GridSpec): Promise<MosaicData | null> {
  const x1 = grid.x0 + grid.width * grid.cell;
  const y0 = grid.y1 - grid.height * grid.cell;
  const cell = 2;
  const tx0 = Math.floor(grid.x0 / cell) * cell - cell;
  const ty1 = Math.ceil(grid.y1 / cell) * cell + cell;
  const dtmGrid: GridSpec = {
    x0: tx0,
    y1: ty1,
    cell,
    width: Math.ceil((x1 - tx0) / cell) + 1,
    height: Math.ceil((ty1 - y0) / cell) + 1,
  };
  const files = await timed(ctx, 'stac', () => stacTiles(ctx, DTM_COLLECTION, DTM_ASSET_SUFFIX, dtmGrid));
  if (files.length === 0) return null;
  return readMosaic(ctx, dtmGrid, files);
}

/** Decoded building vector tiles around the site (404 = no data). */
async function readVectorTiles(
  ctx: Ctx,
  site: DsmSite,
  reach: number,
): Promise<{ tiles: DecodedTile[]; bytes: number }> {
  const ids = tilesForRadius(site.latitude, site.longitude, reach, BUILDING_TILE_ZOOM);
  let bytes = 0;
  const tiles: DecodedTile[] = new Array<DecodedTile>(ids.length);
  await runLimited(
    ids.map((id, i) => async () => {
      checkAbort(ctx);
      const url = buildingTileUrl(id);
      let hit = vectorTileCache.get(url);
      if (!hit) {
        try {
          const res = await fetchBytesWithRetry(url, retryOpts(ctx, VECTOR_TILE_RETRY));
          ctx.stats.downloaded += res.bytes.length;
          hit = { tile: decodeBuildingTile(await maybeGunzip(res.bytes), id), bytes: res.bytes.length };
        } catch (e) {
          if (!(e instanceof NetError && e.kind === 'http' && e.status === 404)) throw e;
          hit = { tile: { tile: id, polygons: [], layers: [], outside: [] }, bytes: 0 };
        }
        vectorTileCache.set(url, hit);
      }
      tiles[i] = hit.tile;
      bytes += hit.bytes;
    }),
    4,
  );
  return { tiles, bytes };
}

/** Own-building zone from the vector-tile parts (location ENU) containing the probe point, else null. */
function zoneFromParts(parts: readonly BuildingPart[], site: DsmSite): OwnExclusionZone | null {
  const [pe, pn] = facadeToEnu([0, OWN_BUILDING_EXCLUSION.probeN], site.facadeAzimuth);
  const own = parts.filter((p) => pointInRing(p.footprint, pe, pn));
  if (own.length === 0) return null;
  const ring = own.flatMap((p) => p.footprint.map((q) => enuToFacade(q, site.facadeAzimuth)));
  return ownExclusionZone(site.exclusion.balconyDepthM, site.exclusion.rowWidthM, ring);
}

/** Stable key of the masks of a site (anchor + polygons + trees). */
function maskKey(site: DsmSite): string {
  return JSON.stringify([site.trees, site.masks?.anchor ?? null, site.masks?.polygons ?? []]);
}

/**
 * The raster the rays run on: the scan with the masked cells replaced by the ground, and the own-building
 * zone from the vector tiles when they were loaded (trees off) and no own footprint was given.
 */
/** Key of the masked raster of a site on a grid. */
const maskedKey = (grid: GridSpec, site: DsmSite): string =>
  `${gridKey(grid)}|${site.latitude},${site.longitude},${site.facadeAzimuth}|${maskKey(site)}`;

/** True when the site needs the ground model under masked cells (masks, or trees off). */
const needsMasks = (site: DsmSite): boolean => !site.trees || (site.masks?.polygons.length ?? 0) > 0;

/** What the masks need besides the scan: the 2 m terrain and, without trees, the building vector tiles. */
interface MaskInputs {
  terrain: MosaicData | null;
  vt: { tiles: DecodedTile[]; bytes: number } | null;
}

function loadMaskInputs(ctx: Ctx, site: DsmSite, grid: GridSpec): Promise<MaskInputs> {
  const reach = site.radius + DSM_WINDOW_MARGIN_M;
  return Promise.all([
    readTerrain(ctx, grid),
    site.trees ? Promise.resolve(null) : timed(ctx, 'download', () => readVectorTiles(ctx, site, reach)),
  ]).then(([terrain, vt]) => ({ terrain, vt }));
}

async function maskedRaster(
  ctx: Ctx,
  site: DsmSite,
  mosaic: MosaicData,
  inputs: Promise<MaskInputs> | null,
): Promise<{ raster: Raster; zone: OwnExclusionZone | null; extraBytes: number }> {
  const polygons = site.masks?.polygons ?? [];
  if (!needsMasks(site)) return { raster: mosaic.raster, zone: null, extraBytes: 0 };
  const key = maskedKey(mosaic.raster, site);
  const hit = maskedCache.get(key);
  if (hit) return hit;
  const grid: GridSpec = mosaic.raster;
  const reach = site.radius + DSM_WINDOW_MARGIN_M;
  const { terrain, vt } = await (inputs ?? loadMaskInputs(ctx, site, grid));
  checkAbort(ctx);
  const t0 = performance.now();
  const mask = new Uint8Array(grid.width * grid.height);
  let zone: OwnExclusionZone | null = null;
  if (vt) {
    // Building footprints (courtyards left out) widened by DSM_KEEP_BUFFER_M for the roof edges keep the scan;
    // outside CH/FL (no footprints there) the scan stays too; everything else becomes ground.
    const { parts } = assembleBuildingParts(vt.tiles, site.latitude, site.longitude, reach);
    const frame = lv95LocalFrame({ latitude: site.latitude, longitude: site.longitude });
    const toLv = (p: readonly [number, number]): [number, number] => {
      const q = frame.toLv95(p[0], p[1]);
      return [q.east, q.north];
    };
    const keep = new Uint8Array(grid.width * grid.height);
    for (const part of parts) {
      fillPolygon(grid, [part.footprint.map(toLv), ...(part.holes ?? []).map((h) => h.map(toLv))], keep, 1);
    }
    dilateMask(grid, keep, DSM_KEEP_BUFFER_M);
    for (const t of vt.tiles) {
      for (const poly of t.outside) {
        const rings = poly.map((r) =>
          r.map((p): [number, number] => {
            const g = tileToLonLat(p[0] / 4096, p[1] / 4096, t.tile.z);
            const q = wgs84ToLv95(g.latitude, g.longitude);
            return [q.east, q.north];
          }),
        );
        fillPolygon(grid, rings, keep, 1);
      }
    }
    for (let k = 0; k < mask.length; k++) mask[k] = keep[k] ? 0 : 1;
    if (!site.exclusion.ownFootprint) zone = zoneFromParts(parts, site);
  }
  if (polygons.length > 0 && site.masks) {
    const frame = lv95LocalFrame(site.masks.anchor);
    for (const poly of polygons) {
      const ring = poly.map((p): [number, number] => {
        const q = frame.toLv95(p[0], p[1]);
        return [q.east, q.north];
      });
      fillPolygonBuffered(grid, ring, DSM_REMOVE_BUFFER_M, mask, 1);
    }
  }
  const src = mosaic.raster.data;
  const data = new Float32Array(src);
  for (let k = 0; k < data.length; k++) {
    if (!mask[k]) continue;
    const i = k % grid.width;
    const j = (k - i) / grid.width;
    data[k] = terrain
      ? sampleBilinear(terrain.raster, grid.x0 + (i + 0.5) * grid.cell, grid.y1 - (j + 0.5) * grid.cell)
      : NaN;
  }
  ctx.stats.ms.mask += performance.now() - t0;
  const entry = {
    raster: { ...grid, data },
    zone,
    extraBytes: (terrain?.bytes ?? 0) + (vt?.bytes ?? 0),
  };
  maskedCache.set(key, entry);
  return entry;
}

function toDsmError(e: unknown, signal: AbortSignal | undefined): DsmError {
  if (signal?.aborted || e instanceof AbortedError)
    return { kind: 'aborted', message: 'The laser-scan load was aborted.' };
  if (e instanceof NetError) {
    return { kind: e.kind, message: e.message, ...(e.status !== undefined ? { status: e.status } : {}) };
  }
  if (e instanceof CogFormatError || e instanceof RangeNotSupportedError || e instanceof SyntaxError) {
    return { kind: 'data', message: e.message };
  }
  return { kind: 'data', message: e instanceof Error ? e.message : String(e) };
}

function newStats(): DsmStats {
  return { requests: 0, downloaded: 0, ms: { stac: 0, download: 0, decode: 0, mask: 0, rays: 0, total: 0 } };
}

/** True when the site lies within the collection's extent (else there is no scan data: no request). */
export function insideDsmExtent(latitude: number, longitude: number): boolean {
  const [w, s, e, n] = DSM_COLLECTION_BBOX;
  return latitude >= s && latitude <= n && longitude >= w && longitude <= e;
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The laser-scan horizons of a job: every height of every observer group (see the module header). Loads what
 * is not in memory yet (STAC, headers, scan tiles, ground, and for masks the 2 m terrain and, without trees,
 * the building vector tiles), with retries (fetchRetry.ts). Yields to the event loop between groups (a worker
 * keeps answering other jobs). Never throws: aborted, failed and uncovered sites come back as results.
 */
export async function computeDsmJob(req: DsmJobRequest, opts: DsmJobOptions = {}): Promise<DsmJobResult> {
  const stats = newStats();
  const started = performance.now();
  const baseFetch = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const ctx: Ctx = {
    opts,
    signal: opts.signal,
    fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => {
      stats.requests++;
      return baseFetch(input, init);
    }) as typeof fetch,
    stats,
    plan: 0,
    done: 0,
    report: () => undefined,
  };
  const groups = req.groups;
  let computed = 0;
  ctx.report = () => {
    if (ctx.signal?.aborted) return;
    const download = ctx.plan > 0 ? ctx.done / ctx.plan : 1;
    const compute = groups.length > 0 ? computed / groups.length : 1;
    opts.onProgress?.({ fraction: 0.9 * download + 0.1 * compute, bytes: ctx.done, totalBytes: ctx.plan });
  };
  const finish = <T extends DsmJobResult>(r: T): T => {
    stats.ms.total = performance.now() - started;
    return r;
  };
  try {
    checkAbort(ctx);
    const { site } = req;
    if (
      !Number.isFinite(site.latitude) ||
      !Number.isFinite(site.longitude) ||
      !(site.radius > 0 && site.radius <= 1000) ||
      !Number.isFinite(site.facadeAzimuth)
    ) {
      return finish({ status: 'error', error: { kind: 'data', message: 'Invalid laser-scan site' }, stats });
    }
    if (!insideDsmExtent(site.latitude, site.longitude)) return finish({ status: 'unavailable', stats });
    const center = wgs84ToLv95(site.latitude, site.longitude);
    const frame = lv95LocalFrame({ latitude: site.latitude, longitude: site.longitude });
    // The scan's own lattice (0.5 m; checked against every file's header).
    const grid = gridAround(center, site.radius + DSM_WINDOW_MARGIN_M, 0.5);
    // Never rejects (a failure falls back to the terrain model below; an abort is checked after it).
    const groundPromise = heightService(ctx, center).then(
      (v): { value: number; source: DsmSiteInfo['groundSource'] } => ({ value: v, source: 'height-service' }),
      () => null,
    );
    const files = await timed(ctx, 'stac', () => stacTiles(ctx, DSM_COLLECTION, DSM_ASSET_SUFFIX, grid));
    if (files.length === 0) {
      await groundPromise;
      return finish({ status: 'unavailable', stats });
    }
    // The ground model and building tiles of the masks load alongside the scan (unless already masked).
    const maskInputs =
      needsMasks(site) && !maskedCache.get(maskedKey(grid, site)) ? loadMaskInputs(ctx, site, grid) : null;
    maskInputs?.catch(() => undefined); // awaited below; a failure of the scan must not leave it unhandled
    const mosaic = await readMosaic(ctx, grid, files);
    checkAbort(ctx);
    let ground = await groundPromise;
    checkAbort(ctx);
    if (!ground) {
      // Height service failed: the 2 m terrain model at the site.
      const terrain = await readTerrain(ctx, gridAround(center, 4, 0.5));
      const v = terrain ? sampleBilinear(terrain.raster, center.east, center.north) : NaN;
      if (!Number.isFinite(v)) throw new CogFormatError('No ground height at the site');
      ground = { value: v, source: 'terrain-model' };
    }
    const siteGround = ground;
    const masked = await maskedRaster(ctx, site, mosaic, maskInputs);
    checkAbort(ctx);
    const zone =
      masked.zone ??
      ownExclusionZone(site.exclusion.balconyDepthM, site.exclusion.rowWidthM, site.exclusion.ownFootprint);
    const geo: MarchGeometry = {
      toLv95: frame.toLv95,
      facadeAzimuth: site.facadeAzimuth,
      ground: siteGround.value,
      radius: site.radius,
      zone,
    };
    const horizons: HorizonProfile[][] = [];
    for (const group of groups) {
      const t0 = performance.now();
      horizons.push(marchDsmHorizons(masked.raster, geo, group));
      stats.ms.rays += performance.now() - t0;
      computed++;
      ctx.report();
      if (computed < groups.length) await yieldToEventLoop();
      checkAbort(ctx);
    }
    const years = [...new Set(mosaic.tiles.map((t) => t.year))].sort((a, b) => a - b);
    const stacBytes =
      stacCache.get(`${stacItemsUrl(DSM_COLLECTION)}?bbox=${gridBboxWgs(grid).join(',')}&limit=100`)?.bytes ??
      0;
    return finish({
      status: 'ok',
      horizons,
      info: {
        dataYears: years,
        bytes: mosaic.bytes + masked.extraBytes + stacBytes,
        coverage: circleCoverage(mosaic.raster, center, site.radius),
        ground: siteGround.value,
        groundSource: siteGround.source,
        files: mosaic.tiles.length,
        tiles: mosaic.cogTiles,
      },
      stats,
    });
  } catch (e) {
    return finish({ status: 'error', error: toDsmError(e, ctx.signal), stats });
  }
}
