// ─────────────────────────────────────────────
// LASER-SCAN (swissSURFACE3D) HELPERS FOR THE PAGE
// The small, pure parts of model/dsm.ts that the page needs (loader, settings): the extent of the scan, the
// algorithm version of cached horizons, what a site's downloads depend on and the download estimate. Kept
// apart so the page's main chunk does not pull in the scan pipeline (COG reader, LZW, vector tiles), which
// runs in the terrain worker; model/dsm.ts re-exports everything here.
// ─────────────────────────────────────────────

/** Extent of the swissSURFACE3D Raster collection [west, south, east, north] (STAC, 2026-09-25). */
export const DSM_COLLECTION_BBOX: readonly [number, number, number, number] = [
  5.9503666, 45.7213375, 10.4998461, 47.8216742,
];

/** True when the site lies within the collection's extent (else there is no scan data: no request). */
export function insideDsmExtent(latitude: number, longitude: number): boolean {
  const [w, s, e, n] = DSM_COLLECTION_BBOX;
  return latitude >= s && latitude <= n && longitude >= w && longitude <= e;
}

/**
 * Bump when the computation changes: cached horizons of older versions are ignored.
 * 2: the own-building zone no longer comes from the masked-raster memory of another balcony depth, row
 * width or own footprint (horizons cached by version 1 may carry that error).
 * 3: rays visit every cell they cross (not samples every 0.25 m) and the own zone is tested on the cell read.
 */
export const DSM_ALGORITHM_VERSION = 3;

/**
 * Window margin around radius, m: observers sit up to balcony depth (≤ 4 m) + half a panel (≤ 1.25 m) in front
 * of the site, and their rays reach `radius` from there.
 */
export const DSM_WINDOW_MARGIN_M = 8;

/** What a site's downloads depend on (see dsmDataKey). */
export interface DsmDataInputs {
  latitude: number;
  longitude: number;
  radius: number;
  trees: boolean;
  /** Footprints masked to the ground (only whether there are any matters for the downloads). */
  masks: { polygons: readonly unknown[] } | null;
}

/** True when the site needs the ground model under masked cells (masks, or trees off). */
export const dsmNeedsMasks = (site: DsmDataInputs): boolean =>
  !site.trees || (site.masks?.polygons.length ?? 0) > 0;

/**
 * Key of the data a site needs in the worker's memory: the scan window (site, radius), the ground at the
 * site, the 2 m terrain under masks and, without trees, the building vector tiles. Facade, balcony, row width,
 * the masked footprints themselves and the observers change only the computation, never the downloads.
 */
export function dsmDataKey(site: DsmDataInputs): string {
  return [
    site.latitude.toFixed(6),
    site.longitude.toFixed(6),
    site.radius,
    site.trees ? 't' : 'b',
    dsmNeedsMasks(site) ? 'm' : '-',
  ].join('|');
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
