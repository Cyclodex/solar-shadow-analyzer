// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encode } from 'fast-png';
import {
  EARTH_RADIUS_M,
  REFRACTION_K,
  TERRARIUM_URL,
  TILE_CONCURRENCY,
  clearTerrainTileCache,
  computeHorizon,
  createTileSampler,
  decodeTerrarium,
  decodeTerrariumPng,
  fetchTerrainHorizon,
  horizonSampleDistances,
  lonLatToTilePixel,
  planTerrainTiles,
  tilePixelToLonLat,
  tileUrl,
  type ElevationSampler,
  type TerrainTile,
} from './terrain';

// ── Independent reference implementations (not shared with terrain.ts) ──

const RAD = Math.PI / 180;

/** OSM slippy-map formula: world pixel position (256 px tiles), https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames */
function osmWorldPixel(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z * 256;
  const phi = lat * RAD;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n };
}

type V3 = [number, number, number];
const unit = (lat: number, lon: number): V3 => [
  Math.cos(lat * RAD) * Math.cos(lon * RAD),
  Math.cos(lat * RAD) * Math.sin(lon * RAD),
  Math.sin(lat * RAD),
];

/** Great-circle destination via vectors: p·cos δ + (cos A·north + sin A·east)·sin δ. */
function destination(lat: number, lon: number, azDeg: number, d: number): { lat: number; lon: number } {
  const p = unit(lat, lon);
  const east: V3 = [-Math.sin(lon * RAD), Math.cos(lon * RAD), 0];
  const north: V3 = [
    -Math.sin(lat * RAD) * Math.cos(lon * RAD),
    -Math.sin(lat * RAD) * Math.sin(lon * RAD),
    Math.cos(lat * RAD),
  ];
  const delta = d / EARTH_RADIUS_M;
  const a = azDeg * RAD;
  const q = [0, 1, 2].map(
    (i) => p[i] * Math.cos(delta) + (Math.cos(a) * north[i] + Math.sin(a) * east[i]) * Math.sin(delta),
  );
  return { lat: Math.asin(q[2]) / RAD, lon: Math.atan2(q[1], q[0]) / RAD };
}

/** Haversine distance, m (numerically exact for small distances). */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const s =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

/** Drop of a distant point below the observer's horizontal plane incl. refraction: d²/(2R)·(1 − k). */
const drop = (d: number): number => ((d * d) / (2 * EARTH_RADIUS_M)) * (1 - REFRACTION_K);

/** Flat terrain at `base` plus a cone (height H, base radius rc) centred at `apex`. */
function coneSampler(base: number, apex: { lat: number; lon: number }, H: number, rc: number): ElevationSampler {
  return (lat, lon) => base + H * Math.max(0, 1 - haversine(apex.lat, apex.lon, lat, lon) / rc);
}

const SITE = { latitude: 47.1, longitude: 7.45 };

describe('tile math', () => {
  it('maps the origin to the centre of the world tile', () => {
    // Web Mercator: (0°, 0°) is the centre of the z0 tile and the corner of four z1 tiles.
    expect(lonLatToTilePixel(0, 0, 0)).toEqual({ tileX: 0, tileY: 0, px: 128, py: 128 });
    expect(lonLatToTilePixel(0, 0, 1)).toEqual({ tileX: 1, tileY: 1, px: 0, py: 0 });
  });

  it('matches the OSM slippy-map formula', () => {
    const pts: [number, number][] = [
      [8.04, 46.62],
      [7.45, 47.1],
      [-122.4194, 37.7749],
      [151.2093, -33.8688],
      [-0.0001, 0.0001],
    ];
    for (const [lon, lat] of pts) {
      for (const z of [0, 5, 9, 12, 15]) {
        const r = osmWorldPixel(lon, lat, z);
        const t = lonLatToTilePixel(lon, lat, z);
        expect(t.tileX).toBe(Math.floor(r.x / 256));
        expect(t.tileY).toBe(Math.floor(r.y / 256));
        expect(t.tileX * 256 + t.px).toBeCloseTo(r.x, 6);
        expect(t.tileY * 256 + t.py).toBeCloseTo(r.y, 6);
      }
    }
  });

  it('round-trips lon/lat ↔ tile pixel', () => {
    for (const [lon, lat] of [
      [8.04, 46.62],
      [-179.9, -60],
      [179.99, 84],
      [0, 0],
    ]) {
      const t = lonLatToTilePixel(lon, lat, 13);
      const back = tilePixelToLonLat(t.tileX, t.tileY, t.px, t.py, 13);
      expect(back.lon).toBeCloseTo(lon, 9);
      expect(back.lat).toBeCloseTo(lat, 9);
    }
  });

  it('wraps x at the antimeridian', () => {
    const a = lonLatToTilePixel(180, 10, 4);
    const b = lonLatToTilePixel(-180, 10, 4);
    expect(a.tileX).toBe(0);
    expect(a).toEqual(b);
  });

  it('builds Terrarium URLs', () => {
    expect(tileUrl({ z: 12, x: 2139, y: 1446 })).toBe(
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/2139/1446.png',
    );
    expect(TERRARIUM_URL).toContain('{z}/{x}/{y}');
  });
});

describe('decodeTerrarium', () => {
  it('decodes (R·256 + G + B/256) − 32768', () => {
    // 128·256 − 32768 = 0; 0 → −32768; 129·256 + 2 + 128/256 − 32768 = 258.5; 255·256 + 255 + 255/256 − 32768 ≈ 32767.996
    const rgb = new Uint8Array([128, 0, 0, 0, 0, 0, 129, 2, 128, 255, 255, 255]);
    expect(Array.from(decodeTerrarium(rgb, 3))).toEqual([0, -32768, 258.5, Math.fround(32767 + 255 / 256)]);
  });

  it('skips the alpha channel', () => {
    const rgba = new Uint8ClampedArray([129, 244, 64, 255, 127, 255, 0, 0]);
    // 129·256 + 244 + 0.25 − 32768 = 500.25; 127·256 + 255 − 32768 = −1
    expect(Array.from(decodeTerrarium(rgba, 4))).toEqual([500.25, -1]);
  });

  it('decodes a Terrarium PNG and rejects other sizes', () => {
    const data = new Uint8Array(256 * 256 * 3);
    for (let i = 0; i < 256 * 256; i++) {
      data[3 * i] = 128 + (i % 7); // 0 … 1536 m
      data[3 * i + 1] = i % 256;
      data[3 * i + 2] = (i * 13) % 256;
    }
    const png = encode({ width: 256, height: 256, data, channels: 3, depth: 8 });
    expect(Array.from(decodeTerrariumPng(png))).toEqual(Array.from(decodeTerrarium(data, 3)));
    const small = encode({ width: 2, height: 2, data: new Uint8Array(12), channels: 3, depth: 8 });
    expect(() => decodeTerrariumPng(small)).toThrow(/Unexpected Terrarium tile format/);
  });
});

describe('createTileSampler', () => {
  // Heights affine in the global pixel index → bilinear interpolation must reproduce the plane exactly.
  // Multiples of 0.25 up to a few hundred are exact in Float32.
  const z = 10;
  const x0 = 534;
  const y0 = 361;
  const plane = (gi: number, gj: number): number => 0.5 * (gi - x0 * 256) - 0.25 * (gj - y0 * 256) + 1000;
  const planeTile = (x: number, y: number): TerrainTile => {
    const heights = new Float32Array(256 * 256);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) heights[j * 256 + i] = plane(x * 256 + i, y * 256 + j);
    return { z, x, y, heights };
  };
  const constTile = (tz: number, x: number, y: number, h: number): TerrainTile => ({
    z: tz,
    x,
    y,
    heights: new Float32Array(256 * 256).fill(h),
  });

  it('interpolates bilinearly between pixel centres, across tile seams', () => {
    const sampler = createTileSampler([planeTile(x0, y0), planeTile(x0 + 1, y0)]);
    const cases: { tx: number; px: number; py: number; loaded: boolean }[] = [
      { tx: x0, px: 100.3, py: 57.8, loaded: true },
      { tx: x0, px: 255.7, py: 128.1, loaded: true }, // last column of x0 + first column of x0 + 1
      { tx: x0 + 1, px: 0.2, py: 200.9, loaded: true }, // same seam from the other side
      { tx: x0 + 1, px: 140.6, py: 3.3, loaded: true },
      { tx: x0, px: 0.2, py: 100, loaded: false }, // needs tile x0 − 1
      { tx: x0 + 1, px: 255.9, py: 100, loaded: false }, // needs tile x0 + 2
    ];
    for (const c of cases) {
      const { lon, lat } = tilePixelToLonLat(c.tx, y0, c.px, c.py, z);
      const h = sampler(lat, lon);
      if (!c.loaded) {
        expect(h).toBeNull();
        continue;
      }
      const w = osmWorldPixel(lon, lat, z);
      expect(h).not.toBeNull();
      expect(h as number).toBeCloseTo(plane(w.x - 0.5, w.y - 0.5), 6); // pixel i holds the value at i + 0.5
    }
  });

  it('prefers the highest loaded zoom and falls back at missing neighbours', () => {
    // z12 tile (2139, 1446) lies inside z10 tile (534, 361): 2139 >> 2 = 534, 1446 >> 2 = 361.
    const sampler = createTileSampler([constTile(10, 534, 361, 50), constTile(12, 2139, 1446, 100)]);
    const inner = tilePixelToLonLat(2139, 1446, 128, 128, 12);
    expect(sampler(inner.lat, inner.lon)).toBe(100);
    const edge = tilePixelToLonLat(2139, 1446, 0.2, 128, 12); // bilinear needs tile 2138 → z10
    expect(sampler(edge.lat, edge.lon)).toBe(50);
    const outer = tilePixelToLonLat(534, 361, 10, 10, 10);
    expect(sampler(outer.lat, outer.lon)).toBe(50);
    const none = tilePixelToLonLat(600, 361, 128, 128, 10);
    expect(sampler(none.lat, none.lon)).toBeNull();
  });
});

describe('antimeridian', () => {
  const constTile = (x: number, h: number): TerrainTile => ({
    z: 4,
    x,
    y: 7,
    heights: new Float32Array(65536).fill(h),
  });

  it('samples across ±180° (tiles x = 15 and x = 0 at z4)', () => {
    const sampler = createTileSampler([constTile(0, 7), constTile(15, 9)]);
    const lat = tilePixelToLonLat(0, 7, 0, 128, 4).lat;
    // lon ±180 → world pixel −0.5: halfway between the last pixel of tile 15 (9) and the first of tile 0 (7).
    expect(sampler(lat, 180)).toBe(8);
    expect(sampler(lat, -180)).toBe(8);
    expect(sampler(lat, 180.3)).toBe(7); // wraps to −179.7
    expect(sampler(lat, -179.7)).toBe(7);
    expect(sampler(lat, 179.7)).toBe(9);
    const missing = tilePixelToLonLat(1, 7, 128, 128, 4);
    expect(sampler(missing.lat, missing.lon)).toBeNull();
  });

  it('plans wrapped tiles for a site next to the antimeridian', () => {
    const plan = planTerrainTiles(-17.5, 179.99, { maxDistanceM: 20_000 }); // 1.06 km from ±180°
    const xs = plan.filter((t) => t.z === 12).map((t) => t.x);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(4095);
  });
});

describe('horizonSampleDistances', () => {
  it('starts at min, ends at max, step max(15 m, 0.8 % of d)', () => {
    const d = horizonSampleDistances(100, 50_000);
    expect(d[0]).toBe(100);
    expect(d[d.length - 1]).toBe(50_000);
    for (let i = 1; i < d.length - 1; i++) {
      expect(d[i] - d[i - 1]).toBeCloseTo(Math.max(15, d[i - 1] * 0.008), 9);
    }
    expect(d[d.length - 1] - d[d.length - 2]).toBeGreaterThan(0);
    expect(d.length).toBeLessThan(700);
  });
});

describe('computeHorizon', () => {
  it('flat terrain: raw horizon = max of −(h/d + d(1−k)/(2R)), clamped to 0 by default', () => {
    const flat: ElevationSampler = () => 500;
    const h = 10;
    const raw = computeHorizon(flat, { ...SITE, observerHeight: h }, { minElevationDeg: -90 });
    // d/dd [h/d + d(1−k)/(2R)] = 0 → d* = √(2Rh/(1−k)) (≈ 12.1 km, inside the 50 km ray); value −2√(h(1−k)/(2R)).
    const expected = Math.atan(-2 * Math.sqrt((h * (1 - REFRACTION_K)) / (2 * EARTH_RADIUS_M))) / RAD;
    expect(raw.profile.elevations).toHaveLength(360);
    expect(raw.siteElevation).toBe(500);
    for (const e of raw.profile.elevations) {
      expect(e).toBeLessThanOrEqual(expected + 1e-12); // samples cannot beat the continuous optimum
      expect(e).toBeCloseTo(expected, 5);
    }
    const clamped = computeHorizon(flat, { ...SITE, observerHeight: h });
    expect(clamped.profile.elevations.every((e) => e === 0)).toBe(true);
  });

  it('cone mountain east of the site: elevation of the apex incl. curvature, at azimuth 90°', () => {
    const base = 500;
    const H = 1500;
    const rc = 1000; // flank slope 1.5 > tan(elevation) → the apex is the maximum along the ray
    const obs = 5;
    const D = horizonSampleDistances().find((d) => d >= 3000) as number; // apex exactly on a ray sample
    const apex = destination(SITE.latitude, SITE.longitude, 90, D);
    const r = computeHorizon(coneSampler(base, apex, H, rc), { ...SITE, observerHeight: obs });
    const e = r.profile.elevations;
    const expected = Math.atan((H - drop(D) - obs) / D) / RAD;
    expect(e[90]).toBeCloseTo(expected, 6);
    expect(Math.max(...e)).toBe(e[90]);
    // The cone subtends ±asin(rc/D) ≈ ±19.4°: flat (→ 0) outside, positive inside.
    expect(e[90 + 25]).toBe(0);
    expect(e[90 - 25]).toBe(0);
    expect(e[270]).toBe(0);
    expect(e[100]).toBeGreaterThan(0);
    expect(e[80]).toBeGreaterThan(0);
  });

  it('distant peak: earth curvature and refraction lower it by d²/(2R)·(1 − k)', () => {
    const base = 400;
    const H = 2000;
    const rc = 5000; // slope 0.4 ≫ tan(elevation) ≈ 0.05
    const D = horizonSampleDistances().find((d) => d >= 40_000) as number;
    const apex = destination(SITE.latitude, SITE.longitude, 200, D);
    const r = computeHorizon(coneSampler(base, apex, H, rc), { ...SITE, observerHeight: 0 }, { stepDeg: 5 });
    // drop(40 km) ≈ 109 m → ≈ 0.16° lower than on a flat earth.
    expect(r.profile.elevations[40]).toBeCloseTo(Math.atan((H - drop(D)) / D) / RAD, 6);
  });

  it('uses the given site elevation instead of the DEM value', () => {
    const D = horizonSampleDistances().find((d) => d >= 3000) as number;
    const apex = destination(SITE.latitude, SITE.longitude, 180, D);
    const r = computeHorizon(coneSampler(500, apex, 1500, 1000), { ...SITE, observerHeight: 2, elevation: 800 });
    expect(r.siteElevation).toBe(800);
    // Observer at 802 m (above the 500 m plain → plain contributes < 0), apex at 2000 m.
    expect(r.profile.elevations[180]).toBeCloseTo(Math.atan((2000 - drop(D) - 802) / D) / RAD, 6);
    expect(r.profile.elevations[0]).toBe(0);
  });

  it('adjusts the azimuth step so the profile closes', () => {
    const flat: ElevationSampler = () => 0;
    expect(computeHorizon(flat, { ...SITE, observerHeight: 0 }, { stepDeg: 7.5 }).profile.elevations).toHaveLength(48);
    const p = computeHorizon(flat, { ...SITE, observerHeight: 0 }, { stepDeg: 0.7 }).profile;
    expect(p.elevations).toHaveLength(514); // round(360 / 0.7)
    expect(p.stepDeg).toBeCloseTo(360 / 514, 12);
    expect(() => computeHorizon(flat, { ...SITE, observerHeight: 0 }, { stepDeg: 0 })).toThrow(RangeError);
  });

  it('skips samples without data and throws without a site elevation', () => {
    const onlySite: ElevationSampler = (lat, lon) => (lat === SITE.latitude && lon === SITE.longitude ? 700 : null);
    const r = computeHorizon(onlySite, { ...SITE, observerHeight: 0 }, { minElevationDeg: -3 });
    expect(r.profile.elevations.every((e) => e === -3)).toBe(true);
    expect(() => computeHorizon(() => null, { ...SITE, observerHeight: 0 })).toThrow(/No elevation data/);
  });
});

describe('planTerrainTiles', () => {
  it('covers every ray sample (incl. bilinear neighbours) at the zoom of its band', () => {
    const plan = planTerrainTiles(SITE.latitude, SITE.longitude);
    expect(new Set(plan.map((t) => `${t.z}/${t.x}/${t.y}`)).size).toBe(plan.length);
    expect(plan.length).toBeLessThan(40);
    const site12 = lonLatToTilePixel(SITE.longitude, SITE.latitude, 12);
    expect(plan).toContainEqual({ z: 12, x: site12.tileX, y: site12.tileY });
    // Tile value = its zoom → the sampler reports which band served each sample.
    const sampler = createTileSampler(plan.map((t) => ({ ...t, heights: new Float32Array(65536).fill(t.z) })));
    const distances = horizonSampleDistances();
    let checked = 0;
    let nulls = 0;
    let coarser = 0; // served by a lower zoom than the band of its distance
    for (let az = 0; az < 360; az += 7) {
      for (const d of distances) {
        const p = destination(SITE.latitude, SITE.longitude, az, d);
        const h = sampler(p.lat, p.lon);
        checked++;
        if (h === null) nulls++;
        else if ((d <= 5_000 && h < 12) || (d <= 20_000 && h < 10)) coarser++;
      }
    }
    expect(checked).toBeGreaterThan(10_000);
    expect(nulls).toBe(0);
    expect(coarser).toBe(0);
  });
});

// ── fetchTerrainHorizon with a mocked fetch ──

/** 256×256 Terrarium PNG of constant height: 500 m + 32768 = 33268 = 129·256 + 244 → RGB (129, 244, 0). */
function flatPng(): Uint8Array {
  const data = new Uint8Array(256 * 256 * 3);
  for (let i = 0; i < 256 * 256; i++) {
    data[3 * i] = 129;
    data[3 * i + 1] = 244;
  }
  return encode({ width: 256, height: 256, data, channels: 3, depth: 8 });
}

function mockFetch(png: Uint8Array, opts: { delayMs?: number; fail?: (url: string) => boolean } = {}) {
  const calls: string[] = [];
  let inFlight = 0;
  const state = { maxInFlight: 0 };
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, inFlight);
    try {
      await new Promise<void>((resolve, reject) => {
        const signal = init?.signal;
        const timer = setTimeout(resolve, opts.delayMs ?? 1);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        });
      });
      const ok = !opts.fail?.(url);
      const body = ok ? png.slice().buffer : new ArrayBuffer(0);
      return { ok, status: ok ? 200 : 404, arrayBuffer: async () => body } as unknown as Response;
    } finally {
      inFlight--;
    }
  };
  return { impl: impl as typeof fetch, calls, state };
}

describe('fetchTerrainHorizon', () => {
  const png = flatPng();
  const total = planTerrainTiles(SITE.latitude, SITE.longitude).length;

  beforeEach(() => {
    clearTerrainTileCache();
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads the planned tiles with limited concurrency and reports progress', async () => {
    const f = mockFetch(png, { delayMs: 3 });
    const progress: [number, number][] = [];
    const r = await fetchTerrainHorizon(SITE.latitude, SITE.longitude, {
      fetchImpl: f.impl,
      onProgress: (done, tot) => progress.push([done, tot]),
    });
    expect(r.tiles).toBe(total);
    expect(r.siteElevation).toBe(500);
    expect(r.profile.elevations).toHaveLength(360);
    expect(r.profile.elevations.every((e) => e === 0)).toBe(true);
    expect(f.calls).toHaveLength(total);
    expect(new Set(f.calls).size).toBe(total);
    expect(
      f.calls.every((u) =>
        /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/\d+\/\d+\/\d+\.png$/.test(u),
      ),
    ).toBe(true);
    expect(f.state.maxInFlight).toBeLessThanOrEqual(TILE_CONCURRENCY);
    expect(f.state.maxInFlight).toBeGreaterThan(1);
    expect(progress[0]).toEqual([0, total]);
    expect(progress[progress.length - 1]).toEqual([total, total]);
    expect(progress.map((p) => p[0])).toEqual([...Array(total + 1).keys()]);
  });

  it('reuses in-memory tiles and the localStorage result', async () => {
    const f = mockFetch(png);
    const first = await fetchTerrainHorizon(SITE.latitude, SITE.longitude, { fetchImpl: f.impl });
    expect(f.calls).toHaveLength(total);
    // Same tiles from memory (result cache bypassed): no new downloads.
    await fetchTerrainHorizon(SITE.latitude, SITE.longitude, { fetchImpl: f.impl, cache: false, observerHeight: 20 });
    expect(f.calls).toHaveLength(total);
    // Result from localStorage even without tiles in memory.
    clearTerrainTileCache();
    const progress: [number, number][] = [];
    const second = await fetchTerrainHorizon(SITE.latitude, SITE.longitude, {
      fetchImpl: f.impl,
      onProgress: (d, t) => progress.push([d, t]),
    });
    expect(f.calls).toHaveLength(total);
    expect(second).toEqual(first);
    expect(progress).toEqual([[total, total]]);
    // A corrupt entry is ignored.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('ssa.terrain')) localStorage.setItem(k, '{"e":[1,2]');
    }
    await fetchTerrainHorizon(SITE.latitude, SITE.longitude, { fetchImpl: f.impl });
    expect(f.calls).toHaveLength(2 * total);
  });

  it('works without localStorage (missing or throwing)', async () => {
    vi.stubGlobal('localStorage', undefined);
    const f = mockFetch(png);
    const r = await fetchTerrainHorizon(SITE.latitude, SITE.longitude, { fetchImpl: f.impl });
    expect(r.tiles).toBe(total);
    vi.unstubAllGlobals();
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      const r2 = await fetchTerrainHorizon(SITE.latitude, SITE.longitude, { fetchImpl: f.impl });
      expect(r2.siteElevation).toBe(500);
    } finally {
      if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  it('rejects with AbortError when aborted before or during the downloads', async () => {
    const f = mockFetch(png, { delayMs: 5 });
    const pre = new AbortController();
    pre.abort();
    await expect(
      fetchTerrainHorizon(SITE.latitude, SITE.longitude, { fetchImpl: f.impl, signal: pre.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(f.calls).toHaveLength(0);

    const ctrl = new AbortController();
    const run = fetchTerrainHorizon(SITE.latitude, SITE.longitude, {
      fetchImpl: f.impl,
      signal: ctrl.signal,
      onProgress: (done) => {
        if (done === 2) ctrl.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.calls.length).toBeLessThan(total);

    // Aborted downloads are not cached as failures: a fresh call completes.
    const r = await fetchTerrainHorizon(SITE.latitude, SITE.longitude, { fetchImpl: f.impl });
    expect(r.tiles).toBe(total);
  });

  it('rejects on a failed tile and does not cache the failure', async () => {
    const plan = planTerrainTiles(SITE.latitude, SITE.longitude);
    const badUrl = tileUrl(plan[plan.length - 1]);
    const bad = mockFetch(png, { fail: (u) => u === badUrl });
    await expect(fetchTerrainHorizon(SITE.latitude, SITE.longitude, { fetchImpl: bad.impl })).rejects.toThrow(
      /HTTP 404/,
    );
    const good = mockFetch(png);
    const r = await fetchTerrainHorizon(SITE.latitude, SITE.longitude, { fetchImpl: good.impl });
    expect(r.siteElevation).toBe(500);
    expect(good.calls).toContain(badUrl);
  });

  it('does not serve the cached result of a nearby location (regression: key was rounded to 0.001°)', async () => {
    // Height = 256 m + pixel row (R = 129 → 129·256 − 32768 = 256, G = row): the site elevation depends on the
    // location. p1/p2 are 0.0008° (≈ 89 m ≈ 3.4 z12 rows) apart but both round to 47.100/7.450 at 3 decimals —
    // in Alpine valleys such a shift changes the horizon by degrees (Lauterbrunnen: 3.3° RMS, 8.2° max).
    const data = new Uint8Array(256 * 256 * 3);
    for (let i = 0; i < 256 * 256; i++) {
      data[3 * i] = 129;
      data[3 * i + 1] = Math.floor(i / 256);
    }
    const f = mockFetch(encode({ width: 256, height: 256, data, channels: 3, depth: 8 }));
    const p1 = { lat: 47.1004, lon: 7.4504 };
    const p2 = { lat: 47.0996, lon: 7.4496 };
    const first = await fetchTerrainHorizon(p1.lat, p1.lon, { fetchImpl: f.impl });
    const second = await fetchTerrainHorizon(p2.lat, p2.lon, { fetchImpl: f.impl });
    const fresh = await fetchTerrainHorizon(p2.lat, p2.lon, { fetchImpl: f.impl, cache: false });
    expect(first.siteElevation).not.toBe(fresh.siteElevation); // the test can tell the two locations apart
    expect(second.siteElevation).toBe(fresh.siteElevation);
    expect(second.profile).toEqual(fresh.profile);
  });

  it('rejects promptly when aborted while waiting for a download shared with another call', async () => {
    // Downloads finish only when released; a second call for the same site awaits the first call's downloads.
    const release: (() => void)[] = [];
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      await new Promise<void>((resolve, reject) => {
        release.push(resolve);
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
      return { ok: true, status: 200, arrayBuffer: async () => png.slice().buffer } as unknown as Response;
    }) as typeof fetch;
    const a = fetchTerrainHorizon(SITE.latitude, SITE.longitude, { fetchImpl: impl, cache: false });
    let aSettled = false;
    a.then(
      () => (aSettled = true),
      () => (aSettled = true),
    );
    const ctrl = new AbortController();
    const b = fetchTerrainHorizon(SITE.latitude, SITE.longitude, {
      fetchImpl: impl,
      cache: false,
      signal: ctrl.signal,
    });
    ctrl.abort();
    const outcome = await Promise.race([
      b.then(
        () => 'resolved',
        (e: unknown) => e,
      ),
      new Promise((resolve) => setTimeout(() => resolve('still pending'), 200)),
    ]);
    expect(outcome).toMatchObject({ name: 'AbortError' });
    expect(aSettled).toBe(false); // the other call's downloads were not cancelled …
    for (let i = 0; i < 1000 && !aSettled; i++) {
      release.splice(0).forEach((r) => r());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect((await a).tiles).toBe(total); // … and complete normally
  });

  it('rejects invalid coordinates', async () => {
    await expect(fetchTerrainHorizon(Number.NaN, 7)).rejects.toThrow(RangeError);
    await expect(fetchTerrainHorizon(89, 7)).rejects.toThrow(RangeError);
  });
});
