/**
 * Validates the DEM terrain horizon (src/model/terrain.ts) against PVGIS `printhorizon`.
 *
 *   npx tsx scripts/validate-terrain.ts [options]
 *
 *   --sites "lat,lon;lat,lon"  sites to check (default: the three reference sites below)
 *   --all                      add eight more Alpine / Plateau sites
 *   --ref-dir DIR              read/write PVGIS responses as DIR/pvgis_horizon_<lat>_<lon>.json
 *   --observer M               observer height above the DEM ground (default: app default)
 *   --reference                also compare with a z12-everywhere computation (~200 tiles per site)
 *   --offset-scan              fit one common location offset for all sites (explains PVGIS residuals)
 *   --georef                   check the DEM's georeferencing against Wikidata summit coordinates (CH ≥ 3500 m)
 *   --max-rms DEG              exit code 1 if any site's RMS vs. PVGIS exceeds DEG
 *
 * Needs network (AWS Terrarium tiles, PVGIS API). Behind an HTTP proxy, Node's built-in fetch needs
 * NODE_USE_ENV_PROXY=1 (Node ≥ 22.21). PVGIS sends no CORS headers, which is why the app computes the
 * horizon itself; this script is the cross-check.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_OBSERVER_HEIGHT_M,
  clearTerrainTileCache,
  computeHorizon,
  createTileSampler,
  decodeTerrariumPng,
  fetchTerrainHorizon,
  lonLatToTilePixel,
  planTerrainTiles,
  tilePixelToLonLat,
  tileUrl,
  type ElevationSampler,
  type ZoomBand,
} from '../src/model/terrain';
import { parsePvgisHorizon, pvgisHorizonUrl } from '../src/model/pvgis';
import type { HorizonProfile } from '../src/model/types';

// ── CLI ──────────────────────────────────────

const REFERENCE_SITES: [number, number, string][] = [
  [47.1, 7.45, 'Swiss Plateau (flat)'],
  [46.62, 8.04, 'Grindelwald (valley)'],
  [46.02, 7.75, 'Zermatt area'],
];
const MORE_SITES: [number, number, string][] = [
  [45.92, 6.87, 'Chamonix'],
  [46.0, 8.95, 'Lugano (lake shore)'],
  [46.23, 7.36, 'Sion (Rhone valley)'],
  [46.5, 11.35, 'Bolzano'],
  [46.8, 9.83, 'Davos'],
  [47.14, 9.52, 'Vaduz'],
  [47.27, 11.39, 'Innsbruck'],
  [47.37, 8.54, 'Zurich'],
];

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

let sites = REFERENCE_SITES;
const sitesArg = option('--sites');
if (sitesArg) {
  sites = sitesArg.split(';').map((s) => {
    const [lat, lon] = s.split(',').map(Number);
    return [lat, lon, `${lat}, ${lon}`];
  });
}
if (flag('--all')) sites = [...sites, ...MORE_SITES];
const refDir = option('--ref-dir');
const observerHeight = Number(option('--observer') ?? DEFAULT_OBSERVER_HEIGHT_M);
const maxRms = option('--max-rms') !== undefined ? Number(option('--max-rms')) : undefined;

// ── Networking with byte accounting ──────────

/** Tile bytes kept for the diagnostics, so each tile is downloaded once per run. */
const tileBytes = new Map<string, Uint8Array>();
const net = { requests: 0, bytes: 0 };

async function download(url: string, init?: RequestInit): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const b = new Uint8Array(await res.arrayBuffer());
      net.requests++;
      net.bytes += b.length;
      return b;
    } catch (e) {
      if (attempt >= 3 || init?.signal?.aborted) throw e;
    }
  }
}

/** fetch() stand-in for fetchTerrainHorizon: counts bytes, serves repeated tiles from memory. */
function countingFetch(counter: { tiles: number; bytes: number }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let b = tileBytes.get(url);
    if (!b) {
      b = await download(url, init);
      tileBytes.set(url, b);
    }
    counter.tiles++;
    counter.bytes += b.length;
    return new Response(b.slice());
  }) as typeof fetch;
}

async function loadSampler(lat: number, lon: number, bands?: readonly ZoomBand[], minDistanceM?: number) {
  const plan = planTerrainTiles(lat, lon, { bands, minDistanceM });
  const tiles = [];
  let bytes = 0;
  for (let i = 0; i < plan.length; i += 8) {
    const chunk = await Promise.all(
      plan.slice(i, i + 8).map(async (t) => {
        const url = tileUrl(t);
        let b = tileBytes.get(url);
        if (!b) {
          b = await download(url);
          tileBytes.set(url, b);
        }
        bytes += b.length;
        return { ...t, heights: decodeTerrariumPng(b) };
      }),
    );
    tiles.push(...chunk);
  }
  return { sampler: createTileSampler(tiles), tiles: plan.length, bytes };
}

async function pvgisRows(lat: number, lon: number): Promise<{ text: string; rows: { A: number; H: number }[] }> {
  const file = refDir ? join(refDir, `pvgis_horizon_${lat}_${lon}.json`) : undefined;
  let text: string;
  if (file && existsSync(file)) text = readFileSync(file, 'utf8');
  else {
    text = new TextDecoder().decode(await download(pvgisHorizonUrl(lat, lon)));
    if (file) writeFileSync(file, text);
  }
  const data = JSON.parse(text) as { outputs: { horizon_profile: { A: number; H_hor: number }[] } };
  // A = 180 repeats A = −180.
  const rows = data.outputs.horizon_profile.filter((r) => r.A < 180).map((r) => ({ A: r.A, H: r.H_hor }));
  return { text, rows };
}

// ── Statistics ───────────────────────────────

/** Periodic linear interpolation of a profile at a north-based azimuth. */
function at(p: HorizonProfile, az: number): number {
  const n = p.elevations.length;
  const x = ((((az % 360) + 360) % 360) / p.stepDeg) % n;
  const i = Math.floor(x);
  const f = x - i;
  return p.elevations[i] + (p.elevations[(i + 1) % n] - p.elevations[i]) * f;
}

function stats(ours: number[], ref: number[]) {
  const n = ours.length;
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const d = ours[i] - ref[i];
    s += d;
    s2 += d * d;
    max = Math.max(max, Math.abs(d));
  }
  const ma = ours.reduce((a, x) => a + x, 0) / n;
  const mb = ref.reduce((a, x) => a + x, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (ours[i] - ma) * (ref[i] - mb);
    saa += (ours[i] - ma) ** 2;
    sbb += (ref[i] - mb) ** 2;
  }
  return { rms: Math.sqrt(s2 / n), max, bias: s / n, r: saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN };
}

const CONVENTIONS: [string, (a: number) => number][] = [
  ['A+180  (0=S, 90=W, -90=E) documented', (a) => a + 180],
  ['180-A  (0=S, 90=E)', (a) => 180 - a],
  ['A      (0=N, clockwise)', (a) => a],
  ['-A     (0=N, counter-clockwise)', (a) => -a],
];

const f2 = (x: number): string => x.toFixed(2);

// ── Main ─────────────────────────────────────

interface SiteResult {
  name: string;
  lat: number;
  lon: number;
  rows: { A: number; H: number }[];
  rms: number;
}

async function main(): Promise<void> {
  console.log(`Terrain horizon vs. PVGIS printhorizon — observer ${observerHeight} m above DEM ground\n`);
  const results: SiteResult[] = [];
  for (const [lat, lon, name] of sites) {
    const { text, rows } = await pvgisRows(lat, lon);
    const pvgisElev = (JSON.parse(text) as { inputs: { location: { elevation: number } } }).inputs.location.elevation;

    clearTerrainTileCache();
    const counter = { tiles: 0, bytes: 0 };
    let t0 = performance.now();
    const res = await fetchTerrainHorizon(lat, lon, {
      fetchImpl: countingFetch(counter),
      cache: false,
      observerHeight,
    });
    const wallMs = performance.now() - t0;
    t0 = performance.now(); // tiles now in memory → plan + compute only
    await fetchTerrainHorizon(lat, lon, {
      fetchImpl: countingFetch({ tiles: 0, bytes: 0 }),
      cache: false,
      observerHeight,
    });
    const computeMs = performance.now() - t0;

    const H = rows.map((r) => r.H);
    console.log(`${name}  ${lat}, ${lon}`);
    console.log(
      `  DEM ground ${res.siteElevation.toFixed(1)} m (PVGIS ${pvgisElev} m) · ${res.tiles} tiles, ` +
        `${(counter.bytes / 1e6).toFixed(2)} MB · ${wallMs.toFixed(0)} ms incl. download, ${computeMs.toFixed(0)} ms plan + compute`,
    );
    console.log('  azimuth convention (Pearson r / RMS vs. PVGIS):');
    for (const [label, toNorth] of CONVENTIONS) {
      const s = stats(
        rows.map((r) => Math.max(0, at(res.profile, toNorth(r.A)))),
        H,
      );
      console.log(`    ${label.padEnd(40)} r = ${s.r.toFixed(3).padStart(6)}   RMS ${f2(s.rms).padStart(5)}°`);
    }
    // The parser's conversion must equal the documented convention.
    const parsed = parsePvgisHorizon(text);
    const s = stats(
      parsed.map((p) => at(res.profile, p.azimuth)),
      parsed.map((p) => p.elevation),
    );
    console.log(
      `  → RMS ${f2(s.rms)}°, max |Δ| ${f2(s.max)}°, bias ${f2(s.bias)}° (ours − PVGIS), r = ${s.r.toFixed(3)}`,
    );

    if (flag('--reference')) {
      const ref = await loadSampler(lat, lon, [{ z: 12, maxDistanceM: Infinity }]);
      t0 = performance.now();
      const hr = computeHorizon(ref.sampler, { latitude: lat, longitude: lon, observerHeight });
      const refMs = performance.now() - t0;
      const d = stats(res.profile.elevations, hr.profile.elevations);
      console.log(
        `  vs. z12 everywhere (${ref.tiles} tiles, ${(ref.bytes / 1e6).toFixed(1)} MB, ${refMs.toFixed(0)} ms): ` +
          `RMS ${d.rms.toFixed(3)}°, max ${f2(d.max)}°`,
      );
    }
    console.log('');
    results.push({ name, lat, lon, rows, rms: s.rms });
  }

  if (flag('--offset-scan')) await offsetScan(results);
  if (flag('--georef')) await georef();

  console.log('Summary (documented convention):');
  for (const r of results) console.log(`  ${r.name.padEnd(24)} RMS ${f2(r.rms)}°`);
  console.log(`  network: ${net.requests} requests, ${(net.bytes / 1e6).toFixed(1)} MB`);
  if (maxRms !== undefined && results.some((r) => r.rms > maxRms)) {
    console.error(`FAIL: RMS above ${maxRms}°`);
    process.exitCode = 1;
  }
}

/**
 * PVGIS residuals are dominated by where PVGIS evaluates the horizon: shifting our observer by one common
 * offset for all sites shows whether PVGIS samples a neighbouring DEM cell (our DEM's georeferencing was
 * checked separately against catalogued summit coordinates).
 */
async function offsetScan(results: SiteResult[]): Promise<void> {
  const M_PER_DEG = (Math.PI / 180) * 6_371_008.8;
  const samplers: ElevationSampler[] = [];
  for (const r of results) samplers.push((await loadSampler(r.lat, r.lon, undefined, 30)).sampler);
  const grid = new Map<string, number[]>();
  for (let dn = -195; dn <= 60; dn += 15) {
    for (let de = -150; de <= 60; de += 15) {
      const rms = results.map((r, i) => {
        const lat = r.lat + dn / M_PER_DEG;
        const lon = r.lon + de / (M_PER_DEG * Math.cos((r.lat * Math.PI) / 180));
        const h = computeHorizon(samplers[i], { latitude: lat, longitude: lon, observerHeight }, { stepDeg: 7.5 });
        return stats(
          r.rows.map((row) => Math.max(0, at(h.profile, row.A + 180))),
          r.rows.map((row) => row.H),
        ).rms;
      });
      grid.set(`${dn},${de}`, rms);
    }
  }
  const mean = (v: number[]): number => v.reduce((a, x) => a + x, 0) / v.length;
  let best = '0,0';
  for (const [k, v] of grid) if (mean(v) < mean(grid.get(best) as number[])) best = k;
  const [dn, de] = best.split(',').map(Number);
  console.log(`Common offset scan (±15 m grid): best observer shift ${dn} m north, ${de} m east`);
  const at0 = grid.get('0,0') as number[];
  const atBest = grid.get(best) as number[];
  results.forEach((r, i) => console.log(`  ${r.name.padEnd(24)} RMS ${f2(at0[i])}° → ${f2(atBest[i])}°`));
  console.log(`  mean RMS ${f2(mean(at0))}° → ${f2(mean(atBest))}°\n`);
}

/**
 * Georeferencing check of the DEM itself: for catalogued summits the highest z12 pixel within 250 m should
 * sit on the catalogue coordinate (Wikidata P625, mostly from swisstopo). A systematic offset here would
 * point at the tiles; none here means the PVGIS offset found by --offset-scan lies on the PVGIS side.
 */
async function georef(): Promise<void> {
  const query =
    'SELECT ?item ?coord ?ele WHERE { ?item wdt:P31 wd:Q8502; wdt:P17 wd:Q39; wdt:P2044 ?ele; wdt:P625 ?coord. FILTER(?ele >= 3500) }';
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'solar-shadow-analyzer/validate-terrain' } });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  const json = (await res.json()) as {
    results: { bindings: { item: { value: string }; coord: { value: string }; ele: { value: string } }[] };
  };
  const seen = new Set<string>();
  const peaks: { lat: number; lon: number; ele: number }[] = [];
  for (const b of json.results.bindings) {
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
    if (!m || seen.has(b.item.value)) continue;
    seen.add(b.item.value);
    // Skip coarse coordinates (< 4 decimals ≈ 10 m).
    if ((m[1].split('.')[1] ?? '').length < 4 || (m[2].split('.')[1] ?? '').length < 4) continue;
    peaks.push({ lon: Number(m[1]), lat: Number(m[2]), ele: Number(b.ele.value) });
  }
  const z = 12;
  const heights = new Map<string, Float32Array>();
  const need = new Set<string>();
  for (const p of peaks) {
    const t = lonLatToTilePixel(p.lon, p.lat, z);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) need.add(`${t.tileX + dx}/${t.tileY + dy}`);
  }
  const keys = [...need];
  for (let i = 0; i < keys.length; i += 8) {
    await Promise.all(
      keys.slice(i, i + 8).map(async (k) => {
        const [x, y] = k.split('/').map(Number);
        const u = tileUrl({ z, x, y });
        let b = tileBytes.get(u);
        if (!b) b = await download(u);
        heights.set(k, decodeTerrariumPng(b));
      }),
    );
  }
  const pixel = (gx: number, gy: number): number =>
    (heights.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`) as Float32Array)[(gy % 256) * 256 + (gx % 256)];
  const M_PER_DEG = (Math.PI / 180) * 6_371_008.8;
  const dN: number[] = [];
  const dE: number[] = [];
  const dH: number[] = [];
  for (const p of peaks) {
    const t = lonLatToTilePixel(p.lon, p.lat, z);
    const gx0 = Math.floor(t.tileX * 256 + t.px);
    const gy0 = Math.floor(t.tileY * 256 + t.py);
    const pxM = (40_075_016.7 * Math.cos((p.lat * Math.PI) / 180)) / 2 ** z / 256;
    const r = Math.ceil(250 / pxM);
    let best = -Infinity;
    let bx = gx0;
    let by = gy0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const h = pixel(gx0 + dx, gy0 + dy);
        if (h > best) [best, bx, by] = [h, gx0 + dx, gy0 + dy];
      }
    }
    if (Math.abs(bx - gx0) === r || Math.abs(by - gy0) === r) continue; // not a local summit
    const c = tilePixelToLonLat(Math.floor(bx / 256), Math.floor(by / 256), (bx % 256) + 0.5, (by % 256) + 0.5, z);
    dN.push((c.lat - p.lat) * M_PER_DEG);
    dE.push((c.lon - p.lon) * M_PER_DEG * Math.cos((p.lat * Math.PI) / 180));
    dH.push(best - p.ele);
  }
  const median = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  console.log(
    `DEM georeferencing (${dN.length} Swiss summits ≥ 3500 m, z12 ≈ 26 m/px): DEM peak − catalogue position ` +
      `median ${median(dN).toFixed(0)} m north, ${median(dE).toFixed(0)} m east; median height ${median(dH).toFixed(0)} m\n`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
