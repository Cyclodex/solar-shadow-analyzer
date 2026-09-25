import { afterEach, describe, expect, it } from 'vitest';
import { fakeFetch, syntheticSwisstopo, type SurfaceFn, type SyntheticWorld } from '../test/cogFixture';
import {
  DSM_RAY_STEP_M,
  circleCoverage,
  clearDsmCaches,
  computeDsmJob,
  dilateMask,
  estimateDsmBytes,
  fillPolygon,
  fillPolygonBuffered,
  gridAround,
  marchDsmHorizons,
  newestPerTile,
  parseStacItems,
  type DsmJobResult,
  type DsmSite,
  type MarchGeometry,
  type Raster,
} from './dsm';
import { enuToFacade, enuToLonLat, lonLatToEnu } from './enu';
import { horizonAt } from './horizon';
import { lv95LocalFrame, lv95ToWgs84, wgs84ToLv95 } from './lv95';
import { ownExclusionZone, type OwnExclusionZone } from './surroundings';
import type { HorizonProfile } from './types';

const deg = (rad: number): number => (rad * 180) / Math.PI;
const atanDeg = (rise: number, run: number): number => deg(Math.atan2(rise, run));
const GROUND = 500;
/** No own-building exclusion at all. */
const NO_ZONE: OwnExclusionZone = { behindN: -Infinity, balconyN: -Infinity, u0: 0, u1: 0 };
const FAST = { retries: 2, baseDelayMs: 0, jitterMs: 0, sleep: async () => undefined };

/** A site given in LV95, with its local frames. */
function siteAt(east: number, north: number, facadeAzimuth: number) {
  const g = lv95ToWgs84(east, north);
  const frame = lv95LocalFrame(g);
  /** Facade-frame [u, n] of an LV95 point (site = origin). */
  const facade = (E: number, N: number): [number, number] => enuToFacade(frame.toEnu(E, N), facadeAzimuth);
  return { ...g, frame, facade, facadeAzimuth };
}

type Site = ReturnType<typeof siteAt>;

/** A raster around the site filled from a surface in facade coordinates (u, n) → height above GROUND. */
function rasterOf(site: Site, half: number, surface: (u: number, n: number) => number): Raster {
  const g = gridAround(wgs84ToLv95(site.latitude, site.longitude), half, 0.5);
  const data = new Float32Array(g.width * g.height);
  for (let j = 0; j < g.height; j++) {
    for (let i = 0; i < g.width; i++) {
      const [u, n] = site.facade(g.x0 + (i + 0.5) * 0.5, g.y1 - (j + 0.5) * 0.5);
      data[j * g.width + i] = GROUND + surface(u, n);
    }
  }
  return { ...g, data };
}

function geometry(site: Site, radius: number, zone: OwnExclusionZone): MarchGeometry {
  return { toLv95: site.frame.toLv95, facadeAzimuth: site.facadeAzimuth, ground: GROUND, radius, zone };
}

describe('STAC items', () => {
  const item = (id: string, suffix = '_0.5_2056_5728.tif') => ({
    id,
    assets: {
      [`${id}${suffix}`]: { href: `https://h/${id}${suffix}` },
      [`${id}${suffix}.xyz.zip`]: { href: `https://h/${id}.zip` },
    },
  });

  it('reads tile key, year and COG href; the next page link', () => {
    const page = {
      features: [
        item('swisssurface3d-raster_2019_2683-1247'),
        item('swisssurface3d-raster_2024_2683-1247'),
        { id: 'x' },
      ],
      links: [
        { rel: 'self', href: 'https://h/self' },
        { rel: 'next', href: 'https://h/next?cursor=abc' },
      ],
    };
    const { tiles, next } = parseStacItems(page, '_0.5_2056_5728.tif');
    expect(tiles).toEqual([
      {
        key: '2683-1247',
        east: 2683000,
        north: 1247000,
        year: 2019,
        href: 'https://h/swisssurface3d-raster_2019_2683-1247_0.5_2056_5728.tif',
      },
      {
        key: '2683-1247',
        east: 2683000,
        north: 1247000,
        year: 2024,
        href: 'https://h/swisssurface3d-raster_2024_2683-1247_0.5_2056_5728.tif',
      },
    ]);
    expect(next).toBe('https://h/next?cursor=abc');
    expect(
      parseStacItems(
        { features: [item('swissalti3d_2025_2601-1200', '_2_2056_5728.tif')] },
        '_0.5_2056_5728.tif',
      ).tiles,
    ).toEqual([]);
    expect(parseStacItems(null, '.tif')).toEqual({ tiles: [], next: null });
  });

  it('keeps the newest year of every tile', () => {
    const t = (key: string, year: number) => ({ key, east: 0, north: 0, year, href: `${key}/${year}` });
    expect(
      newestPerTile([t('b', 2024), t('a', 2019), t('a', 2025), t('b', 2017)]).map((x) => x.href),
    ).toEqual(['a/2025', 'b/2024']);
  });
});

describe('grid helpers', () => {
  it('gridAround covers the square on the cell lattice', () => {
    const g = gridAround({ east: 2600000.3, north: 1200000.8 }, 10, 0.5);
    // x 2599990.0 … 2600010.5 (41 cells), y 1199990.5 … 1200011.0 (41 cells)
    expect(g).toEqual({ x0: 2599990, y1: 1200011, cell: 0.5, width: 41, height: 41 });
  });

  it('fillPolygon: cells whose centre is inside, holes left out; buffers and dilation', () => {
    const g = { x0: 0, y1: 10, cell: 1, width: 10, height: 10 };
    const mask = new Uint8Array(100);
    const outer: [number, number][] = [
      [1, 1],
      [9, 1],
      [9, 9],
      [1, 9],
    ];
    const hole: [number, number][] = [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
    ];
    fillPolygon(g, [outer, hole], mask, 1);
    expect(mask.reduce((a, b) => a + b, 0)).toBe(64 - 4);
    expect(mask[5 * 10 + 5]).toBe(0); // centre (5.5, 4.5) in the hole
    const buffered = new Uint8Array(100);
    fillPolygonBuffered(g, hole, 1, buffered, 1);
    // Centres within 1 m of the 2 × 2 m square: 4 inside + 8 beside the edges (corners are √0.5 away: also in).
    expect(buffered.reduce((a, b) => a + b, 0)).toBe(16);
    const dot = new Uint8Array(100);
    dot[5 * 10 + 5] = 1;
    dilateMask(g, dot, 1);
    expect(dot.reduce((a, b) => a + b, 0)).toBe(5); // the cell and its 4 neighbours
  });

  it('circleCoverage counts cells with data inside the circle', () => {
    const g = gridAround({ east: 0, north: 0 }, 10, 0.5);
    const data = new Float32Array(g.width * g.height).fill(1);
    for (let j = 0; j < g.height; j++) for (let i = 0; i < g.width / 2; i++) data[j * g.width + i] = NaN;
    expect(circleCoverage({ ...g, data }, { east: 0, north: 0 }, 10)).toBeCloseTo(0.5, 2);
  });
});

describe('marchDsmHorizons', () => {
  const site = siteAt(2600480.3, 1200520.7, 180);

  it('a wall of height h at distance d gives atan(h / d), also obliquely (d / cos α)', () => {
    // Wall 10 m high, 1 m thick, from n = 21 m, across u = ±60 m; observer at n = 1 m, 0 and 4 m above ground.
    const raster = rasterOf(site, 70, (u, n) => (n >= 21 && n < 22 && Math.abs(u) < 60 ? 10 : 0));
    const [low, high] = marchDsmHorizons(raster, geometry(site, 60, NO_ZONE), { n: 1, heights: [0, 4] });
    expect(low.stepDeg).toBe(0.5);
    expect(low.elevations).toHaveLength(720);
    for (const [profile, rise] of [
      [low, 10],
      [high, 6],
    ] as [HorizonProfile, number][]) {
      for (const alpha of [0, 20, 40]) {
        const d = 20 / Math.cos((alpha * Math.PI) / 180);
        const got = horizonAt(profile, 180 + alpha);
        // Cells are 0.5 m, samples 0.25 m apart: the wall face is found within one cell diagonal.
        expect(got).toBeLessThanOrEqual(atanDeg(rise, d - 0.71) + 1e-9);
        expect(got).toBeGreaterThanOrEqual(atanDeg(rise, d + 0.71));
      }
      // Behind the observer (north), flat ground below the observer: 0°.
      expect(horizonAt(profile, 0)).toBe(0);
    }
    expect(horizonAt(low, 180)).toBeCloseTo(atanDeg(10, 20), 0);
  });

  it('excludes the own building and balconies, keeps neighbours beyond the own extent', () => {
    // Own house: 30 m tall behind the facade (n < 0) and balcony slabs 3 m above the observer up to n = 1.9 m
    // along u = ±6 m; a neighbour's balcony at u = 9…12 m (east of this south facade), n = 0.5…2 m, as high.
    const zone = ownExclusionZone(1.5, 4, [
      [-7, -12],
      [7, -12],
      [7, 0],
      [-7, 0],
    ]);
    expect(zone).toEqual({ behindN: 0.5, balconyN: 2, u0: -7, u1: 7 });
    const raster = rasterOf(site, 40, (u, n) => {
      if (n < 0 && Math.abs(u) < 7) return 30;
      if (n >= 0.5 && n < 1.9 && Math.abs(u) < 6) return 8;
      if (n >= 0.5 && n < 2 && u >= 9 && u < 12) return 8;
      return 0;
    });
    const [own] = marchDsmHorizons(raster, geometry(site, 30, zone), { n: 1.2, heights: [5] });
    const [all] = marchDsmHorizons(raster, geometry(site, 30, NO_ZONE), { n: 1.2, heights: [5] });
    // Behind the facade: nothing; straight out: nothing (own balcony skipped).
    expect(horizonAt(own, 0)).toBe(0);
    expect(horizonAt(own, 180)).toBe(0);
    expect(horizonAt(all, 0)).toBeGreaterThan(80);
    // The neighbour balcony along the facade to the east (u > 0 for a south facade: azimuth ≈ 90°).
    const east = Math.max(...[88, 90, 92, 95].map((a) => horizonAt(own, a)));
    expect(east).toBeGreaterThan(atanDeg(3, 12));
    // Own balcony slabs along the facade to the west (u < 0) are skipped.
    expect(horizonAt(own, 268)).toBe(0);
  });

  it('keeps the bin maximum: between brute forces over cell centres and cell areas, unlike one ray per bin', () => {
    // Poles (one cell) and small tree crowns 30–145 m away, blocks nearer; observer 3 m above the ground.
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const radius = 150;
    const raster = rasterOf(site, radius + 5, () => 0);
    const stamp = (u0: number, u1: number, n0: number, n1: number, h: number, round = false): void => {
      const corners = [
        [u0, n0],
        [u1, n0],
        [u0, n1],
        [u1, n1],
      ].map(([u, n]) => site.frame.toLv95(u, -n)); // south facade: east = u, north = −n
      const xs = corners.map((c) => c.east);
      const ys = corners.map((c) => c.north);
      for (
        let j = Math.floor((raster.y1 - Math.max(...ys)) / 0.5);
        j <= (raster.y1 - Math.min(...ys)) / 0.5;
        j++
      ) {
        for (
          let i = Math.floor((Math.min(...xs) - raster.x0) / 0.5);
          i <= (Math.max(...xs) - raster.x0) / 0.5;
          i++
        ) {
          if (i < 0 || j < 0 || i >= raster.width || j >= raster.height) continue;
          const [u, n] = site.facade(raster.x0 + (i + 0.5) * 0.5, raster.y1 - (j + 0.5) * 0.5);
          const inside = round
            ? Math.hypot(u - (u0 + u1) / 2, n - (n0 + n1) / 2) < (u1 - u0) / 2
            : u >= u0 && u < u1 && n >= n0 && n < n1;
          const k = j * raster.width + i;
          if (inside) raster.data[k] = Math.max(raster.data[k], GROUND + h);
        }
      }
    };
    const polar = (dMin: number, dMax: number): [number, number] => {
      const d = dMin + rnd() * (dMax - dMin);
      const a = (rnd() - 0.5) * Math.PI * 0.9;
      return [d * Math.sin(a), 1 + d * Math.cos(a)];
    };
    for (let k = 0; k < 200; k++) {
      const [u, n] = polar(30, 145);
      stamp(u - 0.25, u + 0.25, n - 0.25, n + 0.25, 8 + rnd() * 20); // pole
    }
    for (let k = 0; k < 40; k++) {
      const [u, n] = polar(30, 145);
      const r = 0.6 + rnd();
      stamp(u - r, u + r, n - r, n + r, 6 + rnd() * 14, true); // tree crown
    }
    for (let k = 0; k < 12; k++) {
      const [u, n] = polar(10, 60);
      stamp(u, u + 4 + rnd() * 12, n, n + 4 + rnd() * 10, 5 + rnd() * 15); // block
    }
    const geo = geometry(site, radius, NO_ZONE);
    const observer = { n: 1, heights: [3] };
    const [march] = marchDsmHorizons(raster, geo, observer);
    const [single] = marchDsmHorizons(raster, geo, observer, { subRays: 1 });
    // Brute forces over every cell within the radius (observer: 1 m south of the site, 3 m up):
    // - centres: the cell counts in the bin (± 0.25°) of its centre's azimuth, at the centre's distance;
    // - areas: the cell counts in every bin its corners' azimuth span reaches, at its nearest corner's distance
    //   (what a ray through any part of the cell could at most see).
    const centre = new Array<number>(720).fill(0);
    const area = new Array<number>(720).fill(0);
    const obsE = 0;
    const obsN = -1;
    for (let j = 0; j < raster.height; j++) {
      for (let i = 0; i < raster.width; i++) {
        const rise = raster.data[j * raster.width + i] - GROUND - 3;
        if (rise <= 0) continue;
        const pts = [
          [0.5, 0.5],
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ].map(([a, b]) => {
          const [e, n] = site.frame.toEnu(raster.x0 + (i + a) * 0.5, raster.y1 - (j + b) * 0.5);
          return { d: Math.hypot(e - obsE, n - obsN), az: deg(Math.atan2(e - obsE, n - obsN)) };
        });
        const c = pts[0];
        if (c.d >= DSM_RAY_STEP_M && c.d <= radius) {
          const bin = Math.round((((c.az % 360) + 360) % 360) / 0.5) % 720;
          centre[bin] = Math.max(centre[bin], atanDeg(rise, c.d));
        }
        const dMin = Math.min(...pts.slice(1).map((p) => p.d));
        if (dMin > radius) continue;
        const rel = pts.slice(1).map((p) => ((p.az - c.az + 540) % 360) - 180);
        const lo = c.az + Math.min(...rel);
        const hi = c.az + Math.max(...rel);
        for (let b = Math.ceil((lo - 0.25) / 0.5); b <= Math.floor((hi + 0.25) / 0.5); b++) {
          const bin = ((b % 720) + 720) % 720;
          area[bin] = Math.max(area[bin], atanDeg(rise, Math.max(dMin, 1e-6)));
        }
      }
    }
    const count = (xs: number[], ref: number[], t: number): number =>
      xs.filter((v, i) => v < ref[i] - t).length;
    // Never above what any ray through the cells could see …
    expect(march.elevations.every((v, i) => v <= area[i] + 1e-9)).toBe(true);
    // … and not below the centre brute force except by the sampling distance (≤ ½ cell diagonal): one ray per
    // bin misses poles and crowns between the rays.
    // Measured on this scene: bin maximum 0 bins below (worst 0.00°), one ray per bin 9 bins (worst 15.9°).
    expect(count(march.elevations, centre, 0.5)).toBe(0);
    expect(Math.max(...march.elevations.map((v, i) => centre[i] - v))).toBeLessThan(0.5);
    expect(count(single.elevations, centre, 0.5)).toBeGreaterThanOrEqual(5);
    // Close to the upper bound: RMS 1.08° against 3.26° with one ray per bin.
    const rms = (xs: number[], ref: number[]): number =>
      Math.sqrt(xs.reduce((a, v, i) => a + (v - ref[i]) ** 2, 0) / xs.length);
    expect(rms(march.elevations, area)).toBeLessThan(1.5);
    expect(rms(march.elevations, area)).toBeLessThan(rms(single.elevations, area) / 2);
  });
});

// ── Pipeline with a synthetic swisstopo ──────

/** World: flat ground at GROUND, `extra` in facade coordinates of `site` (height above ground). */
function worldFor(site: Site, extra: (u: number, n: number) => number, years = [2023]): SyntheticWorld {
  const surface: SurfaceFn = (E, N) => {
    const [u, n] = site.facade(E, N);
    return GROUND + extra(u, n);
  };
  const c = wgs84ToLv95(site.latitude, site.longitude);
  const dsm: Record<number, SurfaceFn> = {};
  for (const y of years) dsm[y] = surface;
  return {
    dsm,
    dtm: () => GROUND,
    ground: GROUND,
    window: { x0: c.east - 60, y0: c.north - 60, x1: c.east + 60, y1: c.north + 60 },
  };
}

function dsmSite(site: Site, over: Partial<DsmSite> = {}): DsmSite {
  return {
    latitude: site.latitude,
    longitude: site.longitude,
    facadeAzimuth: site.facadeAzimuth,
    radius: 40,
    trees: true,
    masks: null,
    exclusion: { balconyDepthM: 0, rowWidthM: 2, ownFootprint: null },
    ...over,
  };
}

function ok(r: DsmJobResult): Extract<DsmJobResult, { status: 'ok' }> {
  if (r.status !== 'ok') throw new Error(`job ${r.status}: ${r.status === 'error' ? r.error.message : ''}`);
  return r;
}

const wall = (u: number, n: number): number => (n >= 21 && n < 22 && Math.abs(u) < 30 ? 10 : 0);

/** The horizon at `az` is that of a face `rise` m higher at distance `d` (to within one cell diagonal). */
function expectFace(profile: HorizonProfile, az: number, rise: number, d: number): void {
  const got = horizonAt(profile, az);
  expect(got).toBeLessThanOrEqual(atanDeg(rise, d - 0.71) + 1e-9);
  expect(got).toBeGreaterThanOrEqual(atanDeg(rise, d + 0.71));
}

describe('computeDsmJob', () => {
  afterEach(clearDsmCaches);

  it('loads the scan window, computes every group, keeps the rasters for later observers', async () => {
    const site = siteAt(2600480.3, 1200520.7, 180);
    const { fetchImpl, requests } = fakeFetch(syntheticSwisstopo(worldFor(site, wall)));
    const progress: number[] = [];
    const r = ok(
      await computeDsmJob(
        { site: dsmSite(site), groups: [{ n: 1, heights: [0, 4] }] },
        { fetchImpl, retry: FAST, onProgress: (p) => progress.push(p.fraction) },
      ),
    );
    expectFace(r.horizons[0][0], 180, 10, 20);
    expectFace(r.horizons[0][1], 180, 6, 20);
    expect(r.info).toMatchObject({
      dataYears: [2023],
      coverage: 1,
      ground: GROUND,
      groundSource: 'height-service',
      files: 1,
    });
    expect(r.info.bytes).toBeGreaterThan(0);
    expect(r.stats.requests).toBe(requests.length);
    // STAC, height, one header, the tiles: every COG request is a range.
    expect(requests.filter((q) => q.url.endsWith('.tif')).every((q) => q.range?.startsWith('bytes='))).toBe(
      true,
    );
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true);

    const before = requests.length;
    const again = ok(
      await computeDsmJob(
        { site: dsmSite(site), groups: [{ n: 2, heights: [7] }] },
        { fetchImpl, retry: FAST },
      ),
    );
    expect(requests.length).toBe(before); // everything from memory
    expect(again.stats.requests).toBe(0);
    expectFace(again.horizons[0][0], 180, 3, 19);
  });

  it('mosaics across files: no seam in a wall that crosses a km tile edge', async () => {
    // Site 0.3 m east of the edge between km tiles 2600 and 2601, wall across it.
    const site = siteAt(2601000.3, 1200520.2, 180);
    const { fetchImpl, requests } = fakeFetch(syntheticSwisstopo(worldFor(site, wall)));
    const r = ok(
      await computeDsmJob(
        { site: dsmSite(site), groups: [{ n: 1, heights: [0] }] },
        { fetchImpl, retry: FAST },
      ),
    );
    expect(r.info.files).toBe(2);
    expect(new Set(requests.filter((q) => q.url.endsWith('.tif')).map((q) => q.url)).size).toBe(2);
    for (let a = 160; a <= 200; a += 0.5) {
      const d = 20 / Math.cos(((a - 180) * Math.PI) / 180);
      expect(horizonAt(r.horizons[0][0], a)).toBeGreaterThan(atanDeg(10, d + 0.71));
    }
    expect(r.info.coverage).toBe(1);
  });

  it('uses the newest year per tile and follows STAC pages', async () => {
    const site = siteAt(2600480.3, 1200520.7, 180);
    const world = worldFor(site, wall, [2019, 2024]);
    world.dsm[2019] = () => GROUND; // the older scan has no wall
    world.pageSize = 1;
    const { fetchImpl, requests } = fakeFetch(syntheticSwisstopo(world));
    const r = ok(
      await computeDsmJob(
        { site: dsmSite(site), groups: [{ n: 1, heights: [0] }] },
        { fetchImpl, retry: FAST },
      ),
    );
    expect(r.info.dataYears).toEqual([2024]);
    expectFace(r.horizons[0][0], 180, 10, 20);
    expect(requests.filter((q) => q.url.includes('/items?')).length).toBe(2);
    expect(requests.some((q) => q.url.includes('_2019_'))).toBe(false);
  });

  it('masks removed buildings with the ground model (2 m); only then loads it', async () => {
    const site = siteAt(2600480.3, 1200520.7, 180);
    const { fetchImpl, requests } = fakeFetch(syntheticSwisstopo(worldFor(site, wall)));
    const plain = ok(
      await computeDsmJob(
        { site: dsmSite(site), groups: [{ n: 1, heights: [0] }] },
        { fetchImpl, retry: FAST },
      ),
    );
    expect(requests.some((q) => q.url.includes('swissalti3d'))).toBe(false);
    // The wall's footprint as a removed building, anchored 30 m east of the site (anchor ENU).
    const anchor = enuToLonLat(site, 30, 0);
    const corner = (u: number, n: number): [number, number] => {
      // facade (u, n) → site ENU → anchor ENU (south facade: east = u, north = −n).
      const ll = enuToLonLat(site, u, -n);
      return lonLatToEnu(anchor, ll.latitude, ll.longitude);
    };
    const footprint = [corner(-30, 21), corner(30, 21), corner(30, 22), corner(-30, 22)];
    const masked = ok(
      await computeDsmJob(
        {
          site: dsmSite(site, { masks: { anchor, polygons: [footprint] } }),
          groups: [{ n: 1, heights: [0] }],
        },
        { fetchImpl, retry: FAST },
      ),
    );
    expect(horizonAt(plain.horizons[0][0], 180)).toBeGreaterThan(25);
    expect(horizonAt(masked.horizons[0][0], 180)).toBe(0);
    expect(requests.some((q) => q.url.includes('swissalti3d') && q.url.endsWith('.tif'))).toBe(true);
    expect(masked.info.bytes).toBeGreaterThan(plain.info.bytes);
  });

  it('without trees keeps only building footprints, but everything outside CH/FL', async () => {
    const site = siteAt(2600480.3, 1200520.7, 180);
    // Building 12 m (south), tree crown 12 m (south-east, u > 0), and a building beyond the border
    // (south-west) that the vector tiles do not have.
    const extra = (u: number, n: number): number => {
      if (Math.abs(u) < 5 && n >= 20 && n < 30) return 12;
      if (Math.hypot(u - 15, n - 20) < 3) return 12;
      if (Math.abs(u + 20) < 4 && n >= 18 && n < 24) return 12;
      return 0;
    };
    const world = worldFor(site, extra);
    const lonLat = (u: number, n: number): [number, number] => {
      const ll = enuToLonLat(site, u, -n);
      return [ll.longitude, ll.latitude];
    };
    world.buildings = [
      {
        rings: [[lonLat(-5, 20), lonLat(5, 20), lonLat(5, 30), lonLat(-5, 30)]],
        props: { render_height: 12 },
      },
    ];
    // "Outside CH/FL": u < −14 (west of the site), n > 10.
    world.outside = [
      { rings: [[lonLat(-14, 10), lonLat(-40, 10), lonLat(-40, 40), lonLat(-14, 40)]], props: {} },
    ];
    const { fetchImpl, requests } = fakeFetch(syntheticSwisstopo(world));
    const r = ok(
      await computeDsmJob(
        { site: dsmSite(site, { trees: false }), groups: [{ n: 1, heights: [0] }] },
        { fetchImpl, retry: FAST },
      ),
    );
    const [h] = r.horizons[0];
    const treeAz = 180 - deg(Math.atan2(15, 19)); // u > 0 is east of a south facade
    const borderAz = 225;
    expect(horizonAt(h, 180)).toBeGreaterThan(atanDeg(12, 19.8)); // building kept
    expect(horizonAt(h, treeAz)).toBeLessThan(2); // tree removed
    expect(horizonAt(h, borderAz)).toBeGreaterThan(20); // beyond the border: scan kept
    expect(requests.some((q) => q.url.includes('vectortiles.geo.admin.ch'))).toBe(true);
    // The own footprint is unknown: the tiles have no part at the probe point, fallback extent.
    expect(r.status).toBe('ok');
  });

  it('is unavailable outside the scan (no STAC items, or outside its extent without a request)', async () => {
    const site = siteAt(2600480.3, 1200520.7, 180);
    const world = worldFor(site, wall);
    world.tiles = () => [];
    const { fetchImpl, requests } = fakeFetch(syntheticSwisstopo(world));
    expect(
      (await computeDsmJob({ site: dsmSite(site), groups: [] }, { fetchImpl, retry: FAST })).status,
    ).toBe('unavailable');
    const before = requests.length;
    const paris = { ...dsmSite(site), latitude: 48.8566, longitude: 2.3522 };
    expect((await computeDsmJob({ site: paris, groups: [] }, { fetchImpl })).status).toBe('unavailable');
    expect(requests.length).toBe(before);
  });

  it('falls back to the ground model when the height service fails', async () => {
    const site = siteAt(2600480.3, 1200520.7, 180);
    const world = worldFor(site, wall);
    world.ground = null;
    world.dtm = () => GROUND + 0.5;
    const { fetchImpl } = fakeFetch(syntheticSwisstopo(world));
    const r = ok(
      await computeDsmJob(
        { site: dsmSite(site), groups: [{ n: 1, heights: [0] }] },
        { fetchImpl, retry: FAST },
      ),
    );
    expect(r.info).toMatchObject({ groundSource: 'terrain-model', ground: GROUND + 0.5 });
    expectFace(r.horizons[0][0], 180, 9.5, 20);
  });

  it('returns typed errors: HTTP, network, aborted', async () => {
    const site = siteAt(2600480.3, 1200520.7, 180);
    const route = syntheticSwisstopo(worldFor(site, wall));
    const failing = fakeFetch((url, range) =>
      url.endsWith('.tif') && range !== 'bytes=0-16383' ? { status: 503, body: '' } : route(url, range),
    );
    const r = await computeDsmJob(
      { site: dsmSite(site), groups: [{ n: 1, heights: [0] }] },
      { fetchImpl: failing.fetchImpl, retry: FAST },
    );
    expect(r).toMatchObject({ status: 'error', error: { kind: 'http', status: 503 } });
    const tifRanges = failing.requests.filter((q) => q.url.endsWith('.tif') && q.range !== 'bytes=0-16383');
    expect(tifRanges.length).toBeGreaterThanOrEqual(3); // retried

    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const n = await computeDsmJob({ site: dsmSite(site), groups: [] }, { fetchImpl: offline, retry: FAST });
    expect(n).toMatchObject({ status: 'error', error: { kind: 'network' } });

    const ctrl = new AbortController();
    const { fetchImpl } = fakeFetch((url, range) => {
      if (url.endsWith('.tif')) ctrl.abort();
      return route(url, range);
    });
    const a = await computeDsmJob(
      { site: dsmSite(site), groups: [{ n: 1, heights: [0] }] },
      { fetchImpl, retry: FAST, signal: ctrl.signal },
    );
    expect(a).toMatchObject({ status: 'error', error: { kind: 'aborted' } });
  });
});

describe('estimateDsmBytes', () => {
  it('matches the research simulation of tiles per window (no margin: 4.84 / 11.56 / 25.00 tiles)', () => {
    // Research (2026-09-25): mean full-resolution tiles for a square window of 2 r at r = 150 / 300 / 500 m on
    // the real tile grid, × 543,487 B = 2.63 / 6.28 / 13.59 MB. The estimate adds the 8 m margin and headers.
    const mb = [150, 300, 500].map((r) => estimateDsmBytes(r) / 1e6);
    expect(mb[0]).toBeGreaterThan(2.63);
    expect(mb[0]).toBeLessThan(2.63 * 1.12);
    expect(mb[1]).toBeGreaterThan(6.28);
    expect(mb[1]).toBeLessThan(6.28 * 1.08);
    expect(mb[2]).toBeGreaterThan(13.59);
    expect(mb[2]).toBeLessThan(13.59 * 1.06);
    expect(estimateDsmBytes(300, { ground: true, vectorTiles: true })).toBeGreaterThan(estimateDsmBytes(300));
  });
});
