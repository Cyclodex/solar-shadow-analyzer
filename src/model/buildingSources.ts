import { VectorTile, classifyRings } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { type GeoPoint, WGS84_A, lonLatToEnu, wgs84Radii } from './enu';
import { NetError, fetchBytesWithRetry, fetchReadWithRetry, type RetryOptions } from './fetchRetry';
import {
  clipRingToBox,
  dropDuplicateVertices,
  ensureCcw,
  pointInRing,
  ringArea,
  ringBounds,
  ringDistance,
  type Ring,
} from './polygon';
import { toDeg, toRad } from './units';

// ─────────────────────────────────────────────
// SURROUNDING BUILDINGS FROM SWISSTOPO VECTOR TILES (CH + FL)
// Source: swisstopo base map vector tiles (ch.swisstopo.base.vt v1.0.0, Mapbox Vector Tiles, maxzoom 14,
// CORS *, gzip), layer `building` ("buildings including roofs without sidewalls") with the fields `class`
// (string, mostly absent; 'roof', 'place_of_worship', 'underground', …), `render_height` and
// `render_min_height` (numbers, whole metres, min. 5 m). Checked on live tiles 2026-09-25 (Kramgasse 49, Bern:
// 14/8530–8531/5765–5766, 2,366–4,858 building features per tile): extent 4096, no feature ids, polygons
// clipped at a 16-unit buffer (≈ 6.5 m) around each tile, render_min_height 0 everywhere. Outside CH/FL the
// tiles have no `building` layer (Munich, Mulhouse, Como: only `administrative_unit`), and outside the
// tileset's bounds ([3.57, 44.18, 13.66, 48.88], e.g. Paris, Vienna) the server answers 404: both count as
// "no data" (covered false), not as an error. Tiles at the border hold buildings on the CH/FL side only; the
// `administrative_unit` layer has the area outside CH/FL as a country polygon (admin_level 2, iso_a2
// 'not_CH_LI'), from which `coverage` (share of the circle inside CH/FL) is computed.
// A building crossing a tile edge appears in both tiles, each copy cut at that tile's buffer: 322 of the
// 14,655 parts in the four Kramgasse tiles straddle an inner tile edge, 204 of them are cut in both tiles.
// Each part is therefore clipped to its own tile's exact square, and pieces meeting across a tile edge with
// the same height and class are joined again (edge cancellation on the shared edge, see mergeSeamPieces).
// Measured on the live Kramgasse tiles: 179 same-height pairs split at tile edges without joining, 0 after it;
// within 300 m 1,545 → 1,513 parts. Parts of class 'underground' (which do carry render_height) are skipped.
// Attribution «© swisstopo» (tiles.json; mandatory). Web Mercator tiles → lat/lon → ENU metres around the
// requested point (enu.ts); LV95 is not involved. Never throws: errors come back as typed results.
// ─────────────────────────────────────────────

/** Tileset base URL. */
export const SWISSTOPO_VT_BASE = 'https://vectortiles.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0';
/** TileJSON of the tileset (attribution). */
export const SWISSTOPO_VT_TILEJSON = `${SWISSTOPO_VT_BASE}/tiles.json`;
/** Zoom of the building tiles (the tileset's maxzoom; 1670 m × 1670 m per tile at 47° N, 0.41 m per unit). */
export const BUILDING_TILE_ZOOM = 14;
/** Attribution when tiles.json cannot be read. */
export const SWISSTOPO_ATTRIBUTION = '© swisstopo';
/** Vector tile layer with the building parts. */
export const BUILDING_LAYER = 'building';
/** Building classes without volume above ground: skipped. */
export const SKIPPED_BUILDING_CLASSES: readonly string[] = ['underground'];
/** Largest accepted radius, m (a 2 km radius already needs up to 16 tiles). */
export const MAX_BUILDING_RADIUS = 2000;
/** Parallel tile requests. */
const TILE_CONCURRENCY = 4;
/** Seam vertices of two pieces closer than this (tile units, 0.41 m at z14) along the tile edge are the same. */
const SEAM_SNAP_UNITS = 1;
/** A vertex on a tile edge less than this (tile units) off the line through its neighbours is dropped. */
const SEAM_KINK_UNITS = 0.5;
/** Polygons whose bounding box stays farther than radius + this (m) from the point are skipped early. */
const PREFILTER_MARGIN_M = 100;

/**
 * Default retry parameters for tiles: fewer and shorter than the geo.admin.ch defaults (interactive import). A tile
 * (≤ 220 kB) that has not fully arrived after 10 s is requested again (0.5 Mbit/s needs 3.5 s).
 */
const TILE_RETRY: Omit<RetryOptions, 'signal' | 'fetchImpl'> = {
  retries: 3,
  maxDelayMs: 4000,
  deadlineMs: 15000,
  attemptTimeoutMs: 10000,
};

/** One building part around the requested point. */
export interface BuildingPart {
  /** Outer ring [east, north] in m of the requested point (ENU, true north), counter-clockwise, open, 1 cm. */
  footprint: [number, number][];
  /** Holes (courtyards), clockwise; absent when there are none. See polygon.ts bridgeHoles. */
  holes?: [number, number][][];
  /** Top of the part above ground, m (render_height). */
  height: number;
  /** Bottom above ground, m (render_min_height; 0 in all data checked). */
  minHeight: number;
  /** Layer class, e.g. 'roof' (roof without walls) or 'place_of_worship'; null when absent (most parts). */
  kind: string | null;
  /** Feature id. The swisstopo base tiles carry none (checked 2026-09-25): always undefined today. */
  featureId?: number;
}

export type BuildingSourceErrorKind = 'aborted' | 'network' | 'http' | 'timeout' | 'decode' | 'invalid-input';

export interface BuildingSourceError {
  kind: BuildingSourceErrorKind;
  /** Technical message (English). */
  message: string;
  /** HTTP status for kind 'http' (and 'timeout' after HTTP errors). */
  status?: number;
}

export type BuildingFetchResult =
  | {
      ok: true;
      /** Parts that reach into the radius (distance of their area to the point ≤ radius). */
      parts: BuildingPart[];
      /** Attribution to show (tiles.json, else SWISSTOPO_ATTRIBUTION). */
      attribution: string;
      tileCount: number;
      /** Bytes received (Content-Length where exposed, else decoded size). */
      bytes: number;
      /** False when the circle lies outside CH/FL (no tile data there): parts is then empty for that reason. */
      covered: boolean;
      /**
       * Share of the circle's area inside CH/FL, 0–1 (0.001; sampled on a grid). Below 1 at border sites
       * (Basel, Kreuzlingen, Geneva, Chiasso …): buildings on the other side of the border are missing.
       */
      coverage: number;
      /** Pieces joined across tile edges (a part assembled from n pieces counts n − 1). */
      mergedPieces: number;
    }
  | { ok: false; error: BuildingSourceError; tileCount: number; bytes: number };

export interface FetchBuildingsOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** After each tile: tiles done, total, bytes so far. */
  onProgress?: (done: number, total: number, bytes: number) => void;
  /** Retry parameters (tests: instant sleep). */
  retry?: Omit<RetryOptions, 'signal' | 'fetchImpl'>;
}

// ── Tile maths ───────────────────────────────

/** A tile address. */
export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** Fractional Web Mercator tile coordinates of a position at zoom z. */
export function lonLatToTile(latitude: number, longitude: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const lat = toRad(Math.max(-85.0511, Math.min(85.0511, latitude)));
  return {
    x: ((longitude + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
  };
}

/** Position of fractional tile coordinates at zoom z. */
export function tileToLonLat(x: number, y: number, z: number): GeoPoint {
  const n = 2 ** z;
  return {
    longitude: (x / n) * 360 - 180,
    latitude: toDeg(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)))),
  };
}

/** Tiles at zoom z covering the bounding box of the circle (radius m) around the point, row by row. */
export function tilesForRadius(
  latitude: number,
  longitude: number,
  radius: number,
  z = BUILDING_TILE_ZOOM,
): TileId[] {
  const { meridian, primeVertical } = wgs84Radii(latitude);
  const dLat = toDeg(radius / meridian);
  const dLon = toDeg(radius / (primeVertical * Math.cos(toRad(latitude))));
  const nw = lonLatToTile(latitude + dLat, longitude - dLon, z);
  const se = lonLatToTile(latitude - dLat, longitude + dLon, z);
  const out: TileId[] = [];
  for (let y = Math.floor(nw.y); y <= Math.floor(se.y); y++) {
    for (let x = Math.floor(nw.x); x <= Math.floor(se.x); x++) out.push({ z, x, y });
  }
  return out;
}

export function buildingTileUrl(t: TileId): string {
  return `${SWISSTOPO_VT_BASE}/${t.z}/${t.x}/${t.y}.pbf`;
}

// ── Decoding ─────────────────────────────────

/** Tile units per tile in the global coordinates (MVT extents are rescaled to it). */
const UNITS = 4096;

/** A building polygon of one tile in global tile units (x · 4096 + px at the tile's zoom), before clipping. */
export interface TilePolygon {
  outer: Ring;
  holes: Ring[];
  height: number;
  minHeight: number;
  kind: string | null;
  featureId?: number;
}

/** Decoded building layer of one tile. */
export interface DecodedTile {
  tile: TileId;
  polygons: TilePolygon[];
  /**
   * Names of all layers in the tile (a tile outside CH/FL has only 'administrative_unit'; a tile the server does
   * not have (404, outside the tileset's bounds) none).
   */
  layers: string[];
  /** Areas outside CH/FL in this tile ('not_CH_LI' country polygons, [outer, ...holes], global tile units). */
  outside: Ring[][];
}

/** Layer with the administrative units (country polygons among them). */
export const ADMIN_LAYER = 'administrative_unit';
/** iso_a2 of the country polygon covering everything outside Switzerland and Liechtenstein. */
const OUTSIDE_CH_LI = 'not_CH_LI';

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Gunzips `bytes` when they are gzip (servers may send .pbf gzipped without Content-Encoding). */
export async function maybeGunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isGzip(bytes)) return bytes;
  if (typeof DecompressionStream === 'undefined') throw new Error('gzip tile but no DecompressionStream');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Building polygons of an (uncompressed) MVT tile, in global tile units. Throws on corrupt data. */
export function decodeBuildingTile(bytes: Uint8Array, tile: TileId): DecodedTile {
  const vt = new VectorTile(new PbfReader(bytes));
  const layers = Object.keys(vt.layers);
  const layer = vt.layers[BUILDING_LAYER];
  const polygons: TilePolygon[] = [];
  const ox = tile.x * UNITS;
  const oy = tile.y * UNITS;
  const outside: Ring[][] = [];
  const admin = vt.layers[ADMIN_LAYER];
  if (admin) {
    const scale = UNITS / admin.extent;
    for (let i = 0; i < admin.length; i++) {
      const f = admin.feature(i);
      if (f.type !== 3 || f.properties.iso_a2 !== OUTSIDE_CH_LI) continue;
      for (const poly of classifyRings(f.loadGeometry())) {
        const rings = poly
          .map((r) =>
            dropDuplicateVertices(r.map((p): [number, number] => [ox + p.x * scale, oy + p.y * scale])),
          )
          .filter((r) => r.length >= 3);
        if (rings.length > 0) outside.push(rings);
      }
    }
  }
  if (!layer) return { tile, polygons, layers, outside };
  const scale = UNITS / layer.extent;
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3) continue;
    const props = f.properties;
    const kind = typeof props.class === 'string' ? props.class : null;
    if (kind !== null && SKIPPED_BUILDING_CLASSES.includes(kind)) continue;
    const height = typeof props.render_height === 'number' ? props.render_height : NaN;
    if (!(height > 0)) continue;
    const minHeight = typeof props.render_min_height === 'number' ? Math.max(0, props.render_min_height) : 0;
    for (const poly of classifyRings(f.loadGeometry())) {
      const rings = poly.map((r) =>
        dropDuplicateVertices(r.map((p): [number, number] => [ox + p.x * scale, oy + p.y * scale])),
      );
      const [outer, ...holes] = rings;
      if (!outer || outer.length < 3) continue;
      polygons.push({
        outer,
        holes: holes.filter((h) => h.length >= 3),
        height,
        minHeight,
        kind,
        ...(f.id !== undefined ? { featureId: f.id } : {}),
      });
    }
  }
  return { tile, polygons, layers, outside };
}

/** A tile the server does not have (404): no data, like a tile outside CH/FL. */
function emptyTile(tile: TileId): DecodedTile {
  return { tile, polygons: [], layers: [], outside: [] };
}

/** Grid points per radius for coverageFraction (≈ π · 24² ≈ 1,800 points in the circle). */
const COVERAGE_GRID = 24;

/**
 * Share of the circle (radius m around the point) inside CH/FL, 0–1 rounded to 0.001, from decoded tiles: a grid
 * point counts as outside when its tile has no map data (only 'administrative_unit', or 404) or when it lies in
 * the tile's 'not_CH_LI' country polygon; points in tiles not given are not counted. Pure (no network).
 */
export function coverageFraction(
  tiles: readonly DecodedTile[],
  latitude: number,
  longitude: number,
  radius: number,
): number {
  const byKey = new Map(tiles.map((t) => [`${t.tile.x}/${t.tile.y}`, t]));
  const zoom = tiles[0]?.tile.z ?? BUILDING_TILE_ZOOM;
  const site = lonLatToTile(latitude, longitude, zoom);
  const metresPerUnit = (2 * Math.PI * WGS84_A * Math.cos(toRad(latitude))) / (2 ** zoom * UNITS);
  const reach = radius / metresPerUnit;
  const step = reach / COVERAGE_GRID;
  let inside = 0;
  let total = 0;
  for (let i = -COVERAGE_GRID; i <= COVERAGE_GRID; i++) {
    for (let j = -COVERAGE_GRID; j <= COVERAGE_GRID; j++) {
      if (i * i + j * j > COVERAGE_GRID * COVERAGE_GRID) continue;
      const x = site.x * UNITS + i * step;
      const y = site.y * UNITS + j * step;
      const t = byKey.get(`${Math.floor(x / UNITS)}/${Math.floor(y / UNITS)}`);
      // Not among the tiles given (the rim may reach a few dm past tilesForRadius, whose ellipsoidal radii differ
      // slightly from the Mercator scale used here): not counted, so an inland site stays at exactly 1.
      if (!t) continue;
      total++;
      if (!t.layers.some((l) => l !== ADMIN_LAYER)) continue;
      const out = t.outside.some(
        ([outer, ...holes]) => pointInRing(outer, x, y) && !holes.some((h) => pointInRing(h, x, y)),
      );
      if (!out) inside++;
    }
  }
  return total > 0 ? Math.round((inside / total) * 1000) / 1000 : 0;
}

// ── Assembly: clip to tiles, join across tile edges, ENU ──

interface Piece {
  tile: TileId;
  rings: Ring[]; // [outer, ...holes], global units
  poly: TilePolygon;
  key: string;
  /** The polygon reaches its tile's edge (clipped, may continue in the neighbour tile). */
  touches: boolean;
}

/** Union-find over piece indices. */
function unionFind(n: number): { find: (i: number) => number; union: (a: number, b: number) => void } {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  return { find, union: (a, b) => void (parent[find(a)] = find(b)) };
}

interface SeamSegment {
  piece: number;
  /** 'x' = vertical tile edge x = coord, 'y' = horizontal tile edge y = coord. */
  axis: 'x' | 'y';
  coord: number;
  lo: number;
  hi: number;
}

/** Edges of a piece's rings lying on an edge of its own tile. */
function seamSegments(p: Piece, index: number): SeamSegment[] {
  const out: SeamSegment[] = [];
  const x0 = p.tile.x * UNITS;
  const y0 = p.tile.y * UNITS;
  const lines: ['x' | 'y', number][] = [
    ['x', x0],
    ['x', x0 + UNITS],
    ['y', y0],
    ['y', y0 + UNITS],
  ];
  for (const ring of p.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j];
      const b = ring[i];
      for (const [axis, coord] of lines) {
        const k = axis === 'x' ? 0 : 1;
        if (a[k] === coord && b[k] === coord) {
          const u = 1 - k;
          out.push({ piece: index, axis, coord, lo: Math.min(a[u], b[u]), hi: Math.max(a[u], b[u]) });
        }
      }
    }
  }
  return out;
}

const vkey = (p: readonly [number, number]): string => `${p[0]},${p[1]}`;

/**
 * Joins pieces of one building cut at tile edges: vertices on the shared tile edges are snapped together
 * (SEAM_SNAP_UNITS), edges on them split at every seam vertex, and pairs of opposite edges (the cut) cancel.
 * The remaining edges are linked into rings; the result may still be several polygons (pieces that only
 * touch). Returns [outer, ...holes] per polygon, outer rings with the orientation of the input outer rings.
 */
export function mergeSeamPieces(
  pieces: readonly Ring[][],
  seams: readonly { axis: 'x' | 'y'; coord: number }[],
): Ring[][] {
  // Consistent orientation: outer rings positive, holes negative (global units, y down: any fixed choice works).
  const rings: Ring[] = [];
  for (const rs of pieces) {
    rs.forEach((r, i) => {
      const a = ringArea(r);
      const want = i === 0 ? 1 : -1;
      rings.push(
        Math.sign(a) === want || a === 0 ? r.map((p): [number, number] => [p[0], p[1]]) : [...r].reverse(),
      );
    });
  }
  // Snap seam vertices: along each seam line, values within SEAM_SNAP_UNITS collapse to the first of a cluster.
  for (const s of seams) {
    const k = s.axis === 'x' ? 0 : 1;
    const u = 1 - k;
    const values = [
      ...new Set(rings.flatMap((r) => r.filter((p) => p[k] === s.coord).map((p) => p[u]))),
    ].sort((a, b) => a - b);
    const snap = new Map<number, number>();
    let anchor = NaN;
    for (const v of values) {
      if (!(v - anchor <= SEAM_SNAP_UNITS)) anchor = v;
      snap.set(v, anchor);
    }
    for (const r of rings) for (const p of r) if (p[k] === s.coord) p[u] = snap.get(p[u]) ?? p[u];
  }
  // Directed edges, split at every seam vertex lying inside a seam edge.
  const seamStops = seams.map((s) => {
    const k = s.axis === 'x' ? 0 : 1;
    return {
      ...s,
      k,
      stops: [...new Set(rings.flatMap((r) => r.filter((p) => p[k] === s.coord).map((p) => p[1 - k])))].sort(
        (a, b) => a - b,
      ),
    };
  });
  const edges: [[number, number], [number, number]][] = [];
  for (const r of dropDegenerate(rings)) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const seam = seamStops.find((s) => a[s.k] === s.coord && b[s.k] === s.coord);
      if (!seam) {
        edges.push([a, b]);
        continue;
      }
      const u = 1 - seam.k;
      const dir = Math.sign(b[u] - a[u]);
      const inner = seam.stops.filter((v) => (v - a[u]) * dir > 0 && (b[u] - v) * dir > 0);
      if (dir < 0) inner.reverse();
      let prev = a;
      for (const v of inner) {
        const p: [number, number] = seam.k === 0 ? [seam.coord, v] : [v, seam.coord];
        edges.push([prev, p]);
        prev = p;
      }
      edges.push([prev, b]);
    }
  }
  // Cancel opposite pairs (the cut) and zero-length edges.
  const count = new Map<string, number>();
  const ekey = (a: readonly [number, number], b: readonly [number, number]): string =>
    `${vkey(a)}>${vkey(b)}`;
  for (const [a, b] of edges) count.set(ekey(a, b), (count.get(ekey(a, b)) ?? 0) + 1);
  const kept: [[number, number], [number, number]][] = [];
  for (const [a, b] of edges) {
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const fwd = ekey(a, b);
    const rev = ekey(b, a);
    const nf = count.get(fwd) ?? 0;
    const nr = count.get(rev) ?? 0;
    if (nr > 0 && nf > 0) {
      count.set(fwd, nf - 1);
      count.set(rev, nr - 1);
      continue;
    }
    if (nf > 0) {
      count.set(fwd, nf - 1);
      kept.push([a, b]);
    }
  }
  // Link into rings.
  const from = new Map<string, number[]>();
  kept.forEach(([a], i) => from.set(vkey(a), [...(from.get(vkey(a)) ?? []), i]));
  const used = new Array<boolean>(kept.length).fill(false);
  const out: Ring[] = [];
  for (let s = 0; s < kept.length; s++) {
    if (used[s]) continue;
    const ring: Ring = [];
    let e = s;
    const start = vkey(kept[s][0]);
    for (let guard = 0; guard <= kept.length; guard++) {
      used[e] = true;
      ring.push([kept[e][0][0], kept[e][0][1]]);
      const end = vkey(kept[e][1]);
      if (end === start) break;
      const next = (from.get(end) ?? []).find((i) => !used[i]);
      if (next === undefined) break;
      e = next;
    }
    const clean = cleanRing(ring, seams);
    if (clean.length >= 3 && Math.abs(ringArea(clean)) > 1e-9) out.push(clean);
  }
  // Outer rings (positive) with their holes (negative, assigned to the outer ring containing them).
  const outers = out.filter((r) => ringArea(r) > 0);
  const holes = out.filter((r) => ringArea(r) < 0);
  const polys: Ring[][] = outers.map((r) => [r]);
  for (const h of holes) {
    const [hx, hy] = h[0];
    const owner = polys.find(
      (p) => ringDistance(p[0], hx, hy) === 0 || p[0].some((q) => q[0] === hx && q[1] === hy),
    );
    owner?.push(h);
  }
  return polys;
}

function dropDegenerate(rings: Ring[]): Ring[] {
  return rings.map((r) => dropDuplicateVertices(r)).filter((r) => r.length >= 3);
}

/** Removes spikes (a → b → a) and collinear vertices on straight runs, repeatedly. */
function cleanRing(ring: Ring, seams: readonly { axis: 'x' | 'y'; coord: number }[]): Ring {
  let r = dropDuplicateVertices(ring);
  const onSeam = (p: readonly [number, number]): boolean =>
    seams.some((s) => p[s.axis === 'x' ? 0 : 1] === s.coord);
  for (let changed = true; changed && r.length >= 3;) {
    changed = false;
    for (let i = 0; i < r.length && r.length >= 3; i++) {
      const a = r[(i - 1 + r.length) % r.length];
      const b = r[i];
      const c = r[(i + 1) % r.length];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      // Collinear or a spike; on a tile edge also the kink where the two copies' rounding differs (< 0.5 unit
      // off the straight line through its neighbours: the outline just crosses the edge there).
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const kink =
        onSeam(b) && len > 0 && Math.abs(cross) / len < SEAM_KINK_UNITS && !(a[0] === c[0] && a[1] === c[1]);
      if (Math.abs(cross) < 1e-9 || kink) {
        r.splice(i, 1);
        r = dropDuplicateVertices(r);
        changed = true;
        i--;
      }
    }
  }
  return r;
}

/**
 * Building parts around (latitude, longitude) from decoded tiles: every polygon clipped to its own tile, pieces
 * of one building joined across the edges between loaded tiles, converted to ENU metres, kept when their
 * area comes within `radius` of the point. Pure (no network): also usable in the terrain worker.
 */
export function assembleBuildingParts(
  tiles: readonly DecodedTile[],
  latitude: number,
  longitude: number,
  radius: number,
): { parts: BuildingPart[]; mergedPieces: number } {
  const loaded = new Set(tiles.map((t) => `${t.tile.z}/${t.tile.x}/${t.tile.y}`));
  const zoom = tiles[0]?.tile.z ?? BUILDING_TILE_ZOOM;
  // Polygons far outside the circle are skipped before any work (a 300 m circle needs ~10 % of 4 tiles). The
  // margin keeps the other pieces of buildings that cross the circle and a tile edge (≤ PREFILTER_MARGIN_M long).
  const site = lonLatToTile(latitude, longitude, zoom);
  const metresPerUnit = (2 * Math.PI * WGS84_A * Math.cos(toRad(latitude))) / (2 ** zoom * UNITS);
  const reach = (radius + PREFILTER_MARGIN_M) / metresPerUnit;
  const [sx, sy] = [site.x * UNITS, site.y * UNITS];
  const pieces: Piece[] = [];
  for (const t of tiles) {
    const x0 = t.tile.x * UNITS;
    const y0 = t.tile.y * UNITS;
    for (const poly of t.polygons) {
      const [bx0, by0, bx1, by1] = ringBounds(poly.outer);
      if (bx1 < sx - reach || bx0 > sx + reach || by1 < sy - reach || by0 > sy + reach) continue;
      // Most polygons lie inside their tile: no clipping and no tile-edge contact.
      const touches = bx0 <= x0 || by0 <= y0 || bx1 >= x0 + UNITS || by1 >= y0 + UNITS;
      const outer = touches ? clipRingToBox(poly.outer, x0, y0, x0 + UNITS, y0 + UNITS) : poly.outer;
      if (outer.length < 3 || Math.abs(ringArea(outer)) < 1e-6) continue;
      const holes = touches
        ? poly.holes
            .map((h) => clipRingToBox(h, x0, y0, x0 + UNITS, y0 + UNITS))
            .filter((h) => h.length >= 3 && Math.abs(ringArea(h)) > 1e-6)
        : poly.holes;
      pieces.push({
        tile: t.tile,
        rings: [outer, ...holes],
        poly,
        key: `${poly.height}|${poly.minHeight}|${poly.kind ?? ''}`,
        touches,
      });
    }
  }
  // Pieces touching an edge shared with another loaded tile, grouped by edge line and building attributes.
  const byLine = new Map<string, SeamSegment[]>();
  pieces.forEach((p, i) => {
    if (!p.touches) return;
    for (const s of seamSegments(p, i)) {
      const z = p.tile.z;
      const cell = Math.round(s.coord / UNITS);
      const other =
        s.axis === 'x'
          ? `${z}/${cell === p.tile.x ? p.tile.x - 1 : p.tile.x + 1}/${p.tile.y}`
          : `${z}/${p.tile.x}/${cell === p.tile.y ? p.tile.y - 1 : p.tile.y + 1}`;
      if (!loaded.has(other)) continue;
      const k = `${s.axis}${s.coord}|${p.key}`;
      byLine.set(k, [...(byLine.get(k) ?? []), s]);
    }
  });
  const uf = unionFind(pieces.length);
  const seamsOf = new Map<number, { axis: 'x' | 'y'; coord: number }[]>();
  for (const segs of byLine.values()) {
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i];
        const b = segs[j];
        if (a.piece === b.piece || pieces[a.piece].tile === pieces[b.piece].tile) continue;
        // Pieces of one building share a stretch of the tile edge (touching at a point is not enough).
        const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
        if (overlap > 0) {
          uf.union(a.piece, b.piece);
          for (const s of [a, b]) {
            const list = seamsOf.get(s.piece) ?? [];
            if (!list.some((q) => q.axis === s.axis && q.coord === s.coord))
              list.push({ axis: s.axis, coord: s.coord });
            seamsOf.set(s.piece, list);
          }
        }
      }
    }
  }
  const groups = new Map<number, number[]>();
  pieces.forEach((_, i) => {
    const r = uf.find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });

  const anchor: GeoPoint = { latitude, longitude };
  const toEnu = (p: readonly [number, number]): [number, number] => {
    const g = tileToLonLat(p[0] / UNITS, p[1] / UNITS, zoom);
    const [e, n] = lonLatToEnu(anchor, g.latitude, g.longitude);
    return [Math.round(e * 100) / 100 + 0, Math.round(n * 100) / 100 + 0];
  };
  const parts: BuildingPart[] = [];
  let mergedPieces = 0;
  for (const members of groups.values()) {
    const first = pieces[members[0]];
    let polys: Ring[][];
    if (members.length === 1) {
      polys = [first.rings];
    } else {
      const seams = members.flatMap((m) => seamsOf.get(m) ?? []);
      polys = mergeSeamPieces(
        members.map((m) => pieces[m].rings),
        seams.filter((s, i) => seams.findIndex((q) => q.axis === s.axis && q.coord === s.coord) === i),
      );
      mergedPieces += members.length - polys.length;
    }
    for (const [outer, ...holes] of polys) {
      const footprint = ensureCcw(dropDuplicateVertices(outer.map(toEnu)));
      if (footprint.length < 3 || ringDistance(footprint, 0, 0) > radius) continue;
      const enuHoles = holes
        .map((h) => ensureCcw(dropDuplicateVertices(h.map(toEnu))).reverse())
        .filter((h) => h.length >= 3);
      parts.push({
        footprint,
        ...(enuHoles.length > 0 ? { holes: enuHoles } : {}),
        height: first.poly.height,
        minHeight: first.poly.minHeight,
        kind: first.poly.kind,
        ...(first.poly.featureId !== undefined ? { featureId: first.poly.featureId } : {}),
      });
    }
  }
  return { parts, mergedPieces };
}

// ── Network ──────────────────────────────────

class DecodeError extends Error {}

/** Decoded tiles of recent imports (LRU by insertion order), keyed by URL. */
const TILE_CACHE_MAX = 16;
const tileCache = new Map<string, { tile: DecodedTile; bytes: number }>();

/** Empties the in-memory tile cache (tests). */
export function clearBuildingTileCache(): void {
  tileCache.clear();
  attributionPromise = null;
}

let attributionPromise: Promise<string> | null = null;

/** Attribution from tiles.json (once per session), SWISSTOPO_ATTRIBUTION when it cannot be read. */
function tilesetAttribution(
  fetchImpl: typeof fetch | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  attributionPromise ??= (async () => {
    try {
      const json: unknown = await fetchReadWithRetry(SWISSTOPO_VT_TILEJSON, (res) => res.json(), {
        fetchImpl,
        signal,
        retries: 1,
        jitterMs: 200,
        attemptTimeoutMs: 8000,
      });
      const a =
        typeof json === 'object' && json !== null ? (json as Record<string, unknown>).attribution : null;
      return typeof a === 'string' && a.trim() !== '' ? a.trim() : SWISSTOPO_ATTRIBUTION;
    } catch {
      attributionPromise = null; // try again next time
      return SWISSTOPO_ATTRIBUTION;
    }
  })();
  return attributionPromise;
}

async function loadTile(
  t: TileId,
  opts: FetchBuildingsOptions,
  signal: AbortSignal,
): Promise<{ tile: DecodedTile; bytes: number }> {
  if (signal.aborted) throw abortedError();
  const url = buildingTileUrl(t);
  const hit = tileCache.get(url);
  if (hit) {
    tileCache.delete(url);
    tileCache.set(url, hit);
    return { tile: hit.tile, bytes: 0 }; // nothing downloaded
  }
  let entry: { tile: DecodedTile; bytes: number };
  try {
    // The body is read inside the retry loop: a dropped or stalled download is retried like a failed request.
    const res = await fetchBytesWithRetry(url, {
      ...TILE_RETRY,
      ...opts.retry,
      signal,
      fetchImpl: opts.fetchImpl,
    });
    const length = Number(res.headers.get('content-length'));
    const bytes = Number.isFinite(length) && length > 0 ? length : res.bytes.byteLength;
    try {
      entry = { tile: decodeBuildingTile(await maybeGunzip(res.bytes), t), bytes };
    } catch (e) {
      throw new DecodeError(`${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  } catch (e) {
    // Outside the tileset's bounds the server has no tile: no data there, not an error.
    if (!(e instanceof NetError && e.kind === 'http' && e.status === 404)) throw e;
    entry = { tile: emptyTile(t), bytes: 0 };
  }
  tileCache.set(url, entry);
  while (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value as string);
  return entry;
}

function abortedError(): NetError {
  return new NetError('aborted', '', 'The import was aborted.', 0);
}

/** Typed error: aborted (caller's signal), the NetError's kind, 'decode' for unreadable tiles (and other data errors). */
function toSourceError(e: unknown, signal: AbortSignal | undefined): BuildingSourceError {
  if (signal?.aborted) return { kind: 'aborted', message: 'The import was aborted.' };
  if (e instanceof NetError) {
    return { kind: e.kind, message: e.message, ...(e.status !== undefined ? { status: e.status } : {}) };
  }
  return { kind: 'decode', message: e instanceof Error ? e.message : String(e) };
}

/**
 * Building parts within `radius` m of (latitude, longitude) from the swisstopo base vector tiles (z14, 1–4 tiles
 * for 300 m), footprints in ENU metres around that point. Tiles are fetched with retries (truncated exponential
 * backoff + jitter, a time limit per attempt, body included; fetchRetry.ts) and cached in memory. When one tile
 * fails, the other requests are aborted. Never throws: failures return { ok: false, error }; once `signal` is
 * aborted the result is { ok: false, error: { kind: 'aborted' } }, also when every tile came from the cache.
 */
export async function fetchSwisstopoBuildings(
  latitude: number,
  longitude: number,
  radius: number,
  opts: FetchBuildingsOptions = {},
): Promise<BuildingFetchResult> {
  let bytes = 0;
  let tileCount = 0;
  // Aborts the sibling requests when one tile fails; follows the caller's signal.
  const inner = new AbortController();
  const forward = (): void => inner.abort();
  opts.signal?.addEventListener('abort', forward, { once: true });
  try {
    if (opts.signal?.aborted) throw abortedError();
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 85 ||
      !(radius > 0 && radius <= MAX_BUILDING_RADIUS)
    ) {
      return {
        ok: false,
        error: {
          kind: 'invalid-input',
          message: `Invalid position or radius: ${latitude}, ${longitude}, ${radius}`,
        },
        tileCount,
        bytes,
      };
    }
    const ids = tilesForRadius(latitude, longitude, radius);
    tileCount = ids.length;
    const attribution = tilesetAttribution(opts.fetchImpl, opts.signal);
    const decoded: DecodedTile[] = new Array<DecodedTile>(ids.length);
    let next = 0;
    let done = 0;
    let failed = false;
    let firstError: unknown = null;
    const worker = async (): Promise<void> => {
      while (next < ids.length && !failed) {
        const i = next++;
        const r = await loadTile(ids[i], opts, inner.signal).catch((e: unknown) => {
          if (!failed) {
            failed = true; // the other workers start no further tiles …
            firstError = e; // … (reported instead of the aborts it causes) …
            inner.abort(); // … and the running requests stop
          }
          throw e;
        });
        decoded[i] = r.tile;
        bytes += r.bytes;
        done++;
        opts.onProgress?.(done, ids.length, bytes);
      }
    };
    await Promise.all(Array.from({ length: Math.min(TILE_CONCURRENCY, ids.length) }, worker)).catch(
      (e: unknown) => {
        throw failed ? firstError : e;
      },
    );
    const { parts, mergedPieces } = assembleBuildingParts(decoded, latitude, longitude, radius);
    const coverage = coverageFraction(decoded, latitude, longitude, radius);
    const covered = coverage > 0 || parts.length > 0;
    const text = await attribution;
    if (opts.signal?.aborted) throw abortedError();
    return { ok: true, parts, attribution: text, tileCount, bytes, covered, coverage, mergedPieces };
  } catch (e) {
    return { ok: false, error: toSourceError(e, opts.signal), tileCount, bytes };
  } finally {
    opts.signal?.removeEventListener('abort', forward);
  }
}
