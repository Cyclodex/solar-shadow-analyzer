/**
 * Network check of the swisstopo building import (src/model/buildingSources.ts): fetches the base vector tiles
 * around an address and prints what the import would deliver. Not part of CI.
 *
 *   npx tsx scripts/validate-buildings.ts [--lat 46.947849 --lon 7.449978 --radius 300]
 *
 * Default site: Kramgasse 49, 3011 Bern (entrance point of the federal building register, LV95
 * 2600863.736 / 1199640.541). Reference of 2026-09-25 (300 m): 4 tiles, 694 kB, 1,513 parts (43 pieces joined
 * across tile edges; without joining 1,545 parts), 10,204 vertices, the own part 21 m high with 11 vertices.
 * Behind an HTTP proxy, Node's built-in fetch needs NODE_USE_ENV_PROXY=1 (Node ≥ 22.21).
 */
import { fetchSwisstopoBuildings } from '../src/model/buildingSources';
import { pointInRing, ringArea } from '../src/model/polygon';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

const latitude = arg('lat', 46.947849);
const longitude = arg('lon', 7.449978);
const radius = arg('radius', 300);

const started = performance.now();
const result = await fetchSwisstopoBuildings(latitude, longitude, radius, {
  onProgress: (done, total, bytes) => console.log(`  tile ${done}/${total}, ${(bytes / 1024).toFixed(0)} kB`),
});
const ms = performance.now() - started;

if (!result.ok) {
  console.error(`Import failed (${result.error.kind}): ${result.error.message}`);
  process.exit(1);
}

const { parts } = result;
const vertices = parts.reduce((a, p) => a + p.footprint.length, 0);
const own = parts.filter((p) => pointInRing(p.footprint, 0, 0));
const heights = parts.map((p) => p.height).sort((a, b) => a - b);
const kinds = new Map<string, number>();
for (const p of parts) kinds.set(p.kind ?? '(none)', (kinds.get(p.kind ?? '(none)') ?? 0) + 1);
const q = (f: number): number => heights[Math.min(heights.length - 1, Math.floor(f * heights.length))] ?? NaN;

console.log(`Site ${latitude}, ${longitude}, radius ${radius} m — ${result.attribution}`);
console.log(
  `Tiles: ${result.tileCount}, ${(result.bytes / 1024).toFixed(0)} kB, ${ms.toFixed(0)} ms (covered: ${result.covered})`,
);
console.log(
  `Parts: ${parts.length} (pieces joined across tile edges: ${result.mergedPieces}), vertices: ${vertices}`,
);
console.log(`  max vertices per part: ${Math.max(0, ...parts.map((p) => p.footprint.length))}`);
console.log(`  with courtyards (holes): ${parts.filter((p) => p.holes).length}`);
console.log(`  heights m: min ${q(0)}, median ${q(0.5)}, p95 ${q(0.95)}, max ${heights.at(-1) ?? NaN}`);
console.log(`  classes: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}`);
for (const p of own) {
  console.log(
    `  own part (contains the point): ${p.height} m, ${p.footprint.length} vertices, ${ringArea(p.footprint).toFixed(1)} m²`,
  );
}
if (own.length === 0) console.log('  no part contains the point (not on a building?)');
