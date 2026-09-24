import { decode } from 'fast-png';
import { LIMITS } from './defaults';
import type { HorizonProfile } from './types';
import { DEG, clamp, toDeg } from './units';
import { getStorage, touchCacheEntry, writeCacheEntry } from './storageCache';

// ─────────────────────────────────────────────
// TERRAIN HORIZON FROM DEM TILES
// AWS Terrarium tiles: Web Mercator, 256 px, CORS *, height = R·256 + G + B/256 − 32768 (m).
// In the Alps the source is EU-DEM (25 m), so zoom 12 (≈ 26 m/px at 47° N) is native resolution.
// Horizon: for every azimuth a great-circle ray is marched outward; the horizon is the maximum
// elevation angle of the terrain incl. earth curvature and refraction (drop = d²/(2R)·(1 − k)).
// Validated against PVGIS printhorizon (scripts/validate-terrain.ts): RMS 0.34° on the Plateau, ≈ 1.2° in
// deep Alpine valleys. The residual is mostly PVGIS itself: its profiles match ours best ~105 m S / 45 m W
// of the requested point (our DEM is registered within 5 m, checked on 208 summits; shifted RMS 0.5–0.6°),
// and it quantizes heights to 1/150 rad ≈ 0.38°. EU-DEM flattens sharp summits (median −55 m).
// Several observer heights share one download and one pass over the ray samples (fetchTerrainHorizons,
// computeHorizons). The app runs the download, PNG decoding and computation (computeTerrainHorizons) in a
// Web Worker (workers/terrainClient.ts); the localStorage result cache stays on the page.
// ─────────────────────────────────────────────

/** AWS Terrain Tiles, Terrarium encoding ({z}/{x}/{y} template, CORS *). */
export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/** Tile edge length, px. */
export const TILE_SIZE = 256;

/** Mean earth radius (IUGG), m. */
export const EARTH_RADIUS_M = 6_371_008.8;

/** Coefficient of terrestrial refraction (standard atmosphere): light bends with radius R/k. */
export const REFRACTION_K = 0.13;

/** Default observer height above the DEM ground, m (roughly a first-floor balcony). */
export const DEFAULT_OBSERVER_HEIGHT_M = 5;

/** Default ray length, m. Extending it to 150 km changed the mean horizon by ≤ 0.03° at 11 test sites. */
export const DEFAULT_MAX_DISTANCE_M = 50_000;

/**
 * Default first sample distance, m. Within ~4 DEM cells the DEM's vertical noise (a few m, EU-DEM also
 * contains some canopy/buildings) dominates the angle (3 m at 100 m = 1.7°); nearby buildings are modelled
 * as obstacles instead. A slope that continues beyond 100 m is still captured.
 */
export const DEFAULT_MIN_DISTANCE_M = 100;

/** Ray step: max(RAY_MIN_STEP_M, d · RAY_REL_STEP) ≈ one DEM cell of the band used at d (finer: < 0.01° gain). */
const RAY_MIN_STEP_M = 15;
const RAY_REL_STEP = 0.008;

const MAX_MERCATOR_LAT = 85.05112878;

/** Pixels are area samples: pixel i covers [i, i+1), its value belongs to i + 0.5. */
const PIXEL_CENTER = 0.5;

/**
 * Zoom bands of the multi-resolution sampler (ascending distance): z12 (26 m/px at 47° N, native EU-DEM)
 * up to 5 km, z10 (105 m/px) up to 20 km, z9 (210 m/px) beyond. A height error Δh at distance d costs
 * ≈ Δh/d rad, so the needed resolution falls with distance. Measured at 11 Alpine/Plateau sites: 14–21
 * tiles (2.1–3.1 MB) and 0.02–0.03° RMS (max 0.33°) vs. z12 everywhere (~200 tiles); z10 everywhere
 * would cost 0.25° RMS (scripts/validate-terrain.ts --reference).
 */
export const TERRAIN_ZOOM_BANDS: readonly ZoomBand[] = [
  { z: 12, maxDistanceM: 5_000 },
  { z: 10, maxDistanceM: 20_000 },
  { z: 9, maxDistanceM: Infinity },
];

/** One distance band of the multi-resolution sampler. */
export interface ZoomBand {
  z: number;
  /** Samples up to this distance (m) use tiles of zoom `z`. */
  maxDistanceM: number;
}

/** Web Mercator tile address. */
export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** Decoded tile: `heights` row-major 256 × 256, m. */
export interface TerrainTile extends TileId {
  heights: Float32Array;
}

/** Terrain height (m) at a point, or null when no data is loaded there. */
export type ElevationSampler = (latitude: number, longitude: number) => number | null;

/** Observer location for computeHorizon. */
export interface HorizonSite {
  latitude: number;
  longitude: number;
  /** Eye height above the ground, m. */
  observerHeight: number;
  /** Ground elevation, m a.s.l. Omitted → sampled from the DEM at the site. */
  elevation?: number;
}

/** Sampling options of computeHorizon (and planTerrainTiles). */
export interface HorizonOptions {
  /** Azimuth step, degrees (adjusted to 360 / round(360 / stepDeg)). Default 1. */
  stepDeg?: number;
  maxDistanceM?: number;
  minDistanceM?: number;
  /**
   * Lower bound of the result, degrees. Default 0: the model treats sun altitudes ≤ 0 as night, so a
   * negative "dip" horizon (observer above the surrounding terrain) carries no information (PVGIS also
   * reports 0 there). Pass −90 to get raw angles.
   */
  minElevationDeg?: number;
}

/** Result of computeHorizon. */
export interface TerrainHorizon {
  profile: HorizonProfile;
  /** Ground elevation used for the observer (without observerHeight), m. */
  siteElevation: number;
}

// ── Tile math ────────────────────────────────

/** Web Mercator world coordinates in [0, 1) (x east, wrapped at the antimeridian; y south) of a point. */
function mercator(lon: number, lat: number): { mx: number; my: number } {
  const phi = clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT) * DEG;
  const x = (lon + 180) / 360; // rays may run past ±180°
  return { mx: x - Math.floor(x), my: 0.5 - Math.atanh(Math.sin(phi)) / (2 * Math.PI) };
}

/**
 * Tile containing a point and the (fractional) pixel position inside it at zoom `z`
 * (Web Mercator, 256 px tiles, px/py in [0, 256), x wraps at the antimeridian).
 */
export function lonLatToTilePixel(
  lon: number,
  lat: number,
  z: number,
): { tileX: number; tileY: number; px: number; py: number } {
  const n = 2 ** z;
  const { mx, my } = mercator(lon, lat);
  const x = mx * n;
  const y = clamp(my * n, 0, n - 1e-9);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return { tileX: tx % n, tileY: ty, px: (x - tx) * TILE_SIZE, py: (y - ty) * TILE_SIZE };
}

/** Inverse of lonLatToTilePixel: longitude/latitude (degrees) of a pixel position. */
export function tilePixelToLonLat(
  tileX: number,
  tileY: number,
  px: number,
  py: number,
  z: number,
): { lon: number; lat: number } {
  const n = 2 ** z;
  const mx = (tileX + px / TILE_SIZE) / n;
  const my = (tileY + py / TILE_SIZE) / n;
  return { lon: mx * 360 - 180, lat: toDeg(Math.atan(Math.sinh(Math.PI * (1 - 2 * my)))) };
}

/** Tile URL for TERRARIUM_URL (or another {z}/{x}/{y} template). */
export function tileUrl(t: TileId, template = TERRARIUM_URL): string {
  return template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
}

// ── Decoding ─────────────────────────────────

/** Terrarium heights from interleaved RGB(A) bytes: (R·256 + G + B/256) − 32768, m. */
export function decodeTerrarium(rgba: Uint8Array | Uint8ClampedArray, channels: 3 | 4): Float32Array {
  const n = Math.floor(rgba.length / channels);
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += channels) {
    out[i] = rgba[j] * 256 + rgba[j + 1] + rgba[j + 2] / 256 - 32768;
  }
  return out;
}

/** Decodes a Terrarium PNG (8-bit RGB/RGBA, 256 × 256) to heights. Throws on any other format. */
export function decodeTerrariumPng(png: Uint8Array | ArrayBuffer): Float32Array {
  const img = decode(png);
  const { width, height, depth, channels } = img;
  if (width !== TILE_SIZE || height !== TILE_SIZE || depth !== 8 || (channels !== 3 && channels !== 4)) {
    throw new Error(`Unexpected Terrarium tile format: ${width}×${height}, ${channels} ch, ${depth} bit`);
  }
  return decodeTerrarium(img.data as Uint8Array, channels);
}

// ── Sampler ──────────────────────────────────

interface Level {
  /** World size in px (2^z · 256). */
  size: number;
  /** Tiles keyed by y · 2^16 + x. */
  tiles: Map<number, Float32Array>;
}

const tileKey = (x: number, y: number): number => y * 65536 + x;

/** Height of the global pixel (i, j) of a level (x wraps, y clamps), null if its tile is not loaded. */
function pixelAt(level: Level, i: number, j: number): number | null {
  const s = level.size;
  const gi = ((i % s) + s) % s;
  const gj = clamp(j, 0, s - 1);
  const tile = level.tiles.get(tileKey(Math.floor(gi / TILE_SIZE), Math.floor(gj / TILE_SIZE)));
  return tile ? tile[(gj % TILE_SIZE) * TILE_SIZE + (gi % TILE_SIZE)] : null;
}

/** Bilinear interpolation at world coords (mx, my) ∈ [0, 1); null if any of the 4 pixels is missing. */
function bilinear(level: Level, mx: number, my: number): number | null {
  const gx = mx * level.size - PIXEL_CENTER;
  const gy = my * level.size - PIXEL_CENTER;
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  const fx = gx - i;
  const fy = gy - j;
  const li = i & (TILE_SIZE - 1);
  const lj = j & (TILE_SIZE - 1);
  let h00: number | null, h10: number | null, h01: number | null, h11: number | null;
  if (i >= 0 && j >= 0 && li < TILE_SIZE - 1 && lj < TILE_SIZE - 1) {
    // Fast path: all four pixels in one tile.
    const tile = level.tiles.get(tileKey(i >> 8, j >> 8));
    if (!tile) return null;
    const k = lj * TILE_SIZE + li;
    h00 = tile[k];
    h10 = tile[k + 1];
    h01 = tile[k + TILE_SIZE];
    h11 = tile[k + TILE_SIZE + 1];
  } else {
    h00 = pixelAt(level, i, j);
    h10 = pixelAt(level, i + 1, j);
    h01 = pixelAt(level, i, j + 1);
    h11 = pixelAt(level, i + 1, j + 1);
    if (h00 === null || h10 === null || h01 === null || h11 === null) return null;
  }
  const top = h00 + (h10 - h00) * fx;
  const bottom = h01 + (h11 - h01) * fx;
  return top + (bottom - top) * fy;
}

/**
 * Elevation sampler over decoded tiles of any mix of zoom levels: bilinear interpolation between pixel
 * centers, using the highest zoom whose four neighbouring pixels are all loaded (tile seams included).
 */
export function createTileSampler(tiles: Iterable<TerrainTile>): ElevationSampler {
  const byZoom = new Map<number, Map<number, Float32Array>>();
  for (const t of tiles) {
    let m = byZoom.get(t.z);
    if (!m) byZoom.set(t.z, (m = new Map()));
    m.set(tileKey(t.x, t.y), t.heights);
  }
  const levels: Level[] = [...byZoom.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([z, m]) => ({ size: 2 ** z * TILE_SIZE, tiles: m }));
  return (lat, lon) => {
    const { mx, my } = mercator(lon, lat);
    for (const level of levels) {
      const h = bilinear(level, mx, my);
      if (h !== null) return h;
    }
    return null;
  };
}

// ── Horizon ──────────────────────────────────

/** Ray sample distances (m): from minDistanceM, step max(15 m, 0.8 % of d), last sample at maxDistanceM. */
export function horizonSampleDistances(
  minDistanceM = DEFAULT_MIN_DISTANCE_M,
  maxDistanceM = DEFAULT_MAX_DISTANCE_M,
): number[] {
  const out: number[] = [];
  const start = Math.max(1, minDistanceM);
  for (let d = start; d < maxDistanceM; d += Math.max(RAY_MIN_STEP_M, d * RAY_REL_STEP)) out.push(d);
  if (maxDistanceM >= start) out.push(maxDistanceM);
  return out;
}

/** Number of azimuth samples; the effective step is 360 / n so the profile closes exactly (as in horizon.ts). */
function azimuthCount(stepDeg: number): number {
  if (!(stepDeg > 0) || !Number.isFinite(stepDeg)) throw new RangeError(`Invalid horizon step: ${stepDeg}`);
  return Math.max(1, Math.round(360 / stepDeg));
}

/**
 * Calls `visit` for every ray sample: great-circle destination at distance d (index k) along azimuth index i.
 * Shared by computeHorizon and planTerrainTiles so the tile plan matches the samples exactly.
 */
function forEachRaySample(
  latitude: number,
  longitude: number,
  n: number,
  distances: readonly number[],
  visit: (i: number, k: number, lat: number, lon: number) => void,
): void {
  const phi1 = latitude * DEG;
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const sinD = distances.map((d) => Math.sin(d / EARTH_RADIUS_M));
  const cosD = distances.map((d) => Math.cos(d / EARTH_RADIUS_M));
  for (let i = 0; i < n; i++) {
    const theta = ((i * 360) / n) * DEG;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let k = 0; k < distances.length; k++) {
      // Spherical destination point (central angle δ = d/R, initial bearing θ).
      const sinPhi2 = sinPhi1 * cosD[k] + cosPhi1 * sinD[k] * cosT;
      const lat = toDeg(Math.asin(sinPhi2));
      const lon = longitude + toDeg(Math.atan2(sinT * sinD[k] * cosPhi1, cosD[k] - sinPhi1 * sinPhi2));
      visit(i, k, lat, lon);
    }
  }
}

/**
 * Terrain horizon around a site. For every azimuth (0° = north, clockwise) the maximum of
 * atan((h(d) − drop(d) − h₀) / d) over the ray samples, with h₀ = ground + observerHeight and
 * drop(d) = d²/(2R)·(1 − k) (earth curvature reduced by refraction). Samples where the sampler returns
 * null are skipped; a ray without data gets minElevationDeg. Throws if the site has no elevation.
 */
export function computeHorizon(
  sampler: ElevationSampler,
  site: HorizonSite,
  opts: HorizonOptions = {},
): TerrainHorizon {
  return computeHorizons(sampler, site, [site.observerHeight], opts)[0];
}

/**
 * computeHorizon for several observer heights at one site, in a single pass over the ray samples: the
 * samples and the terrain heights do not depend on the observer height, only h₀ does. Every result equals
 * computeHorizon at that height (same arithmetic); the cost is close to one height. Throws like it.
 */
export function computeHorizons(
  sampler: ElevationSampler,
  site: Omit<HorizonSite, 'observerHeight'>,
  observerHeights: readonly number[],
  opts: HorizonOptions = {},
): TerrainHorizon[] {
  const n = azimuthCount(opts.stepDeg ?? 1);
  const minElevation = opts.minElevationDeg ?? 0;
  const ground = site.elevation ?? sampler(site.latitude, site.longitude);
  if (ground === null || !Number.isFinite(ground)) throw new Error('No elevation data at the site');
  for (const height of observerHeights) {
    if (!Number.isFinite(height)) throw new RangeError(`Invalid observer height: ${height}`);
  }
  const m = observerHeights.length;
  if (m === 0) return [];
  const h0 = observerHeights.map((height) => ground + height);
  const distances = horizonSampleDistances(opts.minDistanceM, opts.maxDistanceM);
  const drop = distances.map((d) => ((d * d) / (2 * EARTH_RADIUS_M)) * (1 - REFRACTION_K));
  // Track the max tangent (atan is monotonic) → one atan per azimuth and height.
  const best = Array.from({ length: m }, () => new Float64Array(n).fill(-Infinity));
  forEachRaySample(site.latitude, site.longitude, n, distances, (i, k, lat, lon) => {
    const h = sampler(lat, lon);
    if (h === null) return;
    const hk = h - drop[k];
    const d = distances[k];
    for (let j = 0; j < m; j++) {
      const t = (hk - h0[j]) / d;
      if (t > best[j][i]) best[j][i] = t;
    }
  });
  return best.map((b) => {
    const elevations = Array.from(b, (t) =>
      t === -Infinity ? minElevation : Math.max(minElevation, toDeg(Math.atan(t))),
    );
    return { profile: { stepDeg: 360 / n, elevations }, siteElevation: ground };
  });
}

/**
 * Tiles needed by computeHorizon with the given bands: every ray sample at distance d is mapped to the band
 * covering d, including the neighbour tile when the bilinear footprint crosses a tile seam. Includes the site.
 */
export function planTerrainTiles(
  latitude: number,
  longitude: number,
  opts: HorizonOptions & { bands?: readonly ZoomBand[] } = {},
): TileId[] {
  const bands = [...(opts.bands ?? TERRAIN_ZOOM_BANDS)].sort((a, b) => a.maxDistanceM - b.maxDistanceM);
  if (bands.length === 0) return [];
  const distances = horizonSampleDistances(opts.minDistanceM, opts.maxDistanceM);
  const bandOf = distances.map((d) => bands.find((b) => d <= b.maxDistanceM) ?? bands[bands.length - 1]);
  const seen = new Set<number>();
  const out: TileId[] = [];
  const push = (z: number, tx: number, ty: number): void => {
    const n = 2 ** z;
    const x = ((tx % n) + n) % n;
    const y = clamp(ty, 0, n - 1);
    const key = (z * 65536 + y) * 65536 + x;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ z, x, y });
  };
  const add = (lat: number, lon: number, z: number): void => {
    const size = 2 ** z * TILE_SIZE;
    const { mx, my } = mercator(lon, lat);
    const i = Math.floor(mx * size - PIXEL_CENTER);
    const j = Math.floor(my * size - PIXEL_CENTER);
    const tx0 = Math.floor(i / TILE_SIZE);
    const ty0 = Math.floor(j / TILE_SIZE);
    const tx1 = Math.floor((i + 1) / TILE_SIZE); // bilinear neighbour may sit in the next tile
    const ty1 = Math.floor((j + 1) / TILE_SIZE);
    push(z, tx0, ty0);
    if (tx1 !== tx0) push(z, tx1, ty0);
    if (ty1 !== ty0) {
      push(z, tx0, ty1);
      if (tx1 !== tx0) push(z, tx1, ty1);
    }
  };
  add(latitude, longitude, bands[0].z);
  const n = azimuthCount(opts.stepDeg ?? 1);
  forEachRaySample(latitude, longitude, n, distances, (_i, k, lat, lon) => add(lat, lon, bandOf[k].z));
  return out;
}

// ── Fetching ─────────────────────────────────

/** Options of computeTerrainHorizons: download and computation, without the localStorage result cache. */
export interface TerrainComputeOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** (tiles done, tiles total): (0, n) before the first download … (n, n). */
  onProgress?: (done: number, total: number) => void;
}

/** Options of fetchTerrainHorizon. */
export interface FetchTerrainOptions extends TerrainComputeOptions {
  /** Eye height above the DEM ground, m. Default DEFAULT_OBSERVER_HEIGHT_M. */
  observerHeight?: number;
  /** (tiles done, tiles total): (0, n) before the first download … (n, n); a cached result reports (n, n) once. */
  onProgress?: (done: number, total: number) => void;
  /** Read/write the localStorage result cache. Default true. */
  cache?: boolean;
  /** Results kept in the localStorage cache (least recently used evicted). Default TERRAIN_RESULT_CACHE_MAX. */
  cacheMax?: number;
}

/**
 * Downloads the tiles of a site and computes its horizon for each observer height (results in the order of
 * `observerHeights`). computeTerrainHorizons in this thread by default; a Web Worker can take its place.
 */
export type TerrainComputer = (
  latitude: number,
  longitude: number,
  observerHeights: readonly number[],
  opts: TerrainComputeOptions,
) => Promise<TerrainHorizonResult[]>;

/** Options of fetchTerrainHorizons. */
export interface FetchTerrainHorizonsOptions extends Omit<FetchTerrainOptions, 'observerHeight'> {
  /** Eye heights above the DEM ground, m (duplicates are computed once). Default [DEFAULT_OBSERVER_HEIGHT_M]. */
  observerHeights?: readonly number[];
  /**
   * Awaited once before any tile is downloaded (never when every height comes from the result cache), e.g.
   * to let more urgent downloads have the link first. Its rejection rejects the call.
   */
  beforeDownload?: () => Promise<void>;
  /** Computes the heights missing in the result cache. Default computeTerrainHorizons (this thread). */
  compute?: TerrainComputer;
  /** Called with the heights found in the result cache before the missing ones are computed. */
  onCached?: (cached: Record<number, TerrainHorizonResult>) => void;
}

/** Result of fetchTerrainHorizon. */
export interface TerrainHorizonResult extends TerrainHorizon {
  /** Number of DEM tiles the horizon is based on. */
  tiles: number;
}

/** Parallel tile downloads. */
export const TILE_CONCURRENCY = 6;

/** Extra attempts per tile after a transient failure (network error, HTTP 429 or 5xx). */
export const TILE_RETRIES = 2;
/** Backoff before retry n (1-based): n · TILE_RETRY_DELAY_MS. */
export const TILE_RETRY_DELAY_MS = 400;

/** In-memory tile cache (LRU by insertion order), keyed by URL. A decoded tile is 256 KiB. */
const TILE_CACHE_MAX = 96;
const tileCache = new Map<string, Promise<Float32Array>>();

/**
 * Tile plans (default options) of the most recent sites (LRU by insertion order). A plan does not depend on
 * the observer height, so a changed floor or railing height does not redo it (≈ 40 ms on a desktop).
 */
const PLAN_CACHE_MAX = 5;
const planCache = new Map<string, readonly TileId[]>();

function tilePlan(latitude: number, longitude: number): readonly TileId[] {
  const key = `${latitude},${longitude}`;
  const plan = planCache.get(key) ?? planTerrainTiles(latitude, longitude);
  planCache.delete(key);
  planCache.set(key, plan);
  while (planCache.size > PLAN_CACHE_MAX) planCache.delete(planCache.keys().next().value as string);
  return plan;
}

const RESULT_CACHE_PREFIX = 'ssa.terrain.v1:';
/** Sites whose horizon results are kept in localStorage. */
const RESULT_CACHE_SITES = 5;
/**
 * Horizon results kept in localStorage (≈ 2 kB each; the least recently used one is evicted): one per
 * observer height, i.e. up to one per panel floor (LIMITS.building.numFloors.max) for RESULT_CACHE_SITES sites.
 */
export const TERRAIN_RESULT_CACHE_MAX = LIMITS.building.numFloors.max * RESULT_CACHE_SITES;

/** Empties the in-memory tile cache and the tile plans (tests, memory pressure). */
export function clearTerrainTileCache(): void {
  tileCache.clear();
  planCache.clear();
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

/** Settles like `p`, but rejects as soon as `signal` aborts (`p` itself keeps running for other callers). */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** HTTP error of a tile request; `status` decides whether a retry makes sense. */
class TileHttpError extends Error {
  constructor(
    url: string,
    readonly status: number,
  ) {
    super(`DEM tile ${url}: HTTP ${status}`);
  }
}

/** Network errors (fetch rejects with TypeError), rate limits and server errors are worth retrying. */
function isTransient(e: unknown): boolean {
  if (e instanceof TileHttpError) return e.status === 429 || e.status >= 500;
  return e instanceof TypeError;
}

/** Resolves after `ms`, rejects early when `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return raceAbort(new Promise<void>((resolve) => setTimeout(resolve, ms)), signal);
}

/** Downloads and decodes one tile, retrying transient failures with a linear backoff. */
async function downloadTile(
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Float32Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchImpl(url, { signal });
      if (!res.ok) throw new TileHttpError(url, res.status);
      return decodeTerrariumPng(new Uint8Array(await res.arrayBuffer()));
    } catch (e) {
      if (signal.aborted || attempt >= TILE_RETRIES || !isTransient(e)) throw e;
      await sleep((attempt + 1) * TILE_RETRY_DELAY_MS, signal);
    }
  }
}

async function loadTile(url: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<Float32Array> {
  const hit = tileCache.get(url);
  if (hit) {
    tileCache.delete(url); // refresh LRU position
    tileCache.set(url, hit);
    try {
      // Download started by another call: this caller's abort must not wait for it.
      return await raceAbort(hit, signal);
    } catch (e) {
      // A shared download aborted by another caller (or a transient failure): fetch again for this caller.
      if (signal.aborted) throw e;
    }
  }
  const p = downloadTile(url, fetchImpl, signal);
  tileCache.set(url, p);
  p.catch(() => {
    if (tileCache.get(url) === p) tileCache.delete(url);
  });
  while (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value as string);
  return p;
}

/**
 * Result cache key: lat/lon to 5 decimals (≈ 1 m). Coarser keys return another location's horizon: in Alpine
 * valleys ~100 m change it by degrees (Lauterbrunnen, 0.0009° apart: 3.3° RMS, 8.2° max).
 */
function resultCacheKey(lat: number, lon: number, observerHeight: number): string {
  return `${RESULT_CACHE_PREFIX}${lat.toFixed(5)},${lon.toFixed(5)},${observerHeight.toFixed(1)}`;
}

interface StoredResult {
  /** Last use (see storageCache). */
  t: number;
  stepDeg: number;
  e: number[];
  siteElevation: number;
  tiles: number;
}

/** Cached result (refreshing its last-use stamp), or null if absent or invalid. */
function readCachedResult(key: string): TerrainHorizonResult | null {
  try {
    const storage = getStorage();
    const raw = storage?.getItem(key);
    if (!storage || !raw) return null;
    const s = JSON.parse(raw) as Partial<StoredResult>;
    const e = s.e;
    if (
      !Array.isArray(e) ||
      e.length === 0 ||
      !e.every((x) => typeof x === 'number' && Number.isFinite(x)) ||
      typeof s.stepDeg !== 'number' ||
      Math.abs(s.stepDeg * e.length - 360) > 1e-6 ||
      typeof s.siteElevation !== 'number' ||
      typeof s.tiles !== 'number'
    ) {
      return null;
    }
    touchCacheEntry(storage, key, s);
    return { profile: { stepDeg: s.stepDeg, elevations: e }, siteElevation: s.siteElevation, tiles: s.tiles };
  } catch {
    return null;
  }
}

function writeCachedResult(key: string, r: TerrainHorizonResult, max: number): void {
  const storage = getStorage();
  if (!storage) return;
  const value: Omit<StoredResult, 't'> = {
    stepDeg: r.profile.stepDeg,
    e: r.profile.elevations.map((x) => Math.round(x * 100) / 100),
    siteElevation: Math.round(r.siteElevation * 10) / 10,
    tiles: r.tiles,
  };
  writeCacheEntry(storage, RESULT_CACHE_PREFIX, max, key, value);
}

function checkLocation(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 85) {
    throw new RangeError(`Terrain horizon: invalid location ${latitude}, ${longitude}`);
  }
}

/**
 * Terrain horizon for a site from AWS Terrarium DEM tiles (multi-resolution, see TERRAIN_ZOOM_BANDS).
 * Downloads at most TILE_CONCURRENCY tiles at once, keeps decoded tiles in memory and the result in
 * localStorage (the TERRAIN_RESULT_CACHE_MAX most recently used results; key: lat/lon rounded to 5
 * decimals ≈ 1 m, observer height). The site elevation is taken from the DEM. Rejects with the signal's reason
 * (AbortError) when aborted, or on a failed tile.
 */
export async function fetchTerrainHorizon(
  latitude: number,
  longitude: number,
  opts: FetchTerrainOptions = {},
): Promise<TerrainHorizonResult> {
  const { signal, fetchImpl, onProgress, cache, cacheMax } = opts;
  const observerHeight = opts.observerHeight ?? DEFAULT_OBSERVER_HEIGHT_M;
  const results = await fetchTerrainHorizons(latitude, longitude, {
    signal,
    fetchImpl,
    onProgress,
    cache,
    cacheMax,
    observerHeights: [observerHeight],
  });
  return results[observerHeight];
}

/** The results of `observerHeights` at a site that are in the localStorage result cache (keyed by height). */
export function cachedTerrainHorizons(
  latitude: number,
  longitude: number,
  observerHeights: readonly number[],
): Record<number, TerrainHorizonResult> {
  const out: Record<number, TerrainHorizonResult> = {};
  for (const h of observerHeights) {
    const cached = readCachedResult(resultCacheKey(latitude, longitude, h));
    if (cached) out[h] = cached;
  }
  return out;
}

/**
 * fetchTerrainHorizon for several observer heights of one site (keyed by height): each height comes from
 * the localStorage result cache if there, the others are computed together from one download (`compute`,
 * computeHorizons) and cached. Progress as fetchTerrainHorizon: all heights cached → (n, n) once.
 */
export async function fetchTerrainHorizons(
  latitude: number,
  longitude: number,
  opts: FetchTerrainHorizonsOptions = {},
): Promise<Record<number, TerrainHorizonResult>> {
  checkLocation(latitude, longitude);
  const { signal, onProgress } = opts;
  const heights = [...new Set(opts.observerHeights ?? [DEFAULT_OBSERVER_HEIGHT_M])];
  const useCache = opts.cache ?? true;
  throwIfAborted(signal);
  const out = useCache ? cachedTerrainHorizons(latitude, longitude, heights) : {};
  const missing = heights.filter((h) => !out[h]);
  if (missing.length === 0) {
    const tiles = heights.length > 0 ? out[heights[0]].tiles : 0;
    onProgress?.(tiles, tiles);
    return out;
  }
  if (missing.length < heights.length) opts.onCached?.({ ...out });
  if (opts.beforeDownload) {
    const ready = opts.beforeDownload();
    await (signal ? raceAbort(ready, signal) : ready);
  }
  throwIfAborted(signal);
  const compute = opts.compute ?? computeTerrainHorizons;
  const results = await compute(latitude, longitude, missing, {
    signal,
    fetchImpl: opts.fetchImpl,
    onProgress,
  });
  throwIfAborted(signal);
  missing.forEach((h, i) => {
    out[h] = results[i];
    if (useCache) {
      writeCachedResult(
        resultCacheKey(latitude, longitude, h),
        results[i],
        opts.cacheMax ?? TERRAIN_RESULT_CACHE_MAX,
      );
    }
  });
  return out;
}

/**
 * Downloads (or reuses from memory) the tiles of a site and computes its horizon for every observer height
 * in one pass (computeHorizons); results in the order of `observerHeights`. No localStorage: this is what a
 * Web Worker runs for fetchTerrainHorizons. Rejects like fetchTerrainHorizon.
 */
export async function computeTerrainHorizons(
  latitude: number,
  longitude: number,
  observerHeights: readonly number[],
  opts: TerrainComputeOptions = {},
): Promise<TerrainHorizonResult[]> {
  checkLocation(latitude, longitude);
  const { signal, onProgress } = opts;
  throwIfAborted(signal);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const plan = tilePlan(latitude, longitude);
  const total = plan.length;
  const tiles: TerrainTile[] = new Array<TerrainTile>(total);
  // Internal controller: stops the remaining downloads on the first error or on the caller's abort.
  const ctrl = new AbortController();
  const onAbort = (): void => ctrl.abort(signal ? abortError(signal) : undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  let next = 0;
  let done = 0;
  onProgress?.(0, total);
  const worker = async (): Promise<void> => {
    while (next < total) {
      const idx = next++;
      throwIfAborted(ctrl.signal);
      const t = plan[idx];
      tiles[idx] = { ...t, heights: await loadTile(tileUrl(t), fetchImpl, ctrl.signal) };
      done++;
      onProgress?.(done, total);
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(TILE_CONCURRENCY, total) }, () =>
        worker().catch((e: unknown) => {
          ctrl.abort(e);
          throw e;
        }),
      ),
    );
  } catch (e) {
    throwIfAborted(signal);
    throw e;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  throwIfAborted(signal);

  const horizons = computeHorizons(createTileSampler(tiles), { latitude, longitude }, observerHeights);
  return horizons.map((horizon) => ({ ...horizon, tiles: total }));
}
