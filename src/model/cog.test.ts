import { describe, expect, it } from 'vitest';
import { buildCog, lzwEncode, rangeSlice } from '../test/cogFixture';
import {
  COG_HEADER_BYTES,
  CogFormatError,
  RangeNotSupportedError,
  cogTilesForWindow,
  copyTileInto,
  decodeCogTile,
  fetchByteRange,
  fetchCogHeader,
  lzwDecode,
  mergeCogRanges,
  parseCogHeader,
  type CogImage,
} from './cog';

/**
 * First 1,152 bytes of swisssurface3d-raster_2023_2596-1198_0.5_2056_5728.tif (data.geo.admin.ch, read with
 * Range 0-65535 on 2026-09-25): GDAL ghost area, IFD0 at byte 192, the two overview IFDs and their tile tables.
 */
const REAL_HEADER_BASE64 = [
  'SUkqAMAAAABHREFMX1NUUlVDVFVSQUxfTUVUQURBVEFfU0laRT0wMDAxNDAgYnl0ZXMKTEFZT1VUPUlGRFNfQkVGT1JFX0RBVEEK',
  'QkxPQ0tfT1JERVI9Uk9XX01BSk9SCkJMT0NLX0xFQURFUj1TSVpFX0FTX1VJTlQ0CkJMT0NLX1RSQUlMRVI9TEFTVF80X0JZVEVT',
  'X1JFUEVBVEVECktOT1dOX0lOQ09NUEFUSUJMRV9FRElUSU9OPU5PCiAAFAAAAQMAAQAAANAHAAABAQMAAQAAANAHAAACAQMAAQAA',
  'ACAAAAADAQMAAQAAAAUAAAAGAQMAAQAAAAEAAAAVAQMAAQAAAAEAAAAcAQMAAQAAAAEAAAAxAQIAAwAAACcnAAA7AQIAAwAAACcn',
  'AAA9AQMAAQAAAAEAAABCAQMAAQAAAAACAABDAQMAAQAAAAACAABEAQQAEAAAANwDAABFAQQAEAAAABwEAABTAQMAAQAAAAMAAAAO',
  'gwwAAwAAALwBAACChAwABgAAANQBAACvhwMAIAAAAAQCAACxhwIAGAAAAEQCAACBpAIABgAAALYBAABcAgAALTk5OTkAAAAAAAAA',
  '4D8AAAAAAADgPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFDOQ0EAAAAAmEsyQQAAAAAAAAAAAQABAAAABwAA',
  'BAAAAQABAAEEAAABAAEAAgSxhw8AAAABCLGHCAAPAAYIAAABAI4jAAwAAAEACAgEDAAAAQApI0NIMTkwMysgLyBMVjk1fENIMTkw',
  'Myt8AA8A/gAEAAEAAAABAAAAAAEDAAEAAADoAwAAAQEDAAEAAADoAwAAAgEDAAEAAAAgAAAAAwEDAAEAAAAFAAAABgEDAAEAAAAB',
  'AAAAFQEDAAEAAAABAAAAHAEDAAEAAAABAAAAPQEDAAEAAAABAAAAQgEDAAEAAAAAAgAAQwEDAAEAAAAAAgAARAEEAAQAAABcBAAA',
  'RQEEAAQAAABsBAAAUwEDAAEAAAADAAAAgaQCAAYAAAAWAwAAHAMAAC05OTk5AA8A/gAEAAEAAAABAAAAAAEDAAEAAAD0AQAAAQED',
  'AAEAAAD0AQAAAgEDAAEAAAAgAAAAAwEDAAEAAAAFAAAABgEDAAEAAAABAAAAFQEDAAEAAAABAAAAHAEDAAEAAAABAAAAPQEDAAEA',
  'AAABAAAAQgEDAAEAAAAAAgAAQwEDAAEAAAAAAgAARAEEAAEAAACABAAARQEEAAEAAADmnQ0AUwEDAAEAAAADAAAAgaQCAAYAAADW',
  'AwAAAAAAAC05OTk5AJuqQgBlPUsAu71TACAhXAAclGMAuzdsALCidAC+2nwAEl2EAJVSjACBEJQAegmcAMGFpQA+Aa0Ar6uzAKBt',
  'uwDCkggAToAIAF1jCAD0cgcAl6MIAO1qCAAGOAgATIIHAHv1BwDkvQcA8fgHAD98CQB1ewcAaaoGAOnBBwCIkwkAbqINAFJhGwBr',
  'ZCgAxio1ANy+DQARAw0AU8YMAM1/DQDmnQ0A',
].join('');

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function imageOf(bytes: Uint8Array): CogImage {
  const parsed = parseCogHeader(bytes);
  if (!('image' in parsed)) throw new Error(`header needs ${parsed.needBytes} bytes`);
  return parsed.image;
}

/** A deterministic pseudo-random generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** fetch stand-in serving `file` with Range support; records the requested ranges. */
function rangeFetch(file: Uint8Array, opts: { ignoreRange?: boolean } = {}) {
  const ranges: string[] = [];
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range');
    ranges.push(range ?? '');
    const r = rangeSlice(file, opts.ignoreRange ? null : range);
    return new Response(r.body.slice(), {
      status: r.status,
      headers: { 'content-length': String(r.body.length) },
    });
  }) as typeof fetch;
  return { fetchImpl, ranges };
}

describe('lzwDecode / lzwEncode', () => {
  it('round-trips short, repetitive, random and long inputs (table resets at 4094 codes)', () => {
    const r = rng(7);
    const cases = [
      new Uint8Array(0),
      Uint8Array.of(42),
      new TextEncoder().encode('TOBEORNOTTOBEORTOBEORNOT#'),
      new Uint8Array(100_000).fill(3),
      Uint8Array.from({ length: 60_000 }, () => Math.floor(r() * 256)),
      Uint8Array.from({ length: 200_000 }, (_, i) => (i * 7 + (i >> 9)) & 0xff),
    ];
    for (const data of cases) {
      const enc = lzwEncode(data);
      expect(lzwDecode(enc, data.length)).toEqual(data);
    }
  });

  it('stops at the expected length and rejects invalid codes', () => {
    const data = new TextEncoder().encode('ABABABABABABABAB');
    expect(lzwDecode(lzwEncode(data), 5)).toEqual(data.subarray(0, 5));
    // Clear (256), then code 300 (not in the table yet), 9 bits each.
    const bad = Uint8Array.of(0b10000000, 0b01001011, 0b00000000);
    expect(() => lzwDecode(bad, 10)).toThrow(CogFormatError);
  });
});

describe('parseCogHeader', () => {
  it('reads IFD0 of a real swissSURFACE3D header (1,152 bytes)', () => {
    const bytes = fromBase64(REAL_HEADER_BASE64);
    expect(bytes.length).toBe(1152);
    const im = imageOf(bytes);
    expect(im).toMatchObject({
      width: 2000,
      height: 2000,
      tileWidth: 512,
      tileHeight: 512,
      tilesAcross: 4,
      tilesDown: 4,
      compression: 5,
      predictor: 1,
      bitsPerSample: 32,
      sampleFormat: 3,
      littleEndian: true,
      noData: -9999,
      originX: 2596000,
      originY: 1199000,
      resX: 0.5,
      resY: 0.5,
    });
    expect(im.tileOffsets.slice(0, 4)).toEqual([4369051, 4930917, 5488059, 6037792]);
    expect(im.tileByteCounts.reduce((a, b) => a + b, 0)).toBe(8541717);
  });

  it('asks for more bytes while IFD0 or its values do not fit', () => {
    const bytes = fromBase64(REAL_HEADER_BASE64);
    expect(parseCogHeader(bytes.subarray(0, 4))).toEqual({ needBytes: 8 });
    expect(parseCogHeader(bytes.subarray(0, 300))).toEqual({ needBytes: 438 }); // 20 entries from 192
    const partial = parseCogHeader(bytes.subarray(0, 1000));
    expect('needBytes' in partial && partial.needBytes).toBeGreaterThan(1000);
  });

  it('rejects formats the reader does not handle', () => {
    const cog = buildCog({
      width: 4,
      height: 4,
      tileSize: 16,
      value: () => 1,
      originX: 0,
      originY: 0,
      res: 1,
    });
    const big = cog.slice();
    big[2] = 43;
    expect(() => parseCogHeader(big)).toThrow(/BigTIFF/);
    expect(() => parseCogHeader(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8))).toThrow(CogFormatError);
    // Predictor 2: patch the value of tag 317 (SHORT, inline).
    const pred = cog.slice();
    const dv = new DataView(pred.buffer);
    const n = dv.getUint16(8, true);
    for (let k = 0; k < n; k++) {
      const e = 10 + 12 * k;
      if (dv.getUint16(e, true) === 317) dv.setUint16(e + 8, 2, true);
    }
    expect(() => parseCogHeader(pred)).toThrow(/Predictor 2/);
  });
});

describe('synthetic COG: tiles, edge tiles, nodata', () => {
  // 70 × 45 pixels in 32-pixel tiles: 3 × 2 tiles, the right and bottom ones partly padding.
  const value = (c: number, r: number): number => (c === 5 && r === 7 ? -9999 : 400 + c + r / 100);
  const opts = { width: 70, height: 45, tileSize: 32, value, originX: 2600000, originY: 1200000, res: 0.5 };

  for (const variant of [
    { name: 'LZW, little-endian', extra: {} },
    { name: 'uncompressed, big-endian', extra: { compression: 1 as const, bigEndian: true } },
  ]) {
    it(`decodes every pixel (${variant.name})`, () => {
      const cog = buildCog({ ...opts, ...variant.extra });
      const im = imageOf(cog);
      expect(im).toMatchObject({ tilesAcross: 3, tilesDown: 2, originX: 2600000, originY: 1200000 });
      const target = new Float32Array(70 * 45).fill(-1);
      const tiles = cogTilesForWindow(im, 0, 0, 70, 45);
      expect(tiles.map((t) => [t.col, t.row])).toEqual([
        [0, 0],
        [1, 0],
        [2, 0],
        [0, 1],
        [1, 1],
        [2, 1],
      ]);
      let written = 0;
      for (const t of tiles) {
        const values = decodeCogTile(im, cog.subarray(t.offset, t.offset + t.byteCount));
        written += copyTileInto(im, t, values, target, 70, 45, 0, 0);
      }
      expect(written).toBe(70 * 45);
      for (let r = 0; r < 45; r++) {
        for (let c = 0; c < 70; c++) {
          const v = target[r * 70 + c];
          if (c === 5 && r === 7) expect(v).toBeNaN();
          else expect(v).toBe(Math.fround(value(c, r)));
        }
      }
    });
  }

  it('copies a window with an offset and clips it to the image', () => {
    const cog = buildCog(opts);
    const im = imageOf(cog);
    // Window of 20 × 10 pixels starting at image pixel (60, 40): only 10 × 5 of it lie in the image.
    const target = new Float32Array(20 * 10).fill(-1);
    const tiles = cogTilesForWindow(im, 60, 40, 80, 50);
    expect(tiles.map((t) => t.index)).toEqual([4, 5]);
    let written = 0;
    for (const t of tiles) {
      const values = decodeCogTile(im, cog.subarray(t.offset, t.offset + t.byteCount));
      written += copyTileInto(im, t, values, target, 20, 10, 60, 40);
    }
    expect(written).toBe(50);
    expect(target[0]).toBe(Math.fround(value(60, 40)));
    expect(target[9 + 4 * 20]).toBe(Math.fround(value(69, 44)));
    expect(target[10]).toBe(-1); // beyond the image: untouched
    expect(target[5 * 20]).toBe(-1);
  });

  it('skips sparse tiles (byte count 0)', () => {
    const im = imageOf(buildCog({ ...opts, sparseTiles: [1] }));
    expect(cogTilesForWindow(im, 0, 0, 70, 45).map((t) => t.index)).toEqual([0, 2, 3, 4, 5]);
  });

  it('merges ranges of tiles stored next to each other', () => {
    const t = (index: number, offset: number, byteCount: number) => ({
      index,
      col: 0,
      row: 0,
      offset,
      byteCount,
    });
    const ranges = mergeCogRanges([t(2, 1100, 100), t(0, 1000, 92), t(1, 1200, 50), t(3, 5000, 10)], 8, 240);
    expect(ranges.map((r) => [r.start, r.end, r.tiles.map((x) => x.index)])).toEqual([
      [1000, 1200, [0, 2]], // 1092 → 1100: gap 8
      [1200, 1250, [1]], // would exceed 240 bytes with the previous range
      [5000, 5010, [3]],
    ]);
  });
});

describe('fetchCogHeader / fetchByteRange', () => {
  const cog = buildCog({
    width: 64,
    height: 64,
    tileSize: 32,
    value: (c, r) => c * r,
    originX: 0,
    originY: 0,
    res: 1,
    headerPadding: COG_HEADER_BYTES + 100,
  });

  it('grows the header read when IFD0 lies beyond the first range', async () => {
    const { fetchImpl, ranges } = rangeFetch(cog);
    const header = await fetchCogHeader('https://x/a.tif', { fetchImpl });
    expect(header.image.width).toBe(64);
    expect(header.requests).toBe(2);
    expect(ranges).toEqual([`bytes=0-${COG_HEADER_BYTES - 1}`, `bytes=0-${2 * COG_HEADER_BYTES - 1}`]);
  });

  it('reads exact ranges (206), accepts a small 200 body, refuses a large one without Range support', async () => {
    const { fetchImpl } = rangeFetch(cog);
    const bytes = await fetchByteRange('https://x/a.tif', 10, 20, { fetchImpl });
    expect(bytes).toEqual(cog.subarray(10, 20));
    const small = buildCog({
      width: 4,
      height: 4,
      tileSize: 16,
      value: () => 1,
      originX: 0,
      originY: 0,
      res: 1,
    });
    const whole = rangeFetch(small, { ignoreRange: true });
    expect(await fetchByteRange('https://x/b.tif', 8, 16, { fetchImpl: whole.fetchImpl })).toEqual(
      small.subarray(8, 16),
    );
    const large = buildCog({
      width: 256,
      height: 256,
      tileSize: 256,
      value: (c) => c,
      originX: 0,
      originY: 0,
      res: 1,
      compression: 1,
    });
    const noRange = rangeFetch(large, { ignoreRange: true });
    await expect(fetchByteRange('https://x/c.tif', 0, 100, { fetchImpl: noRange.fetchImpl })).rejects.toThrow(
      RangeNotSupportedError,
    );
    // A tile range that ends past the file is an error; a header read may be short.
    await expect(
      fetchByteRange('https://x/a.tif', cog.length - 4, cog.length + 4, { fetchImpl }),
    ).rejects.toThrow(CogFormatError);
    expect(
      await fetchByteRange('https://x/a.tif', cog.length - 4, cog.length + 4, {
        fetchImpl,
        allowShort: true,
      }),
    ).toHaveLength(4);
  });
});
