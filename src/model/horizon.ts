import type { Config, FacadeVector, HorizonPoint, HorizonProfile, Obstacle } from './types';
import { clamp, normalizeDeg, toDeg, toRad } from './units';
import { floorPlacements } from './geometry';

// ─────────────────────────────────────────────
// HORIZON PROFILES
// Profiles are sampled every stepDeg from azimuth 0° (north), periodic over 360°,
// linearly interpolated in between. Elevations in degrees (may be negative).
// ─────────────────────────────────────────────

/** Sampling step of the per-floor horizons (fine enough for obstacle edges). */
export const FLOOR_HORIZON_STEP_DEG = 0.5;

/** Direction components below this count as parallel to a box face. */
const PARALLEL_EPS = 1e-12;

/** Number of samples for `stepDeg`; the effective step is 360 / n so the profile closes exactly. */
function sampleCount(stepDeg: number): number {
  if (!(stepDeg > 0) || !Number.isFinite(stepDeg)) throw new RangeError(`Invalid horizon step: ${stepDeg}`);
  return Math.max(1, Math.round(360 / stepDeg));
}

/** Flat horizon (0° everywhere). Step is adjusted to 360 / round(360 / stepDeg). */
export function emptyHorizon(stepDeg = 1): HorizonProfile {
  const n = sampleCount(stepDeg);
  return { stepDeg: 360 / n, elevations: new Array<number>(n).fill(0) };
}

/** Horizon elevation at any azimuth (degrees, any range), periodic linear interpolation. 0 for an empty profile. */
export function horizonAt(profile: HorizonProfile, azimuth: number): number {
  const e = profile.elevations;
  const n = e.length;
  if (n === 0) return 0;
  const x = normalizeDeg(azimuth) / profile.stepDeg;
  const i = Math.floor(x);
  const f = x - i;
  const i0 = i % n; // normalizeDeg(−tiny) can round to 360 → i = n
  const i1 = i0 + 1 === n ? 0 : i0 + 1;
  return e[i0] + (e[i1] - e[i0]) * f;
}

/** Pointwise maximum of profiles, resampled at `stepDeg`. Missing profiles are skipped; none → flat. */
export function maxHorizon(profiles: readonly (HorizonProfile | null | undefined)[], stepDeg = 1): HorizonProfile {
  const out = emptyHorizon(stepDeg);
  const valid = profiles.filter((p): p is HorizonProfile => p != null && p.elevations.length > 0);
  if (valid.length === 0) return out;
  const e = out.elevations;
  for (let i = 0; i < e.length; i++) {
    const az = i * out.stepDeg;
    let m = -Infinity;
    for (const p of valid) m = Math.max(m, horizonAt(p, az));
    e[i] = m;
  }
  return out;
}

/**
 * Profile through arbitrary (azimuth, elevation) points: azimuths normalized to [0, 360), sorted, periodic linear
 * interpolation (last → first wraps through north). Duplicate azimuths keep the highest elevation (e.g. 0° and 360°).
 * Elevations are clamped to ±90°, non-finite points ignored. No points → flat horizon.
 */
export function horizonFromPoints(points: readonly HorizonPoint[], stepDeg = 1): HorizonProfile {
  const out = emptyHorizon(stepDeg);
  const sorted = points
    .filter((p) => Number.isFinite(p.azimuth) && Number.isFinite(p.elevation))
    .map((p) => ({ az: normalizeDeg(p.azimuth), el: clamp(p.elevation, -90, 90) }))
    .sort((a, b) => a.az - b.az);
  const pts: { az: number; el: number }[] = [];
  for (const p of sorted) {
    const last = pts[pts.length - 1];
    if (last && p.az - last.az < 1e-9) last.el = Math.max(last.el, p.el);
    else pts.push(p);
  }
  if (pts.length === 0) return out;
  // Periodic extension: previous lap's last point and next lap's first point.
  const first = pts[0];
  const last = pts[pts.length - 1];
  const ext = [{ az: last.az - 360, el: last.el }, ...pts, { az: first.az + 360, el: first.el }];
  const e = out.elevations;
  let k = 0;
  for (let i = 0; i < e.length; i++) {
    const az = i * out.stepDeg;
    while (ext[k + 1].az <= az) k++;
    const a = ext[k];
    const b = ext[k + 1];
    e[i] = a.el + ((b.el - a.el) * (az - a.az)) / (b.az - a.az);
  }
  return out;
}

interface Footprint {
  u0: number;
  u1: number;
  n0: number;
  n1: number;
  /** Obstacle top above the observer, m (> 0). */
  rise: number;
}

/** Slab test: distance along the unit ray (du, dn) from (ou, on) to the first point of the box, or −1 if missed. */
function rayEntry(ou: number, on: number, du: number, dn: number, b: Footprint): number {
  let tNear = -Infinity;
  let tFar = Infinity;
  if (Math.abs(du) < PARALLEL_EPS) {
    if (ou < b.u0 || ou > b.u1) return -1;
  } else {
    const ta = (b.u0 - ou) / du;
    const tb = (b.u1 - ou) / du;
    tNear = Math.max(tNear, Math.min(ta, tb));
    tFar = Math.min(tFar, Math.max(ta, tb));
  }
  if (Math.abs(dn) < PARALLEL_EPS) {
    if (on < b.n0 || on > b.n1) return -1;
  } else {
    const ta = (b.n0 - on) / dn;
    const tb = (b.n1 - on) / dn;
    tNear = Math.max(tNear, Math.min(ta, tb));
    tFar = Math.min(tFar, Math.max(ta, tb));
  }
  if (tNear > tFar || tFar < 0) return -1;
  return Math.max(0, tNear);
}

/**
 * Horizon caused by box obstacles, seen from `observer` (u, n = distance from the facade wall, z above ground; m).
 * For each azimuth a horizontal ray is intersected with every footprint (u ∈ offsetAlong ± width/2,
 * n ∈ [distance, distance + depth]); elevation = atan2(height − z, nearest hit distance), floored at 0.
 * Works for all directions (also behind the facade plane). Obstacles containing the observer are ignored.
 */
export function obstacleHorizon(
  obstacles: readonly Obstacle[],
  observer: FacadeVector,
  facadeAzimuth: number,
  stepDeg = 0.5,
): HorizonProfile {
  const out = emptyHorizon(stepDeg);
  const boxes: Footprint[] = [];
  for (const o of obstacles) {
    const b: Footprint = {
      u0: o.offsetAlong - o.width / 2,
      u1: o.offsetAlong + o.width / 2,
      n0: o.distance,
      n1: o.distance + o.depth,
      rise: o.height - observer.z,
    };
    if (!(b.rise > 0) || !(b.u1 > b.u0) || !(b.n1 > b.n0)) continue; // never above 0° / degenerate
    const inside = observer.u > b.u0 && observer.u < b.u1 && observer.n > b.n0 && observer.n < b.n1;
    if (!inside) boxes.push(b);
  }
  if (boxes.length === 0) return out;
  const e = out.elevations;
  for (let i = 0; i < e.length; i++) {
    const rel = toRad(i * out.stepDeg - facadeAzimuth);
    // Horizontal direction in the facade frame, same convention as sunInFacade.
    const du = -Math.sin(rel);
    const dn = Math.cos(rel);
    let best = 0;
    for (const b of boxes) {
      const t = rayEntry(observer.u, observer.n, du, dn, b);
      // Flat top: the nearest point of the box subtends the largest elevation.
      if (t >= 0) best = Math.max(best, toDeg(Math.atan2(b.rise, t)));
    }
    e[i] = best;
  }
  return out;
}

/**
 * Horizon per floor (index = floor): max of the terrain profile (only if `config.horizon.terrainEnabled`),
 * the manual points and the obstacles seen from that floor's panel center. Step FLOOR_HORIZON_STEP_DEG.
 */
export function floorHorizons(config: Config, terrain: HorizonProfile | null): HorizonProfile[] {
  const step = FLOOR_HORIZON_STEP_DEG;
  const { terrainEnabled, manual, obstacles } = config.horizon;
  const shared: HorizonProfile[] = [];
  if (terrainEnabled && terrain) shared.push(terrain);
  if (manual.length > 0) shared.push(horizonFromPoints(manual, step));
  return floorPlacements(config).map((p) => {
    const own = obstacles.length > 0 ? obstacleHorizon(obstacles, p.center, config.building.facadeAzimuth, step) : null;
    return maxHorizon([...shared, own], step);
  });
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

function parseNumber(s: string): number | null {
  const t = s.trim().replace(/−/g, '-');
  return NUMBER_RE.test(t) ? Number(t) : null;
}

/**
 * Parses "azimuth,elevation" lines (north-based azimuth, degrees). Separators: `;`, tab, `,` or whitespace;
 * with `;`/tab a decimal comma is accepted ("180;12,5"). Non-numeric lines (headers) and `#` comments are skipped;
 * extra columns are ignored. Values are returned as written (see horizonFromPoints for normalization).
 */
export function parseHorizonCsv(text: string): HorizonPoint[] {
  const out: HorizonPoint[] = [];
  for (const raw of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    let fields: string[];
    if (/[;\t]/.test(line)) fields = line.split(/[;\t]/).map((f) => f.replace(',', '.'));
    else if (line.includes(',')) fields = line.split(',');
    else fields = line.split(/\s+/);
    if (fields.length < 2) continue;
    const azimuth = parseNumber(fields[0]);
    const elevation = parseNumber(fields[1]);
    if (azimuth === null || elevation === null) continue;
    out.push({ azimuth, elevation });
  }
  return out;
}

const fmt = (x: number, decimals: number): string => String(Number(x.toFixed(decimals)));

/** CSV "azimuth,elevation" with header, one line per sample (elevation rounded to 0.01°). */
export function horizonToCsv(profile: HorizonProfile): string {
  const lines = ['azimuth,elevation'];
  profile.elevations.forEach((el, i) => lines.push(`${fmt(i * profile.stepDeg, 4)},${fmt(el, 2)}`));
  return lines.join('\n') + '\n';
}
