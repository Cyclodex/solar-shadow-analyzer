import { PbfWriter } from 'pbf';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILDING_TILE_ZOOM,
  SWISSTOPO_ATTRIBUTION,
  SWISSTOPO_VT_TILEJSON,
  assembleBuildingParts,
  buildingTileUrl,
  clearBuildingTileCache,
  coverageFraction,
  decodeBuildingTile,
  fetchSwisstopoBuildings,
  lonLatToTile,
  mergeSeamPieces,
  tileToLonLat,
  tilesForRadius,
  type TileId,
} from './buildingSources';
import { lonLatToEnu } from './enu';
import { clipRingToBox, pointInRing, ringArea, type Ring } from './polygon';

// ── Synthetic Mapbox Vector Tiles (spec 2.1) ─

interface FixtureFeature {
  props: Record<string, number | string>;
  /** Rings in tile units, open (the encoder adds ClosePath). */
  rings: [number, number][][];
  type?: number;
}
interface FixtureLayer {
  name: string;
  extent?: number;
  features: FixtureFeature[];
}

const zigzag = (n: number): number => (n << 1) ^ (n >> 31);
const command = (id: number, count: number): number => (id & 7) | (count << 3);

function geometry(rings: [number, number][][]): number[] {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (const ring of rings) {
    ring.forEach(([px, py], i) => {
      if (i === 0) out.push(command(1, 1));
      if (i === 1) out.push(command(2, ring.length - 1));
      out.push(zigzag(px - x), zigzag(py - y));
      x = px;
      y = py;
    });
    out.push(command(7, 1));
  }
  return out;
}

/** Encodes layers as an MVT tile with PbfWriter (keys/values tables, packed tags and geometry). */
function encodeTile(layers: FixtureLayer[]): Uint8Array {
  const pbf = new PbfWriter();
  for (const layer of layers) {
    pbf.writeMessage(
      3,
      (l: FixtureLayer, w: PbfWriter) => {
        w.writeVarintField(15, 2);
        w.writeStringField(1, l.name);
        const keys: string[] = [];
        const values: (number | string)[] = [];
        const index = <T>(list: T[], v: T): number => {
          const i = list.indexOf(v);
          if (i >= 0) return i;
          list.push(v);
          return list.length - 1;
        };
        for (const f of l.features) {
          w.writeMessage(
            2,
            (feat: FixtureFeature, fw: PbfWriter) => {
              const tags: number[] = [];
              for (const [k, v] of Object.entries(feat.props)) tags.push(index(keys, k), index(values, v));
              fw.writePackedVarint(2, tags);
              fw.writeVarintField(3, feat.type ?? 3);
              fw.writePackedVarint(4, geometry(feat.rings));
            },
            f,
          );
        }
        for (const k of keys) w.writeStringField(3, k);
        for (const v of values) {
          w.writeMessage(
            4,
            (val: number | string, vw: PbfWriter) => {
              if (typeof val === 'string') vw.writeStringField(1, val);
              else if (Number.isInteger(val)) vw.writeSVarintField(6, val);
              else vw.writeDoubleField(3, val);
            },
            v,
          );
        }
        w.writeVarintField(5, l.extent ?? 4096);
      },
      layer,
    );
  }
  return pbf.finish();
}

/** Tiles of Kramgasse 49, Bern at z14 (the four tiles a 300 m radius needs). */
const KRAMGASSE = { latitude: 46.947849, longitude: 7.449978 };
const E = 4096;
const BUFFER = 16;

/**
 * Cuts buildings given in global tile units into tiles like the tile generator: each tile gets every building
 * clipped to its square plus a 16-unit buffer, rounded to whole units. `tiles` defaults to the 2 × 2 block
 * starting at (x0, y0).
 */
function cutIntoTiles(
  buildings: { ring: Ring; holes?: Ring[]; props: Record<string, number | string> }[],
  tiles: TileId[],
  extraLayers: FixtureLayer[] = [],
): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const t of tiles) {
    const x0 = t.x * E;
    const y0 = t.y * E;
    const features: FixtureFeature[] = [];
    for (const b of buildings) {
      const local = (r: Ring): [number, number][] =>
        clipRingToBox(r, x0 - BUFFER, y0 - BUFFER, x0 + E + BUFFER, y0 + E + BUFFER).map(([x, y]) => [
          Math.round(x - x0),
          Math.round(y - y0),
        ]);
      const outer = local(b.ring);
      if (outer.length < 3 || Math.abs(ringArea(outer)) < 1) continue;
      features.push({
        props: b.props,
        rings: [outer, ...(b.holes ?? []).map(local).filter((h) => h.length >= 3)],
      });
    }
    out.set(`${t.x}/${t.y}`, encodeTile([{ name: 'building', features }, ...extraLayers]));
  }
  return out;
}

/** Axis-aligned rectangle in global tile units, clockwise on screen (y down) like MVT exterior rings. */
const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const tileId = (x: number, y: number): TileId => ({ z: BUILDING_TILE_ZOOM, x, y });
const decodeAll = (tiles: Map<string, Uint8Array>) =>
  [...tiles].map(([k, bytes]) => {
    const [x, y] = k.split('/').map(Number);
    return decodeBuildingTile(bytes, tileId(x!, y!));
  });

/** Area in m² of an ENU footprint minus its holes. */
const netArea = (p: { footprint: [number, number][]; holes?: [number, number][][] }): number =>
  ringArea(p.footprint) + (p.holes ?? []).reduce((a, h) => a + ringArea(h), 0);

// ── Tests ────────────────────────────────────

describe('tile maths', () => {
  it('tiles for a 300 m radius around Kramgasse 49: the four z14 tiles 8530–8531 / 5765–5766', () => {
    expect(tilesForRadius(KRAMGASSE.latitude, KRAMGASSE.longitude, 300)).toEqual([
      tileId(8530, 5765),
      tileId(8531, 5765),
      tileId(8530, 5766),
      tileId(8531, 5766),
    ]);
    expect(tilesForRadius(KRAMGASSE.latitude, KRAMGASSE.longitude, 50)).toEqual([tileId(8531, 5766)]);
    expect(buildingTileUrl(tileId(8531, 5766))).toBe(
      'https://vectortiles.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/14/8531/5766.pbf',
    );
  });

  it('tile coordinates round-trip', () => {
    const t = lonLatToTile(KRAMGASSE.latitude, KRAMGASSE.longitude, 14);
    expect(t.x).toBeCloseTo(8531.0568, 3);
    expect(t.y).toBeCloseTo(5766.1609, 3);
    const g = tileToLonLat(t.x, t.y, 14);
    expect(g.latitude).toBeCloseTo(KRAMGASSE.latitude, 10);
    expect(g.longitude).toBeCloseTo(KRAMGASSE.longitude, 10);
  });
});

describe('decodeBuildingTile', () => {
  it('reads building polygons (outer + holes) in global units, skips underground and non-polygons', () => {
    const bytes = encodeTile([
      {
        name: 'building',
        features: [
          { props: { render_height: 12, render_min_height: 0 }, rings: [rect(100, 100, 200, 180)] },
          {
            props: { render_height: 20, render_min_height: 0, class: 'place_of_worship' },
            rings: [rect(300, 300, 400, 400), [...rect(330, 330, 360, 360)].reverse()],
          },
          {
            props: { render_height: 9, render_min_height: 0, class: 'underground' },
            rings: [rect(0, 0, 50, 50)],
          },
          {
            props: { render_height: 9, render_min_height: 0 },
            rings: [
              [
                [5, 5],
                [60, 60],
              ],
            ],
            type: 2,
          },
          { props: { class: 'roof' }, rings: [rect(500, 500, 520, 520)] }, // no height
        ],
      },
      {
        name: 'transportation',
        features: [
          {
            props: { class: 'path' },
            rings: [
              [
                [0, 0],
                [9, 9],
              ],
            ],
            type: 2,
          },
        ],
      },
    ]);
    const t = decodeBuildingTile(bytes, tileId(8531, 5766));
    expect(t.layers).toEqual(['building', 'transportation']);
    expect(t.polygons).toHaveLength(2);
    const [a, b] = t.polygons;
    expect(a).toMatchObject({ height: 12, minHeight: 0, kind: null, holes: [] });
    expect(a!.outer[0]).toEqual([8531 * E + 100, 5766 * E + 100]);
    expect(b).toMatchObject({ height: 20, kind: 'place_of_worship' });
    expect(b!.holes).toHaveLength(1);
    expect(b!.featureId).toBeUndefined();
  });

  it('rescales other extents to 4096 units per tile', () => {
    const bytes = encodeTile([
      {
        name: 'building',
        extent: 512,
        features: [{ props: { render_height: 5 }, rings: [rect(0, 0, 256, 256)] }],
      },
    ]);
    const [p] = decodeBuildingTile(bytes, tileId(0, 0)).polygons;
    expect(p!.outer).toContainEqual([2048, 2048]);
  });
});

describe('assembleBuildingParts', () => {
  const tiles = [tileId(8530, 5765), tileId(8531, 5765), tileId(8530, 5766), tileId(8531, 5766)];
  const X = 8531 * E; // vertical tile edge
  const Y = 5766 * E; // horizontal tile edge
  const site = lonLatToTile(KRAMGASSE.latitude, KRAMGASSE.longitude, 14);
  const sx = site.x * E;
  const sy = site.y * E;

  it('converts to ENU metres around the point (1 cm) and orients footprints counter-clockwise', () => {
    const ring = rect(sx + 20, sy - 40, sx + 60, sy - 10);
    const decoded = decodeAll(
      cutIntoTiles([{ ring, props: { render_height: 15, render_min_height: 0 } }], tiles),
    );
    const { parts } = assembleBuildingParts(decoded, KRAMGASSE.latitude, KRAMGASSE.longitude, 300);
    expect(parts).toHaveLength(1);
    const p = parts[0]!;
    expect(p).toMatchObject({ height: 15, minHeight: 0, kind: null });
    expect(ringArea(p.footprint)).toBeGreaterThan(0);
    // Every corner, rounded to whole tile units by the "generator", maps to lonLatToEnu of its position.
    for (const [x, y] of ring) {
      const g = tileToLonLat(Math.round(x) / E, Math.round(y) / E, 14);
      const [e, n] = lonLatToEnu(KRAMGASSE, g.latitude, g.longitude);
      expect(p.footprint.some(([pe, pn]) => Math.abs(pe - e) < 0.011 && Math.abs(pn - n) < 0.011)).toBe(true);
    }
    // 40 × 30 units at 0.4 m per unit (z14, 47° N)
    const unit = (2 * Math.PI * 6378137 * Math.cos((KRAMGASSE.latitude * Math.PI) / 180)) / (2 ** 14 * E);
    expect(ringArea(p.footprint)).toBeCloseTo(40 * 30 * unit * unit, -1);
  });

  it('joins a building cut at a tile edge (both copies cut at the 16-unit buffer) into one part', () => {
    // 200 units (≈ 80 m) across the vertical edge: neither tile holds it completely.
    const ring = rect(X - 100, sy - 30, X + 100, sy + 10);
    const decoded = decodeAll(
      cutIntoTiles([{ ring, props: { render_height: 18, render_min_height: 0 } }], tiles),
    );
    const { parts, mergedPieces } = assembleBuildingParts(
      decoded,
      KRAMGASSE.latitude,
      KRAMGASSE.longitude,
      500,
    );
    expect(parts).toHaveLength(1);
    expect(mergedPieces).toBe(1);
    expect(parts[0]!.footprint).toHaveLength(4); // the cut vertices on the tile edge are gone
    // Assembled tile by tile, the two halves stay separate.
    const separate = decoded.flatMap(
      (t) => assembleBuildingParts([t], KRAMGASSE.latitude, KRAMGASSE.longitude, 500).parts,
    );
    expect(separate).toHaveLength(2);
    expect(netArea(parts[0]!)).toBeCloseTo(
      separate.reduce((a, p) => a + netArea(p), 0),
      0,
    );
  });

  it('keeps adjacent parts of different height separate, joins a building over the four-tile corner', () => {
    const decoded = decodeAll(
      cutIntoTiles(
        [
          { ring: rect(X - 60, sy - 30, X, sy), props: { render_height: 12, render_min_height: 0 } },
          { ring: rect(X, sy - 30, X + 60, sy), props: { render_height: 21, render_min_height: 0 } },
          { ring: rect(X - 50, Y - 40, X + 70, Y + 30), props: { render_height: 30, render_min_height: 0 } },
        ],
        tiles,
      ),
    );
    const { parts } = assembleBuildingParts(decoded, KRAMGASSE.latitude, KRAMGASSE.longitude, 500);
    expect(parts.map((p) => p.height).sort((a, b) => a - b)).toEqual([12, 21, 30]);
    expect(parts.find((p) => p.height === 30)!.footprint).toHaveLength(4);
  });

  it('joins a U-shaped building that crosses the edge twice, and a courtyard building (hole)', () => {
    const u: Ring = [
      [X - 80, sy - 60],
      [X + 40, sy - 60],
      [X + 40, sy - 40],
      [X - 60, sy - 40],
      [X - 60, sy - 10],
      [X + 40, sy - 10],
      [X + 40, sy + 10],
      [X - 80, sy + 10],
    ];
    const court = rect(X - 60, sy + 40, X + 60, sy + 120);
    const hole = [...rect(X - 30, sy + 60, X + 30, sy + 100)].reverse();
    const decoded = decodeAll(
      cutIntoTiles(
        [
          { ring: u, props: { render_height: 16, render_min_height: 0 } },
          { ring: court, holes: [hole], props: { render_height: 22, render_min_height: 0 } },
        ],
        tiles,
      ),
    );
    const { parts } = assembleBuildingParts(decoded, KRAMGASSE.latitude, KRAMGASSE.longitude, 500);
    expect(parts).toHaveLength(2);
    const uPart = parts.find((p) => p.height === 16)!;
    expect(uPart.footprint).toHaveLength(8);
    expect(uPart.holes).toBeUndefined();
    const courtPart = parts.find((p) => p.height === 22)!;
    expect(courtPart.footprint).toHaveLength(4);
    expect(courtPart.holes).toHaveLength(1);
    expect(ringArea(courtPart.holes![0]!)).toBeLessThan(0);
    const [ce, cn] = lonLatToEnu(KRAMGASSE, ...latLonOf(X, sy + 80));
    expect(pointInRing(courtPart.footprint, ce, cn)).toBe(true);
    expect(pointInRing(courtPart.holes![0]!, ce, cn)).toBe(true);
  });

  it('keeps only parts that reach into the radius', () => {
    const near = rect(sx + 10, sy + 10, sx + 20, sy + 20);
    const far = rect(sx + 1500, sy + 10, sx + 1520, sy + 20); // ≈ 610 m east
    const decoded = decodeAll(
      cutIntoTiles(
        [
          { ring: near, props: { render_height: 10, render_min_height: 0 } },
          { ring: far, props: { render_height: 10, render_min_height: 0 } },
        ],
        tiles,
      ),
    );
    expect(assembleBuildingParts(decoded, KRAMGASSE.latitude, KRAMGASSE.longitude, 300).parts).toHaveLength(
      1,
    );
  });

  it('joins a real building from the live tiles 14/8530/5766 and 14/8531/5766 (excerpt, 2026-09-25)', () => {
    // A hollow building 115 m west of Kramgasse 49, crossing the tile edge; both copies are cut at the buffer.
    const a: [number, number][] = [
      [4112, 807],
      [4112, 811],
      [4052, 812],
      [4052, 854],
      [4008, 854],
      [4008, 812],
      [4001, 812],
      [4001, 780],
      [4112, 779],
      [4112, 784],
      [4006, 785],
      [4006, 807],
      [4013, 807],
      [4013, 849],
      [4047, 849],
      [4047, 807],
    ];
    const b: [number, number][] = [
      [-16, 785],
      [-16, 780],
      [76, 779],
      [76, 854],
      [35, 854],
      [34, 811],
      [-16, 812],
      [-16, 807],
      [39, 807],
      [40, 849],
      [71, 849],
      [71, 784],
    ];
    const props = { render_height: 18, render_min_height: 0 };
    const decoded = [
      decodeBuildingTile(
        encodeTile([{ name: 'building', features: [{ props, rings: [a] }] }]),
        tileId(8530, 5766),
      ),
      decodeBuildingTile(
        encodeTile([{ name: 'building', features: [{ props, rings: [b] }] }]),
        tileId(8531, 5766),
      ),
    ];
    const { parts, mergedPieces } = assembleBuildingParts(
      decoded,
      KRAMGASSE.latitude,
      KRAMGASSE.longitude,
      300,
    );
    expect(mergedPieces).toBe(1);
    expect(parts).toHaveLength(1);
    const separate = decoded.flatMap(
      (t) => assembleBuildingParts([t], KRAMGASSE.latitude, KRAMGASSE.longitude, 300).parts,
    );
    expect(separate).toHaveLength(2);
    // Same area (the rounding of the cut differs by < 1 unit per copy: allow 3 m²).
    expect(Math.abs(netArea(parts[0]!) - separate.reduce((s, p) => s + netArea(p), 0))).toBeLessThan(3);
    // No edge left along the tile edge, and no vertex where the outline merely crosses it.
    const edgeE = lonLatToEnu(KRAMGASSE, KRAMGASSE.latitude, tileToLonLat(8531, 5766, 14).longitude)[0];
    const rings = [parts[0]!.footprint, ...(parts[0]!.holes ?? [])];
    expect(rings.flat().filter(([e]) => Math.abs(e - edgeE) < 0.05)).toHaveLength(0);
    expect(parts[0]!.holes).toHaveLength(1);
    expect(rings.map((r) => r.length)).toEqual([10, 10]);
  });
});

function latLonOf(x: number, y: number): [number, number] {
  const g = tileToLonLat(x / E, y / E, 14);
  return [g.latitude, g.longitude];
}

describe('mergeSeamPieces', () => {
  it('cancels the shared edge, snapping vertices within one unit', () => {
    const left: Ring = [
      [0, 0],
      [10, 0],
      [10, 5.4],
      [0, 5],
    ];
    const right: Ring = [
      [10, 0.3],
      [20, 0],
      [20, 5],
      [10, 5],
    ];
    const polys = mergeSeamPieces([[left], [right]], [{ axis: 'x', coord: 10 }]);
    expect(polys).toHaveLength(1);
    expect(polys[0]!).toHaveLength(1);
    expect(polys[0]![0]).toHaveLength(4);
    expect(Math.abs(ringArea(polys[0]![0]!))).toBeCloseTo(100, 0);
  });
});

// ── Network (stubbed) ────────────────────────

describe('fetchSwisstopoBuildings', () => {
  afterEach(() => clearBuildingTileCache());
  const tiles4 = [tileId(8530, 5765), tileId(8531, 5765), tileId(8530, 5766), tileId(8531, 5766)];
  const site = lonLatToTile(KRAMGASSE.latitude, KRAMGASSE.longitude, 14);
  const building = {
    ring: rect(site.x * E + 20, site.y * E - 40, site.x * E + 60, site.y * E - 10),
    props: { render_height: 15, render_min_height: 0 },
  };
  const instant = { sleep: () => Promise.resolve(), random: () => 0 };
  /** Swiss tiles have map data besides buildings (a layer without features is not in the tile at all). */
  const landcover: FixtureLayer = {
    name: 'landcover',
    features: [{ props: { class: 'wood' }, rings: [rect(0, 0, 10, 10)] }],
  };

  function stubFetch(
    tiles: Map<string, Uint8Array>,
    opts: { fail?: Record<string, number[]>; gzip?: boolean } = {},
  ): typeof fetch & { urls: string[] } {
    const urls: string[] = [];
    const attempts = new Map<string, number>();
    const f = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      urls.push(url);
      const n = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, n);
      if (url === SWISSTOPO_VT_TILEJSON) return Response.json({ attribution: '© swisstopo (test)' });
      const m = /\/14\/(\d+)\/(\d+)\.pbf$/.exec(url);
      const failures = opts.fail?.[m ? `${m[1]}/${m[2]}` : ''] ?? [];
      if (n <= failures.length) return new Response('', { status: failures[n - 1] });
      const bytes = m ? tiles.get(`${m[1]}/${m[2]}`) : undefined;
      if (!bytes) return new Response('', { status: 404 });
      let body: Uint8Array = bytes;
      if (opts.gzip) {
        const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
        body = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      return new Response(body as BlobPart, {
        status: 200,
        headers: { 'content-length': String(body.byteLength) },
      });
    };
    return Object.assign(f as typeof fetch, { urls });
  }

  it('fetches the tiles of the radius, reports progress and bytes, reads the attribution', async () => {
    const tiles = cutIntoTiles([building], tiles4);
    const fetchImpl = stubFetch(tiles);
    const progress: [number, number][] = [];
    const r = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]!.height).toBe(15);
    expect(r.tileCount).toBe(4);
    expect(r.covered).toBe(true);
    expect(r.attribution).toBe('© swisstopo (test)');
    expect(r.bytes).toBe([...tiles.values()].reduce((a, b) => a + b.byteLength, 0));
    expect(progress.at(-1)).toEqual([4, 4]);
    expect(fetchImpl.urls.filter((u) => u.endsWith('.pbf')).sort()).toEqual(
      tiles4.map(buildingTileUrl).sort(),
    );
    // A second import of the same tiles comes from memory (no new tile requests, 0 bytes).
    const again = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, { fetchImpl });
    expect(again.ok && again.bytes).toBe(0);
    expect(fetchImpl.urls.filter((u) => u.endsWith('.pbf'))).toHaveLength(4);
  });

  it('decodes gzip bodies sent without Content-Encoding', async () => {
    const fetchImpl = stubFetch(cutIntoTiles([building], tiles4), { gzip: true });
    const r = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, { fetchImpl });
    expect(r.ok && r.parts.length).toBe(1);
  });

  it('retries transient failures (503, 429) with backoff, then succeeds', async () => {
    const fetchImpl = stubFetch(cutIntoTiles([building], tiles4), { fail: { '8531/5766': [503, 429] } });
    const r = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl,
      retry: instant,
    });
    expect(r.ok).toBe(true);
    expect(fetchImpl.urls.filter((u) => u.endsWith('8531/5766.pbf'))).toHaveLength(3);
  });

  it('returns typed errors and never throws', async () => {
    const tiles = cutIntoTiles([building], tiles4);
    const forbidden = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl: stubFetch(tiles, { fail: { '8530/5765': [403] } }),
      retry: instant,
    });
    expect(forbidden).toMatchObject({ ok: false, error: { kind: 'http', status: 403 }, tileCount: 4 });

    const down = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl: stubFetch(tiles, { fail: { '8530/5765': [500, 500, 500, 500, 500] } }),
      retry: instant,
    });
    expect(down).toMatchObject({ ok: false, error: { kind: 'http', status: 500 } });

    const offline = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl: (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch,
      retry: instant,
    });
    expect(offline).toMatchObject({ ok: false, error: { kind: 'network' } });

    const junk = new Map([...tiles].map(([k]) => [k, new Uint8Array([0x1a, 0xff, 0xff, 0xff, 0x0f])]));
    const corrupt = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl: stubFetch(junk),
    });
    expect(corrupt).toMatchObject({ ok: false, error: { kind: 'decode' } });

    for (const [lat, lon, radius] of [
      [NaN, 7, 300],
      [47, 7, 0],
      [47, 7, 5000],
      [89, 7, 300],
    ] as const) {
      expect(await fetchSwisstopoBuildings(lat, lon, radius)).toMatchObject({
        ok: false,
        error: { kind: 'invalid-input' },
      });
    }
  });

  it('aborts', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl: stubFetch(cutIntoTiles([building], tiles4)),
      signal: ctrl.signal,
    });
    expect(r).toMatchObject({ ok: false, error: { kind: 'aborted' } });
  });

  it('outside CH/FL: tiles without map data → no parts, covered false, default attribution on failure', async () => {
    const boundary: FixtureFeature = {
      props: { admin_level: 2 },
      rings: [
        [
          [0, 0],
          [4096, 4096],
        ],
      ],
      type: 2,
    };
    const empty = new Map(
      tiles4.map((t) => [
        `${t.x}/${t.y}`,
        encodeTile([{ name: 'administrative_unit', features: [boundary] }]),
      ]),
    );
    const base = stubFetch(empty);
    const fetchImpl = (async (input: RequestInfo | URL) =>
      String(input) === SWISSTOPO_VT_TILEJSON
        ? new Response('', { status: 404 })
        : base(input)) as typeof fetch;
    const r = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, { fetchImpl });
    expect(r).toMatchObject({ ok: true, parts: [], covered: false, attribution: SWISSTOPO_ATTRIBUTION });
  });

  it('outside the tileset (404, e.g. Paris, Vienna): no data, covered false — not an error', async () => {
    const fetchImpl = stubFetch(new Map()); // every tile 404
    const r = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl,
      retry: instant,
    });
    expect(r).toMatchObject({ ok: true, parts: [], covered: false, coverage: 0, tileCount: 4, bytes: 0 });
    expect(fetchImpl.urls.filter((u) => u.endsWith('.pbf'))).toHaveLength(4); // 404 is not retried
    // One missing tile: the others still count, the gap shows in the coverage.
    const tiles = cutIntoTiles([building], tiles4, [landcover]);
    tiles.delete(`${Math.floor(site.x)}/${Math.floor(site.y)}`); // the tile holding most of the circle
    clearBuildingTileCache();
    const partial = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl: stubFetch(tiles),
      retry: instant,
    });
    expect(partial.ok && partial.covered).toBe(true);
    expect(partial.ok && partial.coverage).toBeGreaterThan(0.05);
    expect(partial.ok && partial.coverage).toBeLessThan(0.95);
  });

  it('retries a tile whose download breaks off (network), and reports a lasting failure as network', async () => {
    const tiles = cutIntoTiles([building], tiles4);
    const base = stubFetch(tiles);
    let broken = 0;
    const dropping = (times: number) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await base(input, init);
        if (!String(input).endsWith('8531/5766.pbf') || broken >= times) return res;
        broken++;
        const bytes = new Uint8Array(await res.arrayBuffer());
        let sent = false;
        const body = new ReadableStream<Uint8Array>({
          pull(c) {
            if (sent) c.error(new TypeError('network error'));
            else c.enqueue(bytes.subarray(0, 100));
            sent = true;
          },
        });
        return new Response(body, { status: 200 });
      }) as typeof fetch;
    const r = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl: dropping(1),
      retry: instant,
    });
    expect(r.ok && r.parts.length).toBe(1);
    expect(broken).toBe(1);

    clearBuildingTileCache();
    broken = 0;
    const lasting = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl: dropping(Infinity),
      retry: { ...instant, retries: 2 },
    });
    expect(lasting).toMatchObject({ ok: false, error: { kind: 'network', message: 'network error' } });
    expect(broken).toBe(3);
  });

  it('a stalled tile times out and is retried (per-attempt time limit)', async () => {
    const tiles = cutIntoTiles([building], tiles4);
    const base = stubFetch(tiles);
    let stalls = 0;
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('8530/5766.pbf') && stalls++ === 0)
        return new Promise<Response>(() => undefined);
      return base(input, init);
    }) as typeof fetch;
    const r = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl,
      retry: { ...instant, attemptTimeoutMs: 20 },
    });
    expect(r.ok && r.parts.length).toBe(1);
    expect(stalls).toBe(2);
  });

  it('a failing tile aborts the running requests and is the reported error', async () => {
    const tiles = cutIntoTiles([building], tiles4);
    const base = stubFetch(tiles);
    const aborted: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('8530/5765.pbf')) return Promise.resolve(new Response('', { status: 400 }));
      if (!url.endsWith('.pbf')) return base(input, init);
      // The other tiles hang until aborted.
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => {
          aborted.push(url);
          reject(new DOMException('aborted', 'AbortError'));
        }),
      );
    }) as typeof fetch;
    const r = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl,
      retry: instant,
    });
    expect(r).toMatchObject({ ok: false, error: { kind: 'http', status: 400 } });
    expect(aborted).toHaveLength(3);
  });

  it('an aborted import never returns ok, also when every tile comes from the cache', async () => {
    const fetchImpl = stubFetch(cutIntoTiles([building], tiles4));
    const warm = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, { fetchImpl });
    expect(warm.ok).toBe(true);
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl,
      signal: ctrl.signal,
    });
    expect(r).toMatchObject({ ok: false, error: { kind: 'aborted' } });
    // Aborted while the attribution loads (tiles from the cache, tiles.json not yet read): aborted as well.
    clearBuildingTileCache();
    const noJson = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === SWISSTOPO_VT_TILEJSON
        ? Promise.resolve(new Response('', { status: 404 }))
        : fetchImpl(input, init)) as typeof fetch;
    expect(
      (await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, { fetchImpl: noJson })).ok,
    ).toBe(true);
    const late = new AbortController();
    const abortingJson = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== SWISSTOPO_VT_TILEJSON) return fetchImpl(input, init);
      // tiles.json answers slowly; the user aborts after the (cached) tiles are done.
      setTimeout(() => late.abort(), 10);
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;
    const tileRequests = fetchImpl.urls.length;
    const r2 = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl: abortingJson,
      signal: late.signal,
    });
    expect(fetchImpl.urls).toHaveLength(tileRequests); // every tile from the cache
    expect(r2).toMatchObject({ ok: false, error: { kind: 'aborted' } });
  });

  it('coverage: share of the circle inside CH/FL from the not_CH_LI country polygon (border sites)', async () => {
    // Everything west of the site (x < site.x) lies outside CH/FL: half of the circle.
    const sx = Math.round(site.x * E);
    const outsideLayer = (t: TileId): FixtureLayer => {
      const x0 = t.x * E;
      const y0 = t.y * E;
      const west = clipRingToBox(
        rect(0, 0, sx, 1e9),
        x0 - BUFFER,
        y0 - BUFFER,
        x0 + E + BUFFER,
        y0 + E + BUFFER,
      );
      return {
        name: 'administrative_unit',
        features:
          west.length >= 3
            ? [
                {
                  props: { admin_level: 2, class: 'country', iso_a2: 'not_CH_LI' },
                  rings: [west.map(([x, y]): [number, number] => [x - x0, y - y0])],
                },
                {
                  // The CH polygon and other admin units are ignored.
                  props: { admin_level: 2, class: 'country', iso_a2: 'CH' },
                  rings: [rect(0, 0, E, E)],
                },
              ]
            : [],
      };
    };
    const tiles = new Map<string, Uint8Array>();
    for (const t of tiles4) {
      const one = cutIntoTiles([building], [t], [outsideLayer(t), landcover]);
      for (const [k, v] of one) tiles.set(k, v);
    }
    const decoded = decodeAll(tiles);
    expect(decoded.some((d) => d.outside.length > 0)).toBe(true);
    const half = coverageFraction(decoded, KRAMGASSE.latitude, KRAMGASSE.longitude, 300);
    expect(half).toBeGreaterThan(0.47);
    expect(half).toBeLessThan(0.53);
    const r = await fetchSwisstopoBuildings(KRAMGASSE.latitude, KRAMGASSE.longitude, 300, {
      fetchImpl: stubFetch(tiles),
    });
    expect(r).toMatchObject({ ok: true, covered: true, coverage: half });
    // Without any not_CH_LI polygon the whole circle is covered; tiles without map data count as outside.
    const inside = decodeAll(cutIntoTiles([building], tiles4, [landcover]));
    expect(coverageFraction(inside, KRAMGASSE.latitude, KRAMGASSE.longitude, 300)).toBe(1);
    expect(coverageFraction([], KRAMGASSE.latitude, KRAMGASSE.longitude, 300)).toBe(0);
  });
});
