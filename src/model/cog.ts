import { fetchReadWithRetry, type RetryOptions } from './fetchRetry';

// ─────────────────────────────────────────────
// MINIMAL CLOUD-OPTIMIZED GEOTIFF READER
// For the swisstopo elevation COGs (swissSURFACE3D Raster, swissALTI3D; docs/ARCHITECTURE.md, "Umgebung"):
// classic TIFF, one band float32, LZW (compression 5) or uncompressed, predictor 1, tiled, all IFDs before the
// image data (GDAL "LAYOUT=IFDS_BEFORE_DATA": the first DSM data byte is at 1,152, 1,568 for the 2 m DTM).
// One header range read (COG_HEADER_BYTES, grown when IFD0 does not fit), then only the internal tiles that
// intersect a window, fetched with HTTP Range requests (206) via fetchReadWithRetry. Content-Range is not
// exposed through CORS by data.geo.admin.ch, so nothing here reads it: sizes come from the tile byte counts.
// Only IFD0 (full resolution) is read: the overviews average away building edges (RMS 1.3–3.8° of horizon).
// A hand-written reader instead of geotiff.js: the research prototype (same LZW decoder) decoded the same
// window in 216 ms against 1.4–2.0 s, with 0 differing values.
// ─────────────────────────────────────────────

/** Bytes of the first header read (IFD0 of the swisstopo files ends at byte 1,148 / 1,564). */
export const COG_HEADER_BYTES = 16384;
/** Largest header read accepted when IFD0 does not fit into COG_HEADER_BYTES. */
export const COG_MAX_HEADER_BYTES = 1 << 20;

/** Unsupported or corrupt file (not retried). */
export class CogFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CogFormatError';
  }
}

/** Full-resolution image (IFD0) of a COG with its georeferencing. */
export interface CogImage {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  /** Tiles per row and per column. */
  tilesAcross: number;
  tilesDown: number;
  /** Byte offset and size of every tile, row-major. */
  tileOffsets: number[];
  tileByteCounts: number[];
  /** 1 = none, 5 = LZW. */
  compression: number;
  predictor: number;
  bitsPerSample: number;
  /** 3 = IEEE float. */
  sampleFormat: number;
  littleEndian: boolean;
  /** GDAL_NODATA value, null when absent. */
  noData: number | null;
  /** Projected x of the left edge of column 0 and y of the top edge of row 0 (pixel-is-area). */
  originX: number;
  originY: number;
  /** Pixel size in x and y (both positive; rows go south). */
  resX: number;
  resY: number;
}

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  samplesPerPixel: 277,
  planarConfig: 284,
  predictor: 317,
  tileWidth: 322,
  tileHeight: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  sampleFormat: 339,
  pixelScale: 33550,
  tiepoint: 33922,
  geoKeys: 34735,
  noData: 42113,
} as const;

/** Byte size per value of the TIFF field types used here. */
const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  11: 4,
  12: 8,
  16: 8,
};

type Field = number[] | string;

/**
 * Parses IFD0 of a classic TIFF from its first bytes. Returns { needBytes } when IFD0 or one of its values lies
 * beyond `bytes` (read more and parse again). Throws CogFormatError for other formats (BigTIFF, not tiled,
 * several bands, integer samples, predictor ≠ 1, compression other than none or LZW, no georeferencing).
 */
export function parseCogHeader(bytes: Uint8Array): { image: CogImage } | { needBytes: number } {
  if (bytes.length < 8) return { needBytes: 8 };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[0], bytes[1]);
  if (order !== 'II' && order !== 'MM') throw new CogFormatError('Not a TIFF file');
  const le = order === 'II';
  const magic = dv.getUint16(2, le);
  if (magic === 43) throw new CogFormatError('BigTIFF is not supported');
  if (magic !== 42) throw new CogFormatError(`Not a TIFF file (magic ${magic})`);
  const ifd = dv.getUint32(4, le);
  if (ifd + 2 > bytes.length) return { needBytes: ifd + 2 };
  const n = dv.getUint16(ifd, le);
  const end = ifd + 2 + 12 * n + 4;
  if (end > bytes.length) return { needBytes: end };
  const fields = new Map<number, Field>();
  let need = 0;
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + 12 * k;
    const tag = dv.getUint16(e, le);
    const type = dv.getUint16(e + 2, le);
    const count = dv.getUint32(e + 4, le);
    const size = TYPE_SIZE[type];
    if (size === undefined || !Object.values(TAG).includes(tag as never)) continue;
    const total = size * count;
    const at = total <= 4 ? e + 8 : dv.getUint32(e + 8, le);
    if (at + total > bytes.length) {
      need = Math.max(need, at + total);
      continue;
    }
    fields.set(tag, readValues(dv, bytes, type, count, at, le));
  }
  if (need > 0) return { needBytes: need };
  return { image: toImage(fields, le) };
}

function readValues(
  dv: DataView,
  bytes: Uint8Array,
  type: number,
  count: number,
  at: number,
  le: boolean,
): Field {
  if (type === 2) {
    let s = '';
    for (let i = 0; i < count; i++) s += String.fromCharCode(bytes[at + i]);
    return s.replace(/\0+$/, '');
  }
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    switch (type) {
      case 1:
      case 7:
        out[i] = bytes[at + i];
        break;
      case 6:
        out[i] = dv.getInt8(at + i);
        break;
      case 3:
        out[i] = dv.getUint16(at + 2 * i, le);
        break;
      case 8:
        out[i] = dv.getInt16(at + 2 * i, le);
        break;
      case 4:
        out[i] = dv.getUint32(at + 4 * i, le);
        break;
      case 9:
        out[i] = dv.getInt32(at + 4 * i, le);
        break;
      case 11:
        out[i] = dv.getFloat32(at + 4 * i, le);
        break;
      case 12:
        out[i] = dv.getFloat64(at + 8 * i, le);
        break;
      default: // 16 (LONG8) only occurs in BigTIFF
        out[i] = Number(dv.getBigUint64(at + 8 * i, le));
    }
  }
  return out;
}

function toImage(fields: Map<number, Field>, le: boolean): CogImage {
  const num = (tag: number, fallback?: number): number => {
    const v = fields.get(tag);
    if (Array.isArray(v) && v.length > 0) return v[0];
    if (fallback !== undefined) return fallback;
    throw new CogFormatError(`TIFF tag ${tag} missing`);
  };
  const arr = (tag: number): number[] => {
    const v = fields.get(tag);
    if (!Array.isArray(v)) throw new CogFormatError(`TIFF tag ${tag} missing`);
    return v;
  };
  const width = num(TAG.width);
  const height = num(TAG.height);
  if (!fields.has(TAG.tileWidth)) throw new CogFormatError('Not a tiled TIFF');
  const tileWidth = num(TAG.tileWidth);
  const tileHeight = num(TAG.tileHeight);
  const bitsPerSample = num(TAG.bitsPerSample, 1);
  const sampleFormat = num(TAG.sampleFormat, 1);
  const compression = num(TAG.compression, 1);
  const predictor = num(TAG.predictor, 1);
  if (num(TAG.samplesPerPixel, 1) !== 1) throw new CogFormatError('Only single-band images are supported');
  if (sampleFormat !== 3 || bitsPerSample !== 32) {
    throw new CogFormatError(
      `Only float32 samples are supported (format ${sampleFormat}, ${bitsPerSample} bit)`,
    );
  }
  if (compression !== 1 && compression !== 5) {
    throw new CogFormatError(`Compression ${compression} is not supported`);
  }
  if (predictor !== 1) throw new CogFormatError(`Predictor ${predictor} is not supported`);
  if (!(width > 0 && height > 0 && tileWidth > 0 && tileHeight > 0)) {
    throw new CogFormatError('Invalid image size');
  }
  const tilesAcross = Math.ceil(width / tileWidth);
  const tilesDown = Math.ceil(height / tileHeight);
  const tileOffsets = arr(TAG.tileOffsets);
  const tileByteCounts = arr(TAG.tileByteCounts);
  if (tileOffsets.length !== tilesAcross * tilesDown || tileByteCounts.length !== tileOffsets.length) {
    throw new CogFormatError('Tile table does not match the image size');
  }
  const scale = arr(TAG.pixelScale);
  const tie = arr(TAG.tiepoint);
  if (scale.length < 2 || tie.length < 6 || !(scale[0] > 0 && scale[1] > 0)) {
    throw new CogFormatError('No georeferencing (ModelPixelScale / ModelTiepoint)');
  }
  const [resX, resY] = scale;
  // Tiepoint (i, j, k) ↔ (x, y, z). Pixel-is-point (GTRasterTypeGeoKey 1025 = 2) refers to the pixel centre.
  const point = rasterTypeIsPoint(fields.get(TAG.geoKeys));
  const shift = point ? 0.5 : 0;
  const originX = tie[3] - (tie[0] + shift) * resX;
  const originY = tie[4] + (tie[1] + shift) * resY;
  const nd = fields.get(TAG.noData);
  const noDataValue = typeof nd === 'string' && nd.trim() !== '' ? Number(nd.trim()) : NaN;
  return {
    width,
    height,
    tileWidth,
    tileHeight,
    tilesAcross,
    tilesDown,
    tileOffsets,
    tileByteCounts,
    compression,
    predictor,
    bitsPerSample,
    sampleFormat,
    littleEndian: le,
    noData: Number.isFinite(noDataValue) ? noDataValue : null,
    originX,
    originY,
    resX,
    resY,
  };
}

/** True when the GeoKeyDirectory says GTRasterTypeGeoKey (1025) = RasterPixelIsPoint (2). */
function rasterTypeIsPoint(keys: Field | undefined): boolean {
  if (!Array.isArray(keys) || keys.length < 4) return false;
  const count = keys[3];
  for (let k = 0; k < count; k++) {
    const i = 4 + 4 * k;
    if (keys[i] === 1025 && keys[i + 1] === 0) return keys[i + 3] === 2;
  }
  return false;
}

// ── LZW ──────────────────────────────────────

/**
 * TIFF LZW decoder (MSB-first codes of 9–12 bits, ClearCode 256, EndOfInformation 257, "early change": the
 * code width grows one code before the table would need it, as libtiff writes it). Fills exactly
 * `expected` bytes (a shorter stream leaves zeros). Throws CogFormatError on an invalid code.
 */
export function lzwDecode(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const len = new Int32Array(4096);
  const first = new Uint8Array(4096);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    len[i] = 1;
    first[i] = i;
  }
  let op = 0;
  let next = 258;
  let width = 9;
  let bitPos = 0;
  let old = -1;
  const totalBits = src.length * 8;
  const emit = (code: number): void => {
    const l = len[code];
    // Strings running past the end are cut (the tile's last string may exceed a short `expected`).
    let p = op + l - 1;
    let c = code;
    while (c >= 0) {
      if (p < expected) out[p] = suffix[c];
      p--;
      c = prefix[c];
    }
    op += l;
  };
  while (bitPos + width <= totalBits && op < expected) {
    const byte = bitPos >>> 3;
    const v =
      ((src[byte] << 16) |
        ((byte + 1 < src.length ? src[byte + 1] : 0) << 8) |
        (byte + 2 < src.length ? src[byte + 2] : 0)) >>>
      (24 - (bitPos & 7) - width);
    const code = v & ((1 << width) - 1);
    bitPos += width;
    if (code === 257) break;
    if (code === 256) {
      next = 258;
      width = 9;
      old = -1;
      continue;
    }
    if (old === -1) {
      if (code > 255) throw new CogFormatError(`LZW: invalid first code ${code}`);
      emit(code);
      old = code;
      continue;
    }
    if (code < next) {
      emit(code);
      if (next < 4096) {
        prefix[next] = old;
        suffix[next] = first[code];
        len[next] = len[old] + 1;
        first[next] = first[old];
        next++;
      }
    } else if (code === next && next < 4096) {
      prefix[next] = old;
      suffix[next] = first[old];
      len[next] = len[old] + 1;
      first[next] = first[old];
      next++;
      emit(code);
    } else {
      throw new CogFormatError(`LZW: invalid code ${code} (table size ${next})`);
    }
    old = code;
    if (next + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}

/** Decoded tile as float32 values (tileWidth × tileHeight, row-major; edge tiles include their padding). */
export function decodeCogTile(image: CogImage, bytes: Uint8Array): Float32Array {
  const n = image.tileWidth * image.tileHeight;
  const raw = image.compression === 5 ? lzwDecode(bytes, n * 4) : bytes;
  if (raw.length < n * 4) throw new CogFormatError('Tile shorter than its size');
  const sameOrder = image.littleEndian === littleEndianPlatform();
  if (sameOrder) {
    // Copy into an aligned buffer (the raw bytes may start at any offset).
    const copy = new Uint8Array(n * 4);
    copy.set(raw.subarray(0, n * 4));
    return new Float32Array(copy.buffer);
  }
  const out = new Float32Array(n);
  const dv = new DataView(raw.buffer, raw.byteOffset, n * 4);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(4 * i, image.littleEndian);
  return out;
}

let platformLe: boolean | null = null;
function littleEndianPlatform(): boolean {
  platformLe ??= new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  return platformLe;
}

// ── Windows and ranges ───────────────────────

/** A tile of IFD0 with its position in the image. */
export interface CogTileRef {
  index: number;
  col: number;
  row: number;
  offset: number;
  byteCount: number;
}

/**
 * Tiles intersecting the pixel window [x0, x1) × [y0, y1) (clipped to the image), row-major. Tiles with a
 * byte count of 0 (sparse, all nodata) are skipped.
 */
export function cogTilesForWindow(
  image: CogImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): CogTileRef[] {
  const cx0 = Math.max(0, Math.floor(x0 / image.tileWidth));
  const cy0 = Math.max(0, Math.floor(y0 / image.tileHeight));
  const cx1 = Math.min(image.tilesAcross - 1, Math.floor((Math.min(x1, image.width) - 1) / image.tileWidth));
  const cy1 = Math.min(image.tilesDown - 1, Math.floor((Math.min(y1, image.height) - 1) / image.tileHeight));
  const out: CogTileRef[] = [];
  for (let row = cy0; row <= cy1; row++) {
    for (let col = cx0; col <= cx1; col++) {
      const index = row * image.tilesAcross + col;
      const byteCount = image.tileByteCounts[index];
      if (byteCount > 0) out.push({ index, col, row, offset: image.tileOffsets[index], byteCount });
    }
  }
  return out;
}

/** One HTTP range covering one or more tiles stored next to each other. */
export interface CogRange {
  start: number;
  /** Exclusive. */
  end: number;
  tiles: CogTileRef[];
}

/**
 * Groups tiles into ranges: tiles whose data follow each other with at most `maxGap` bytes in between (GDAL
 * writes 4-byte leaders and trailers around each tile) are fetched together while the range stays within
 * `maxBytes` (a single larger tile gets a range of its own).
 */
export function mergeCogRanges(tiles: readonly CogTileRef[], maxGap: number, maxBytes: number): CogRange[] {
  const sorted = [...tiles].sort((a, b) => a.offset - b.offset);
  const out: CogRange[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    const end = t.offset + t.byteCount;
    if (last && t.offset >= last.end && t.offset - last.end <= maxGap && end - last.start <= maxBytes) {
      last.end = end;
      last.tiles.push(t);
    } else {
      out.push({ start: t.offset, end, tiles: [t] });
    }
  }
  return out;
}

/** The server ignored the Range header and would send a whole large file. */
export class RangeNotSupportedError extends Error {
  constructor(url: string) {
    super(`${url}: the server does not support range requests`);
    this.name = 'RangeNotSupportedError';
  }
}

/**
 * Bytes [start, end) of `url` with an HTTP Range request, read inside the retry loop (fetchReadWithRetry).
 * 206 is expected; a 200 with the whole body is accepted (sliced) unless the body is much larger than the
 * range, then RangeNotSupportedError (without reading it). With `allowShort` a shorter answer is fine (a header
 * read of a file smaller than the range); otherwise a short body is an error.
 */
export function fetchByteRange(
  url: string,
  start: number,
  end: number,
  opts: RetryOptions & { allowShort?: boolean } = {},
): Promise<Uint8Array> {
  const { allowShort, ...retry } = opts;
  const want = end - start;
  return fetchReadWithRetry(
    url,
    async (res) => {
      if (res.status !== 206) {
        const length = Number(res.headers.get('content-length'));
        if (Number.isFinite(length) && length > 4 * want + 65536) {
          await res.body?.cancel().catch(() => undefined);
          throw new RangeNotSupportedError(url);
        }
      }
      let bytes = new Uint8Array(await res.arrayBuffer());
      if (res.status !== 206) bytes = bytes.subarray(start, end);
      if (bytes.length > want) bytes = bytes.subarray(0, want);
      if (bytes.length < want && !allowShort) {
        throw new CogFormatError(`${url}: expected ${want} bytes at ${start}, got ${bytes.length}`);
      }
      return bytes;
    },
    { ...retry, init: { ...retry.init, headers: { Range: `bytes=${start}-${end - 1}` } } },
  );
}

/** A parsed COG header and the bytes it took to read it. */
export interface CogHeader {
  image: CogImage;
  bytes: number;
  requests: number;
}

/**
 * Reads and parses the header (IFD0) of a COG: one range of COG_HEADER_BYTES, grown once or more while IFD0
 * does not fit (up to COG_MAX_HEADER_BYTES). Throws NetError / CogFormatError.
 */
export async function fetchCogHeader(url: string, opts: RetryOptions = {}): Promise<CogHeader> {
  let size = COG_HEADER_BYTES;
  let bytes = 0;
  let requests = 0;
  for (;;) {
    const head = await fetchByteRange(url, 0, size, { ...opts, allowShort: true });
    bytes += head.length;
    requests++;
    const parsed = parseCogHeader(head);
    if ('image' in parsed) return { image: parsed.image, bytes, requests };
    if (head.length < size || parsed.needBytes > COG_MAX_HEADER_BYTES) {
      throw new CogFormatError(`${url}: header incomplete (needs ${parsed.needBytes} bytes)`);
    }
    size = Math.min(COG_MAX_HEADER_BYTES, Math.max(parsed.needBytes, 2 * size));
  }
}

/**
 * Copies a decoded tile into a raster: target cell (i, j) is image pixel (col0 + i, row0 + j). Values equal
 * to the nodata value (and non-finite ones) become NaN. Returns the number of cells written.
 */
export function copyTileInto(
  image: CogImage,
  tile: CogTileRef,
  values: Float32Array,
  target: Float32Array,
  targetWidth: number,
  targetHeight: number,
  col0: number,
  row0: number,
): number {
  const px0 = tile.col * image.tileWidth;
  const py0 = tile.row * image.tileHeight;
  // Intersection of the tile's valid pixels with the target window, in image pixels.
  const ix0 = Math.max(px0, col0);
  const iy0 = Math.max(py0, row0);
  const ix1 = Math.min(px0 + image.tileWidth, image.width, col0 + targetWidth);
  const iy1 = Math.min(py0 + image.tileHeight, image.height, row0 + targetHeight);
  if (ix1 <= ix0 || iy1 <= iy0) return 0;
  const nd = image.noData;
  let written = 0;
  for (let y = iy0; y < iy1; y++) {
    const src = (y - py0) * image.tileWidth - px0;
    const dst = (y - row0) * targetWidth - col0;
    for (let x = ix0; x < ix1; x++) {
      const v = values[src + x];
      target[dst + x] = v === nd || !Number.isFinite(v) ? NaN : v;
      written++;
    }
  }
  return written;
}
