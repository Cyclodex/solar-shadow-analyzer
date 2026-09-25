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
import {
  OWN_BUILDING_EXCLUSION,
  isOwnBuildingCell,
  ownExclusionZone,
  type OwnExclusionZone,
} from './surroundings';
import { toRad } from './units';
import { DSM_WINDOW_MARGIN_M, dsmNeedsMasks, insideDsmExtent } from './dsmEstimate';

export {
  DSM_ALGORITHM_VERSION,
  DSM_COLLECTION_BBOX,
  DSM_WINDOW_MARGIN_M,
  MEAN_DSM_TILE_BYTES,
  MEAN_DTM_TILE_BYTES,
  MEAN_VECTOR_TILE_BYTES,
  dsmDataKey,
  dsmNeedsMasks,
  estimateDsmBytes,
  insideDsmExtent,
} from './dsmEstimate';

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
// Sampling (binding): each ray visits every cell it crosses out to the radius (Amanatides–Woo traversal), at the
// distance where it enters the cell (the steepest view of that cell along the ray; at least DSM_NEAR_M), and per
// output azimuth (FLOOR_HORIZON_STEP_DEG = 0.5°) the maximum over DSM_SUB_RAYS + 1 rays spread across that
// azimuth's bin (± 0.25°) is taken: thin objects between two ray directions (tree crowns, poles, edges) are not
// lost. A fixed step along the ray (0.25 m before) skipped cells a ray only clips near the observer, so the
// horizon of low floors came out too low (Breitenrain 1st floor: 407.9 instead of 391.3 kWh a year). The research
// measured RMS 0.77–15.8° for one ray per 1° against the maximum over all cells of the bin; dsm.test.ts compares
// the result with such a brute force over every cell and with a 2 mm march.
// Own building (surroundings.ts ownExclusionZone, isOwnBuildingCell): cells whose centre lies behind the facade
// plane (n < 0.5 m) or in the own balcony zone (0 ≤ n ≤ balcony depth + 0.5 m within the own building's extent
// along the facade) are skipped; the test is on the cell that is read, not on a point of the ray (a ray grazing
// the facade just outside the zone would otherwise read the own eaves: 60.4° at Breitenrain).
// Masks: cells of removed or edited buildings (dsmMaskPolygons) and, without trees, every cell outside the union
// of all swisstopo building footprints (vector tiles, fetched here) become ground, except outside CH/FL where
// the footprints are missing (DecodedTile.outside).
// Worker memory: parsed headers, compressed tiles (for small site moves and aborted loads), the window mosaic,
// the ground model and the masked raster of the last site stay in memory, so new observers (tilt, floors) and
// new masks are recomputed without refetching; the own-building zone is derived per job (never kept with the
// raster). A `memoryOnly` job computes from that memory or returns 'miss' without a request, so the page
// decides when a download happens (hooks/useSurfaceModel.ts). Nothing here throws: jobs return typed results.
// The page's light helpers (extent, estimate, keys) live in model/dsmEstimate.ts and are re-exported here.
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
/**
 * Nearest distance a cell counts at, m: the observer's own cell is entered at 0 m (a cell above the observer
 * then gives a steep, not a vertical, horizon).
 */
export const DSM_NEAR_M = 0.25;
/** Ray intervals per output azimuth step (the bin max takes DSM_SUB_RAYS + 1 rays, the edges shared). */
export const DSM_SUB_RAYS = 4;
/**
 * Ground masks of removed/edited buildings reach this far beyond the footprint, m: the vector-tile footprints
 * leave roof edges outside (see ARCHITECTURE, measured at Breitenrain), which would otherwise stay as a rim
 * at roof height.
 */
export const DSM_REMOVE_BUFFER_M = 1;
/** Without trees, cells up to this far outside a building footprint keep the scan (roof edges), m. */
export const DSM_KEEP_BUFFER_M = 1;

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
  /** Observers to compute; none: the job only loads the site's data into memory (and checks the site). */
  groups: DsmObserverGroup[];
  /**
   * Compute from the worker's memory only: when anything would have to be requested, nothing is and the job
   * returns 'miss' at once (the page then decides when to download, see hooks/useSurfaceModel.ts).
   */
  memoryOnly?: boolean;
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
  /** memoryOnly: the site's data is not (or no longer) in memory; nothing was requested. */
  | { status: 'miss'; stats: DsmStats }
  | { status: 'error'; error: DsmError; stats: DsmStats };

export interface DsmProgress {
  /** 0…1 over download and computation. */
  fraction: number;
  /**
   * Bytes of the scan and ground tiles the site needs: loaded so far and in total. Tiles already in memory
   * count as loaded, so a download resumed after an abort goes on from where it stopped.
   */
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
  /** Nearest distance a cell counts at, m (default DSM_NEAR_M). */
  nearM?: number;
}

/**
 * Horizon of every height of one observer group (index = height): rays from (u = 0, n) in the facade frame up to
 * the radius, through every cell they cross (Amanatides–Woo), each at the distance where the ray enters it (at
 * least DSM_NEAR_M); cells whose centre lies in the own-building zone (isOwnBuildingCell) are skipped. Each
 * output azimuth takes the maximum of the subRays + 1 rays across its bin (± stepDeg / 2). Degrees ≥ 0.
 */
export function marchDsmHorizons(
  raster: Raster,
  geo: MarchGeometry,
  group: DsmObserverGroup,
  opts: MarchOptions = {},
): HorizonProfile[] {
  const stepDeg = opts.stepDeg ?? FLOOR_HORIZON_STEP_DEG;
  const sub = Math.max(1, Math.round(opts.subRays ?? DSM_SUB_RAYS));
  const near = opts.nearM ?? DSM_NEAR_M;
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
  // Cell centre (i, j) → facade frame: u = uc + ui·i + uj·j, n = nc + ni·i + nj·j (LV95 → ENU → facade, affine).
  const det = a * d - b * c;
  const X0 = x0 + 0.5 * cell - p0.east;
  const Y0 = y1 - 0.5 * cell - p0.north;
  const E0 = (d * X0 - b * Y0) / det;
  const N0 = (a * Y0 - c * X0) / det;
  const Ei = (d * cell) / det;
  const Ej = (b * cell) / det;
  const Ni = (-c * cell) / det;
  const Nj = (-a * cell) / det;
  const gam = toRad(geo.facadeAzimuth);
  const cg = Math.cos(gam);
  const sg = Math.sin(gam);
  const uc = -E0 * cg + N0 * sg;
  const ui = -Ei * cg + Ni * sg;
  const uj = -Ej * cg + Nj * sg;
  const nc = E0 * sg + N0 * cg;
  const ni = Ei * sg + Ni * cg;
  const nj = Ej * sg + Nj * cg;
  const zone = geo.zone;
  const { behindN, balconyN } = zone;
  const nObs = group.n;
  // Every point of a cell lies within half a diagonal of its centre (ENU scale ≈ LV95 scale, ≤ 1e-4 apart).
  const halfDiag = cell * Math.SQRT1_2 * 1.001;
  const nFreeFrom = Math.max(behindN, balconyN) + halfDiag;
  const EPS = 1e-12;
  for (let r = 0; r < nRays; r++) {
    const az = toRad((r * outStep) / sub);
    const s = Math.sin(az);
    const co = Math.cos(az);
    // Index units per metre along the ray.
    const vx = (a * s + b * co) / cell;
    const vy = -(c * s + d * co) / cell;
    const dn = Math.cos(az - gam);
    // n(t) = nObs + t·dn. Beyond tStop every centre lies behind the facade plane; beyond tFree none can be in
    // the own zone (no test needed).
    const tStop = dn < -EPS ? (behindN - halfDiag - nObs) / dn : Infinity;
    const tFree = dn > EPS ? (nFreeFrom - nObs) / dn : nObs >= nFreeFrom && dn >= 0 ? 0 : Infinity;
    const tEnd = Math.min(geo.radius, tStop);
    let ix = Math.floor(fx0);
    let iy = Math.floor(fy0);
    const sx = vx > 0 ? 1 : -1;
    const sy = vy > 0 ? 1 : -1;
    const tdx = vx !== 0 ? Math.abs(1 / vx) : Infinity;
    const tdy = vy !== 0 ? Math.abs(1 / vy) : Infinity;
    let tmx = vx > 0 ? (ix + 1 - fx0) / vx : vx < 0 ? (fx0 - ix) / -vx : Infinity;
    let tmy = vy > 0 ? (iy + 1 - fy0) / vy : vy < 0 ? (fy0 - iy) / -vy : Infinity;
    let t = 0;
    const base = r * nH;
    while (t <= tEnd) {
      if (ix < 0 || iy < 0 || ix >= w || iy >= hgt) break; // left the window (the observer is inside it)
      const z = data[iy * w + ix];
      if (
        z === z &&
        (t >= tFree || !isOwnBuildingCell(uc + ui * ix + uj * iy, nc + ni * ix + nj * iy, zone))
      ) {
        const inv = 1 / (t > near ? t : near);
        for (let h = 0; h < nH; h++) {
          const v = (z - zo[h]) * inv;
          if (v > best[base + h]) best[base + h] = v;
        }
      }
      if (tmx < tmy) {
        t = tmx;
        tmx += tdx;
        ix += sx;
      } else {
        t = tmy;
        tmy += tdy;
        iy += sy;
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
/** Ground of a site as used (height service, or the terrain model after it failed): later jobs reuse it. */
const siteGroundCache = new Lru<{ value: number; source: DsmSiteInfo['groundSource'] }>(16);
const vectorTileCache = new Lru<{ tile: DecodedTile; bytes: number }>(16);

/**
 * The masked raster of a site and, when the building vector tiles were loaded (trees off), their parts (ENU
 * around the site): the own-building zone is derived from them per job (it depends on the facade, balcony
 * depth, row width and own footprint, none of which change the raster).
 */
interface MaskedData {
  raster: Raster;
  parts: BuildingPart[] | null;
  extraBytes: number;
}
const maskedCache = new Lru<MaskedData>(1);

/** Forgets everything kept in memory (tests). */
export function clearDsmCaches(): void {
  for (const c of [
    headerCache,
    tileBytesCache,
    stacCache,
    mosaicCache,
    groundCache,
    siteGroundCache,
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
  /** Tile bytes the site needs and those loaded (progress; tiles already in memory count as loaded). */
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
  let inMemory = 0;
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
      inMemory += cached.length;
      const t0 = performance.now();
      copyTileInto(image, t, decodeCogTile(image, cached), data, grid.width, grid.height, col0, row0);
      ctx.stats.ms.decode += performance.now() - t0;
    }
  });
  // Progress over the site's tiles: those in memory (e.g. from a load that was aborted) are already loaded.
  ctx.plan += inMemory + plans.reduce((s, p) => s + p.ranges.reduce((q, r) => q + (r.end - r.start), 0), 0);
  ctx.done += inMemory;
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

/** Own footprint in the facade frame: the vector-tile parts (site ENU) containing the probe point, else null. */
function ownRingFromParts(parts: readonly BuildingPart[], facadeAzimuth: number): [number, number][] | null {
  const [pe, pn] = facadeToEnu([0, OWN_BUILDING_EXCLUSION.probeN], facadeAzimuth);
  const own = parts.filter((p) => pointInRing(p.footprint, pe, pn));
  if (own.length === 0) return null;
  return own.flatMap((p) => p.footprint.map((q) => enuToFacade(q, facadeAzimuth)));
}

/**
 * Own-building zone of a job: from the own footprint of the config, else from the vector-tile parts when they
 * were loaded (trees off), else ± (row width / 2 + 2 m). Derived per job, never kept with the raster.
 */
export function dsmExclusionZone(site: DsmSite, parts: readonly BuildingPart[] | null): OwnExclusionZone {
  const { balconyDepthM, rowWidthM, ownFootprint } = site.exclusion;
  const ring = ownFootprint ?? (parts ? ownRingFromParts(parts, site.facadeAzimuth) : null);
  return ownExclusionZone(balconyDepthM, rowWidthM, ring);
}

/** Stable key of the masks of a site (anchor + polygons + trees). */
function maskKey(site: DsmSite): string {
  return JSON.stringify([site.trees, site.masks?.anchor ?? null, site.masks?.polygons ?? []]);
}

/**
 * Key of the masked raster of a site on a grid: the raster depends on the site (vector tiles in its ENU frame)
 * and the masks only; the facade and the own-building exclusion are applied per job (dsmExclusionZone).
 */
const maskedKey = (grid: GridSpec, site: DsmSite): string =>
  `${gridKey(grid)}|${site.latitude},${site.longitude}|${maskKey(site)}`;

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

/**
 * The raster the rays run on: the scan with the masked cells replaced by the ground; with the building parts
 * of the vector tiles when they were loaded (trees off).
 */
async function maskedRaster(
  ctx: Ctx,
  site: DsmSite,
  mosaic: MosaicData,
  inputs: Promise<MaskInputs> | null,
): Promise<MaskedData> {
  const polygons = site.masks?.polygons ?? [];
  if (!dsmNeedsMasks(site)) return { raster: mosaic.raster, parts: null, extraBytes: 0 };
  const key = maskedKey(mosaic.raster, site);
  const hit = maskedCache.get(key);
  if (hit) return hit;
  const grid: GridSpec = mosaic.raster;
  const reach = site.radius + DSM_WINDOW_MARGIN_M;
  const { terrain, vt } = await (inputs ?? loadMaskInputs(ctx, site, grid));
  checkAbort(ctx);
  const t0 = performance.now();
  const mask = new Uint8Array(grid.width * grid.height);
  let parts: BuildingPart[] | null = null;
  if (vt) {
    // Building footprints (courtyards left out) widened by DSM_KEEP_BUFFER_M for the roof edges keep the scan;
    // outside CH/FL (no footprints there) the scan stays too; everything else becomes ground.
    parts = assembleBuildingParts(vt.tiles, site.latitude, site.longitude, reach).parts;
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
  const entry: MaskedData = {
    raster: { ...grid, data },
    parts,
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

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The laser-scan horizons of a job: every height of every observer group (see the module header). Loads what
 * is not in memory yet (STAC, headers, scan tiles, ground, and for masks the 2 m terrain and, without trees,
 * the building vector tiles), with retries (fetchRetry.ts); with `memoryOnly` nothing: the first request it
 * would make ends the job with 'miss'. Yields to the event loop between groups (a worker keeps answering other
 * jobs). Never throws: aborted, failed, uncovered and missed sites come back as results.
 */
export async function computeDsmJob(req: DsmJobRequest, opts: DsmJobOptions = {}): Promise<DsmJobResult> {
  const stats = newStats();
  const started = performance.now();
  const baseFetch = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  // The job's own signal: the caller's abort, or (memoryOnly) the first request that would be needed.
  const inner = new AbortController();
  const outer = opts.signal;
  const forward = (): void => inner.abort();
  if (outer?.aborted) inner.abort();
  else outer?.addEventListener('abort', forward, { once: true });
  let missed = false;
  const ctx: Ctx = {
    opts,
    signal: inner.signal,
    fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => {
      if (req.memoryOnly) {
        missed = true;
        inner.abort();
        return Promise.reject(new DOMException('The laser-scan data is not in memory.', 'AbortError'));
      }
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
    // The ground of the site as an earlier job used it, else the height service. Never rejects (a failure
    // falls back to the terrain model below; an abort is checked after it).
    const groundKey = `${center.east.toFixed(2)},${center.north.toFixed(2)}`;
    const knownGround = siteGroundCache.get(groundKey);
    const groundPromise = knownGround
      ? Promise.resolve(knownGround)
      : heightService(ctx, center).then(
          (v): { value: number; source: DsmSiteInfo['groundSource'] } => ({
            value: v,
            source: 'height-service',
          }),
          () => null,
        );
    const files = await timed(ctx, 'stac', () => stacTiles(ctx, DSM_COLLECTION, DSM_ASSET_SUFFIX, grid));
    if (files.length === 0) {
      await groundPromise;
      return finish({ status: 'unavailable', stats });
    }
    // The ground model and building tiles of the masks load alongside the scan (unless already masked).
    const maskInputs =
      dsmNeedsMasks(site) && !maskedCache.get(maskedKey(grid, site)) ? loadMaskInputs(ctx, site, grid) : null;
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
    siteGroundCache.set(groundKey, siteGround);
    const masked = await maskedRaster(ctx, site, mosaic, maskInputs);
    checkAbort(ctx);
    const geo: MarchGeometry = {
      toLv95: frame.toLv95,
      facadeAzimuth: site.facadeAzimuth,
      ground: siteGround.value,
      radius: site.radius,
      zone: dsmExclusionZone(site, masked.parts),
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
    if (missed && !outer?.aborted) return finish({ status: 'miss', stats });
    return finish({ status: 'error', error: toDsmError(e, ctx.signal), stats });
  } finally {
    outer?.removeEventListener('abort', forward);
  }
}
