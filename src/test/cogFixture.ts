// ─────────────────────────────────────────────
// SYNTHETIC COG / STAC FIXTURES (tests and e2e/surface.spec.ts)
// Builds small Cloud-Optimized GeoTIFFs like the swisstopo elevation files (classic TIFF, float32, LZW,
// predictor 1, tiled, IFD before the data, GDAL_NODATA), STAC item collections and a fetch stand-in that
// answers Range requests with 206. No DOM and no Node APIs: usable by Vitest (node, jsdom) and Playwright.
// ─────────────────────────────────────────────

/**
 * TIFF LZW encoder (MSB-first codes, ClearCode 256 first, EndOfInformation last, "early change" code widths as
 * libtiff writes them): the inverse of model/cog.ts lzwDecode.
 */
export function lzwEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let accBits = 0;
  const write = (code: number, width: number): void => {
    acc = (acc << width) | code;
    accBits += width;
    while (accBits >= 8) {
      out.push((acc >>> (accBits - 8)) & 0xff);
      accBits -= 8;
    }
    acc &= (1 << accBits) - 1;
  };
  // The decoder reads each code with the width the table size needs one entry ahead ("early change").
  const widthFor = (next: number): number => (next < 512 ? 9 : next < 1024 ? 10 : next < 2048 ? 11 : 12);
  const dict = new Map<number, number>();
  let next = 258;
  write(256, 9);
  if (data.length > 0) {
    let w = data[0];
    for (let i = 1; i < data.length; i++) {
      const c = data[i];
      const key = w * 256 + c;
      const code = dict.get(key);
      if (code !== undefined) {
        w = code;
        continue;
      }
      write(w, widthFor(next));
      dict.set(key, next++);
      if (next >= 4094) {
        write(256, widthFor(next));
        dict.clear();
        next = 258;
      }
      w = c;
    }
    write(w, widthFor(next));
    next++; // the entry the decoder adds when it reads that last code
  }
  write(257, widthFor(next));
  if (accBits > 0) out.push((acc << (8 - accBits)) & 0xff);
  return Uint8Array.from(out);
}

export interface CogFixtureOptions {
  width: number;
  height: number;
  /** Internal tile size (square). */
  tileSize: number;
  /** Value of image pixel (col, row). */
  value: (col: number, row: number) => number;
  /** Projected coordinates of the top-left corner and the pixel size. */
  originX: number;
  originY: number;
  res: number;
  /** GDAL_NODATA (default −9999; null = no tag). Padding of edge tiles is filled with it (or 0). */
  noData?: number | null;
  /** 5 = LZW (default), 1 = none. */
  compression?: 1 | 5;
  bigEndian?: boolean;
  /** Bytes of padding before IFD0 (to test headers larger than the first range read). */
  headerPadding?: number;
  /** Write tile byte count 0 (sparse tile) for these tile indices. */
  sparseTiles?: readonly number[];
}

/** A classic tiled float32 GeoTIFF with IFD0 before the tile data (COG layout). */
export function buildCog(o: CogFixtureOptions): Uint8Array {
  const le = !o.bigEndian;
  const noData = o.noData === undefined ? -9999 : o.noData;
  const compression = o.compression ?? 5;
  const ts = o.tileSize;
  const across = Math.ceil(o.width / ts);
  const down = Math.ceil(o.height / ts);
  const tiles: Uint8Array[] = [];
  for (let ty = 0; ty < down; ty++) {
    for (let tx = 0; tx < across; tx++) {
      if (o.sparseTiles?.includes(ty * across + tx)) {
        tiles.push(new Uint8Array(0));
        continue;
      }
      const raw = new Uint8Array(ts * ts * 4);
      const dv = new DataView(raw.buffer);
      for (let y = 0; y < ts; y++) {
        for (let x = 0; x < ts; x++) {
          const col = tx * ts + x;
          const row = ty * ts + y;
          const v = col < o.width && row < o.height ? o.value(col, row) : (noData ?? 0);
          dv.setFloat32(4 * (y * ts + x), v, le);
        }
      }
      tiles.push(compression === 5 ? lzwEncode(raw) : raw);
    }
  }
  const n = tiles.length;
  const noDataText = noData === null ? null : `${noData}\0`;
  interface Entry {
    tag: number;
    type: number;
    count: number;
    /** Inline value(s) or external data written by `write`. */
    size: number;
    write: (dv: DataView, at: number) => void;
  }
  const short = (tag: number, v: number): Entry => ({
    tag,
    type: 3,
    count: 1,
    size: 2,
    write: (dv, at) => dv.setUint16(at, v, le),
  });
  const long = (tag: number, v: number): Entry => ({
    tag,
    type: 4,
    count: 1,
    size: 4,
    write: (dv, at) => dv.setUint32(at, v, le),
  });
  const longs = (tag: number, vs: () => number[]): Entry => ({
    tag,
    type: 4,
    count: n,
    size: 4 * n,
    write: (dv, at) => vs().forEach((v, i) => dv.setUint32(at + 4 * i, v, le)),
  });
  const doubles = (tag: number, vs: number[]): Entry => ({
    tag,
    type: 12,
    count: vs.length,
    size: 8 * vs.length,
    write: (dv, at) => vs.forEach((v, i) => dv.setFloat64(at + 8 * i, v, le)),
  });
  let tileOffsets: number[] = [];
  const entries: Entry[] = [
    long(256, o.width),
    long(257, o.height),
    short(258, 32),
    short(259, compression),
    short(262, 1),
    short(277, 1),
    short(284, 1),
    short(317, 1),
    short(322, ts),
    short(323, ts),
    longs(324, () => tileOffsets),
    longs(325, () => tiles.map((t) => t.length)),
    short(339, 3),
    doubles(33550, [o.res, o.res, 0]),
    doubles(33922, [0, 0, 0, o.originX, o.originY, 0]),
  ];
  if (noDataText !== null) {
    entries.push({
      tag: 42113,
      type: 2,
      count: noDataText.length,
      size: noDataText.length,
      write: (dv, at) => {
        for (let i = 0; i < noDataText.length; i++) dv.setUint8(at + i, noDataText.charCodeAt(i));
      },
    });
  }
  const ifdAt = 8 + (o.headerPadding ?? 0);
  const ifdSize = 2 + 12 * entries.length + 4;
  let extAt = ifdAt + ifdSize;
  const extOffsets = entries.map((e) => {
    if (e.size <= 4) return -1;
    const at = extAt;
    extAt += e.size + (e.size % 2);
    return at;
  });
  const dataAt = extAt;
  tileOffsets = [];
  let p = dataAt;
  for (const t of tiles) {
    tileOffsets.push(t.length > 0 ? p : 0);
    p += t.length;
  }
  const bytes = new Uint8Array(p);
  const dv = new DataView(bytes.buffer);
  bytes[0] = le ? 0x49 : 0x4d;
  bytes[1] = bytes[0];
  dv.setUint16(2, 42, le);
  dv.setUint32(4, ifdAt, le);
  dv.setUint16(ifdAt, entries.length, le);
  entries.forEach((e, k) => {
    const at = ifdAt + 2 + 12 * k;
    dv.setUint16(at, e.tag, le);
    dv.setUint16(at + 2, e.type, le);
    dv.setUint32(at + 4, e.count, le);
    if (e.size <= 4) e.write(dv, at + 8);
    else {
      dv.setUint32(at + 8, extOffsets[k], le);
      e.write(dv, extOffsets[k]);
    }
  });
  dv.setUint32(ifdAt + 2 + 12 * entries.length, 0, le);
  tiles.forEach((t, i) => {
    if (t.length > 0) bytes.set(t, tileOffsets[i]);
  });
  return bytes;
}

// ── swisstopo-like tiles, STAC and the height service ──

/** Grid of the synthetic km tiles: 1 km × 1 km, `res` m per pixel. */
export interface KmTileSpec {
  /** LV95 km of the south-west corner, e.g. 2601 / 1200. */
  eastKm: number;
  northKm: number;
  year: number;
}

/** Height (m) at LV95 (east, north), the synthetic surface. */
export type SurfaceFn = (east: number, north: number) => number;

/** COG of one 1 km tile sampling `surface` at the pixel centres (NaN → nodata). */
export function buildKmTileCog(t: KmTileSpec, surface: SurfaceFn, res: number, tileSize: number): Uint8Array {
  const size = Math.round(1000 / res);
  const originX = t.eastKm * 1000;
  const originY = (t.northKm + 1) * 1000;
  return buildCog({
    width: size,
    height: size,
    tileSize,
    originX,
    originY,
    res,
    value: (col, row) => {
      const v = surface(originX + (col + 0.5) * res, originY - (row + 0.5) * res);
      return Number.isFinite(v) ? v : -9999;
    },
  });
}

export const FIXTURE_DSM_COLLECTION = 'ch.swisstopo.swisssurface3d-raster';
export const FIXTURE_DTM_COLLECTION = 'ch.swisstopo.swissalti3d';

/** Asset href of a synthetic tile, shaped like the real ones. */
export function fixtureAssetHref(collection: string, t: KmTileSpec): string {
  const kind = collection === FIXTURE_DTM_COLLECTION ? 'swissalti3d' : 'swisssurface3d-raster';
  const res = collection === FIXTURE_DTM_COLLECTION ? '2' : '0.5';
  const id = `${kind}_${t.year}_${t.eastKm}-${t.northKm}`;
  return `https://data.geo.admin.ch/${collection}/${id}/${id}_${res}_2056_5728.tif`;
}

/** STAC v1 item of a synthetic tile (geometry omitted: the reader works with the LV95 key of the id). */
export function fixtureStacItem(collection: string, t: KmTileSpec): object {
  const kind = collection === FIXTURE_DTM_COLLECTION ? 'swissalti3d' : 'swisssurface3d-raster';
  const id = `${kind}_${t.year}_${t.eastKm}-${t.northKm}`;
  const href = fixtureAssetHref(collection, t);
  const name = href.slice(href.lastIndexOf('/') + 1);
  return {
    id,
    collection,
    type: 'Feature',
    stac_version: '1.0.0',
    properties: { datetime: `${t.year}-01-01T00:00:00Z` },
    assets: {
      [name]: { type: 'image/tiff; application=geotiff; profile=cloud-optimized', href },
      [`${name}.xyz.zip`]: { type: 'application/x.ascii-xyz+zip', href: `${href}.xyz.zip` },
    },
  };
}

/** A STAC FeatureCollection page with an optional `next` link. */
export function fixtureStacPage(features: object[], next?: string): object {
  const links: object[] = [{ rel: 'self', href: 'https://data.geo.admin.ch/api/stac/v1/' }];
  if (next) links.push({ rel: 'next', href: next });
  return { type: 'FeatureCollection', features, links };
}

/** Parses "bytes=a-b" (single range), null when absent or malformed. */
export function parseRangeHeader(header: string | null | undefined): { start: number; end: number } | null {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header?.trim() ?? '');
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] === '' ? Infinity : Number(m[2]);
  return end >= start ? { start, end } : null;
}

/** Body and status of a (possibly ranged) request for `file`. */
export function rangeSlice(
  file: Uint8Array,
  rangeHeader: string | null | undefined,
): { status: number; body: Uint8Array; contentRange?: string } {
  const r = parseRangeHeader(rangeHeader);
  if (!r) return { status: 200, body: file };
  if (r.start >= file.length) return { status: 416, body: new Uint8Array(0) };
  const end = Math.min(r.end, file.length - 1);
  return {
    status: 206,
    body: file.subarray(r.start, end + 1),
    contentRange: `bytes ${r.start}-${end}/${file.length}`,
  };
}

// ── Building vector tiles (MVT) ──────────────

/** A polygon for a vector tile: rings of [longitude, latitude] (outer first, holes opposite), properties. */
export interface MvtPolygon {
  rings: [number, number][][];
  props: Record<string, number | string>;
}

const zigzag = (n: number): number => (n << 1) ^ (n >> 31);
const command = (id: number, count: number): number => (id & 7) | (count << 3);

/** Fractional Web Mercator tile coordinates (same formula as model/buildingSources.ts lonLatToTile). */
function tileXY(longitude: number, latitude: number, z: number): [number, number] {
  const n = 2 ** z;
  const lat = (Math.max(-85.0511, Math.min(85.0511, latitude)) * Math.PI) / 180;
  return [
    ((longitude + 180) / 360) * n,
    ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
  ];
}

/** An MVT tile (extent 4096) with the given polygon layers; coordinates relative to the tile, unclipped. */
export function buildVectorTile(
  tile: { z: number; x: number; y: number },
  layers: { name: string; polygons: MvtPolygon[] }[],
): Uint8Array {
  const out: number[] = [];
  const varint = (v: number): void => {
    let x = v >>> 0;
    while (x >= 0x80) {
      out.push((x & 0x7f) | 0x80);
      x >>>= 7;
    }
    out.push(x);
  };
  const bytesField = (field: number, bytes: number[]): void => {
    varint((field << 3) | 2);
    varint(bytes.length);
    for (const b of bytes) out.push(b);
  };
  /** Bytes written by `fill` (taken out of `out`). */
  const sub = (fill: () => void): number[] => {
    const start = out.length;
    fill();
    return out.splice(start, out.length - start);
  };
  const utf8 = (s: string): number[] => Array.from(new TextEncoder().encode(s));
  for (const layer of layers) {
    const keys: string[] = [];
    const values: (number | string)[] = [];
    const index = <T>(list: T[], v: T): number => {
      const i = list.indexOf(v);
      if (i >= 0) return i;
      list.push(v);
      return list.length - 1;
    };
    const body = sub(() => {
      varint(15 << 3);
      varint(2);
      bytesField(1, utf8(layer.name));
      for (const poly of layer.polygons) {
        const tags: number[] = [];
        for (const [k, v] of Object.entries(poly.props)) tags.push(index(keys, k), index(values, v));
        const geom: number[] = [];
        let cx = 0;
        let cy = 0;
        for (const ring of poly.rings) {
          ring.forEach(([lon, lat], i) => {
            const [tx, ty] = tileXY(lon, lat, tile.z);
            const px = Math.round((tx - tile.x) * 4096);
            const py = Math.round((ty - tile.y) * 4096);
            if (i === 0) geom.push(command(1, 1));
            if (i === 1) geom.push(command(2, ring.length - 1));
            geom.push(zigzag(px - cx), zigzag(py - cy));
            cx = px;
            cy = py;
          });
          geom.push(command(7, 1));
        }
        const feature = sub(() => {
          bytesField(
            2,
            sub(() => tags.forEach(varint)),
          );
          varint(3 << 3);
          varint(3);
          bytesField(
            4,
            sub(() => geom.forEach(varint)),
          );
        });
        bytesField(2, feature);
      }
      for (const k of keys) bytesField(3, utf8(k));
      for (const v of values) {
        bytesField(
          4,
          sub(() => {
            if (typeof v === 'string') bytesField(1, utf8(v));
            else {
              varint(6 << 3);
              varint(zigzag(Math.round(v)));
            }
          }),
        );
      }
      varint(5 << 3);
      varint(4096);
    });
    bytesField(3, body);
  }
  return Uint8Array.from(out);
}

// ── A synthetic swisstopo (STAC, COGs, height service, vector tiles) ──

/** Heights of the synthetic world, m (LHN95-like); NaN = no data. */
export interface SyntheticWorld {
  /** Surface model per acquisition year. */
  dsm: Record<number, SurfaceFn>;
  /** Terrain model (2 m). */
  dtm: SurfaceFn;
  /** Answer of the height service (null: HTTP 500). */
  ground: number | null;
  /** km tiles that exist ('EEEE-NNNN' → years); default: every tile, every dsm year. */
  tiles?: (key: string) => number[];
  /** Building footprints and the areas outside CH/FL (vector tiles), lon/lat; no buildings → HTTP 404. */
  buildings?: MvtPolygon[];
  outside?: MvtPolygon[];
  /** LV95 window outside of which DSM COG tiles are left empty (sparse: keeps fixtures small and fast). */
  window?: { x0: number; y0: number; x1: number; y1: number };
  /** STAC items per page (default: all on one page). */
  pageSize?: number;
}

/** LV95 (swisstopo approximate formula, as model/lv95.ts wgs84ToLv95). */
function toLv95(latitude: number, longitude: number): { east: number; north: number } {
  const p = (latitude * 3600 - 169028.66) / 10000;
  const l = (longitude * 3600 - 26782.5) / 10000;
  return {
    east: 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l * l * l,
    north:
      1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p * p * p,
  };
}

/** A response for a route: status, body, headers. */
export interface FakeResponse {
  status: number;
  body: Uint8Array | string;
  headers?: Record<string, string>;
}

/**
 * Answers the requests of the laser-scan loader for `world` (URL + Range header), or null for other URLs:
 * STAC items (bbox → the km tiles it touches, every year of the world), the COG assets (206 for ranges), the
 * height service and the building vector tiles.
 */
export function syntheticSwisstopo(
  world: SyntheticWorld,
): (url: string, range: string | null) => FakeResponse | null {
  const cogs = new Map<string, Uint8Array>();
  const json = (v: unknown): FakeResponse => ({
    status: 200,
    body: JSON.stringify(v),
    headers: { 'content-type': 'application/json' },
  });
  return (url, range) => {
    const u = new URL(url);
    if (u.hostname === 'data.geo.admin.ch' && u.pathname.includes('/api/stac/v1/collections/')) {
      const collection = u.pathname.split('/')[5];
      const [w, s, e, n] = (u.searchParams.get('bbox') ?? '').split(',').map(Number);
      const corners = [toLv95(s, w), toLv95(s, e), toLv95(n, w), toLv95(n, e)];
      const ke0 = Math.floor(Math.min(...corners.map((c) => c.east)) / 1000);
      const ke1 = Math.floor(Math.max(...corners.map((c) => c.east)) / 1000);
      const kn0 = Math.floor(Math.min(...corners.map((c) => c.north)) / 1000);
      const kn1 = Math.floor(Math.max(...corners.map((c) => c.north)) / 1000);
      const items: object[] = [];
      const years = Object.keys(world.dsm).map(Number);
      for (let ke = ke0; ke <= ke1; ke++) {
        for (let kn = kn0; kn <= kn1; kn++) {
          const has = world.tiles ? world.tiles(`${ke}-${kn}`) : years;
          const list = collection === FIXTURE_DTM_COLLECTION ? has.slice(-1) : has;
          for (const year of list) items.push(fixtureStacItem(collection, { eastKm: ke, northKm: kn, year }));
        }
      }
      const size = world.pageSize ?? Infinity;
      const start = Number(u.searchParams.get('cursor') ?? 0);
      let next: string | undefined;
      if (start + size < items.length) {
        const nu = new URL(url);
        nu.searchParams.set('cursor', String(start + size));
        next = nu.toString();
      }
      return json(fixtureStacPage(items.slice(start, start + size), next));
    }
    if (u.hostname === 'data.geo.admin.ch' && u.pathname.endsWith('.tif')) {
      const m = /(swisssurface3d-raster|swissalti3d)_(\d{4})_(\d{4})-(\d{4})_/.exec(u.pathname);
      if (!m) return { status: 404, body: '' };
      let file = cogs.get(url);
      if (!file) {
        const t = { eastKm: Number(m[3]), northKm: Number(m[4]), year: Number(m[2]) };
        if (m[1] === 'swissalti3d') {
          file = buildKmTileCog(t, world.dtm, 2, 128);
        } else {
          const surface = world.dsm[t.year];
          if (!surface) return { status: 404, body: '' };
          const win = world.window;
          const originX = t.eastKm * 1000;
          const originY = (t.northKm + 1) * 1000;
          const sparse: number[] = [];
          for (let ty = 0; ty < 4 && win; ty++) {
            for (let tx = 0; tx < 4; tx++) {
              const x0 = originX + tx * 256;
              const y1 = originY - ty * 256;
              if (x0 >= win.x1 || x0 + 256 <= win.x0 || y1 <= win.y0 || y1 - 256 >= win.y1)
                sparse.push(ty * 4 + tx);
            }
          }
          file = buildCog({
            width: 2000,
            height: 2000,
            tileSize: 512,
            originX,
            originY,
            res: 0.5,
            sparseTiles: sparse,
            value: (col, row) => {
              const v = surface(originX + (col + 0.5) * 0.5, originY - (row + 0.5) * 0.5);
              return Number.isFinite(v) ? v : -9999;
            },
          });
        }
        cogs.set(url, file);
      }
      const r = rangeSlice(file, range);
      return {
        status: r.status,
        body: r.body,
        headers: { 'content-type': 'image/tiff; application=geotiff; profile=cloud-optimized' },
      };
    }
    if (u.hostname === 'api3.geo.admin.ch' && u.pathname === '/rest/services/height') {
      return world.ground === null
        ? { status: 500, body: 'error' }
        : json({ height: world.ground.toFixed(1) });
    }
    if (u.hostname === 'vectortiles.geo.admin.ch' && u.pathname.endsWith('.pbf')) {
      if (!world.buildings) return { status: 404, body: '' };
      const [z, x, y] = u.pathname
        .replace(/\.pbf$/, '')
        .split('/')
        .slice(-3)
        .map(Number);
      const layers = [{ name: 'building', polygons: world.buildings }];
      if (world.outside) {
        layers.push({
          name: 'administrative_unit',
          polygons: world.outside.map((p) => ({
            ...p,
            props: { ...p.props, iso_a2: 'not_CH_LI', admin_level: 2 },
          })),
        });
      }
      return { status: 200, body: buildVectorTile({ z, x, y }, layers) };
    }
    return null;
  };
}

/** A fetch stand-in for `route` (unknown URLs: 404); records every requested URL with its Range header. */
export function fakeFetch(route: (url: string, range: string | null) => FakeResponse | null): {
  fetchImpl: typeof fetch;
  requests: { url: string; range: string | null }[];
} {
  const requests: { url: string; range: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const range = new Headers(init?.headers).get('range');
    requests.push({ url, range });
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const r = route(url, range) ?? { status: 404, body: '' };
    const body = typeof r.body === 'string' ? r.body : r.body.slice();
    return new Response(body, { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return { fetchImpl, requests };
}
