/**
 * Network check of the laser-scan horizon (src/model/dsm.ts) against the research prototype: Breitenrainstrasse
 * 10, 3013 Bern, observer 1 m in front of the SSE facade (normal 153.4°, LV95 grid), 8 m and 14 m above the
 * ground. The prototype (Python, 2026-09-25, 2023 scan, 1° rays) found 32.54° and 17.97° on the normal, by hand
 * from the building across the street (edge 18.65 m away, 19.88 m above the ground) 32.68° and 17.97°: the
 * brief's ≈ 32.5° / ≈ 18.0°. Prints both values, bytes, requests and times; exit code 1 when a value is more
 * than --tolerance (default 0.5°) off. Not part of CI.
 *
 *   npm run validate:dsm [-- --tolerance 0.5 --radius 300]
 *
 * Behind an HTTP proxy, Node's built-in fetch needs NODE_USE_ENV_PROXY=1 (Node ≥ 22.21).
 */
import { computeDsmJob } from '../src/model/dsm';
import { horizonAt } from '../src/model/horizon';
import { gridToTrueAzimuth, lv95ToWgs84 } from '../src/model/lv95';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

const tolerance = arg('tolerance', 0.5);
const radius = arg('radius', 300);
// Prototype geometry (research/dsm/proto.py): facade point on the DSM roof edge, normal from the eave edge.
const FACADE_POINT = { east: 2601130.09, north: 1200813.77 };
const GRID_NORMAL = 153.43494882292202;
const OBSERVER_N = 1;
const HEIGHTS = [8, 14];
const EXPECTED = [32.5, 18.0];

const site = lv95ToWgs84(FACADE_POINT.east, FACADE_POINT.north);
const normal = gridToTrueAzimuth(GRID_NORMAL, site.latitude, site.longitude);

const started = performance.now();
const result = await computeDsmJob(
  {
    site: {
      latitude: site.latitude,
      longitude: site.longitude,
      facadeAzimuth: normal,
      radius,
      trees: true,
      masks: null,
      // Balcony depth 0: only the facade half-space (n < 0.5 m) is excluded, as in the prototype.
      exclusion: { balconyDepthM: 0, rowWidthM: 2, ownFootprint: null },
    },
    groups: [{ n: OBSERVER_N, heights: HEIGHTS }],
  },
  {
    onProgress: (p) =>
      process.stdout.write(
        `\r  ${(p.fraction * 100).toFixed(0)} %, ${(p.bytes / 1e6).toFixed(2)} / ${(p.totalBytes / 1e6).toFixed(2)} MB   `,
      ),
  },
);
const ms = performance.now() - started;
process.stdout.write('\n');

if (result.status !== 'ok') {
  console.error(
    result.status === 'error' ? `Failed (${result.error.kind}): ${result.error.message}` : 'No scan data',
  );
  process.exit(1);
}

const { info, stats } = result;
console.log(
  `Site ${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)}, facade normal ${normal.toFixed(2)}° (true north), radius ${radius} m`,
);
console.log(
  `Scan ${info.dataYears.join(', ')}: ${info.files} files, ${info.tiles} tiles, ${(info.bytes / 1e6).toFixed(2)} MB; ` +
    `ground ${info.ground.toFixed(2)} m (${info.groundSource}), coverage ${info.coverage}`,
);
console.log(
  `Requests ${stats.requests}, downloaded ${(stats.downloaded / 1e6).toFixed(2)} MB, total ${ms.toFixed(0)} ms ` +
    `(STAC ${stats.ms.stac.toFixed(0)}, download ${stats.ms.download.toFixed(0)}, decode ${stats.ms.decode.toFixed(0)}, ` +
    `rays ${stats.ms.rays.toFixed(0)} ms)`,
);
let ok = true;
HEIGHTS.forEach((h, k) => {
  const profile = result.horizons[0][k];
  const onNormal = horizonAt(profile, normal);
  const pass = Math.abs(onNormal - EXPECTED[k]) <= tolerance;
  ok &&= pass;
  console.log(
    `  ${h} m: ${onNormal.toFixed(2)}° on the normal (expected ≈ ${EXPECTED[k].toFixed(1)}° ± ${tolerance}°) ${pass ? 'PASS' : 'FAIL'}` +
      `; ±5°: ${horizonAt(profile, normal - 5).toFixed(2)}° / ${horizonAt(profile, normal + 5).toFixed(2)}°`,
  );
});
process.exit(ok ? 0 : 1);
