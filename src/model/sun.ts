import type { SunPosition, Vec3 } from './types';
import { DEG, normalizeDeg } from './units';
import { MS_PER_DAY, MS_PER_MINUTE, localClockMinutes, localToUtc } from './time';

// ─────────────────────────────────────────────
// SUN POSITION (NOAA)
// Follows the NOAA solar calculator spreadsheet (Meeus, "Astronomical Algorithms"):
// accuracy ≈ 1′ for 1901–2099. Time argument is UT (ΔT neglected, < 0.001°).
// ─────────────────────────────────────────────

/** Geometric altitude of the sun's center at sunrise/sunset: 34′ refraction + 16′ semi-diameter. */
export const SUNRISE_ALTITUDE = -0.833;

const JD_UNIX_EPOCH = 2440587.5; // JD of 1970-01-01T00:00Z
const JD_J2000 = 2451545;

// Scratch output of ephemeris() — avoids an allocation per call in yearly loops.
let ephDecl = 0; // declination, rad
let ephEot = 0; // equation of time, min

/** NOAA declination and equation of time at `utcMs` → ephDecl, ephEot. */
function ephemeris(utcMs: number): void {
  const jc = (utcMs / MS_PER_DAY + JD_UNIX_EPOCH - JD_J2000) / 36525; // Julian century
  const l0 = normalizeDeg(280.46646 + jc * (36000.76983 + jc * 0.0003032)) * DEG; // geom. mean longitude
  const m = (357.52911 + jc * (35999.05029 - 0.0001537 * jc)) * DEG; // geom. mean anomaly
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc); // orbit eccentricity
  const center =
    Math.sin(m) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * m) * 0.000289; // equation of center, deg
  const omega = (125.04 - 1934.136 * jc) * DEG; // longitude of the moon's ascending node
  // Apparent longitude: true longitude − aberration − nutation.
  const lambda = l0 + (center - 0.00569 - 0.00478 * Math.sin(omega)) * DEG;
  const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * DEG; // corrected obliquity
  ephDecl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2;
  ephEot =
    (4 / DEG) *
    (y * Math.sin(2 * l0) -
      2 * e * Math.sin(m) +
      4 * e * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * e * e * Math.sin(2 * m));
}

/** Hour angle in rad (0 = local solar noon, + = afternoon); needs ephemeris(utcMs) first. */
function hourAngle(utcMs: number, longitude: number): number {
  const utcMin = (((utcMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / MS_PER_MINUTE;
  const trueSolarTime = utcMin + ephEot + 4 * longitude; // min
  return (trueSolarTime / 4 - 180) * DEG;
}

/**
 * NOAA atmospheric refraction (standard atmosphere) for a geometric elevation, degrees.
 * Piecewise as in the NOAA spreadsheet; 0 above 85°.
 */
export function noaaRefraction(elevation: number): number {
  if (elevation > 85) return 0;
  const te = Math.tan(elevation * DEG);
  let arcsec: number;
  if (elevation > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (elevation > -0.575)
    arcsec = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  else arcsec = -20.772 / te;
  return arcsec / 3600;
}

/**
 * Sun position at `utcMs` for an observer at `latitude`/`longitude` (degrees, north/east positive).
 * Altitude includes NOAA refraction unless `opts.refraction === false`. Works at any latitude incl. the
 * poles (azimuth via atan2, no acos domain issues).
 */
export function sunPosition(
  utcMs: number,
  latitude: number,
  longitude: number,
  opts?: { refraction?: boolean },
): SunPosition {
  ephemeris(utcMs);
  const h = hourAngle(utcMs, longitude);
  const phi = latitude * DEG;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinD = Math.sin(ephDecl);
  const cosD = Math.cos(ephDecl);
  const cosH = Math.cos(h);
  // Sun direction in ENU; azimuth = atan2(east, north) equals NOAA's acos form with the quadrant resolved.
  const east = -cosD * Math.sin(h);
  const north = sinD * cosPhi - cosD * cosH * sinPhi;
  const up = sinD * sinPhi + cosD * cosH * cosPhi;
  const elevation = Math.atan2(up, Math.sqrt(east * east + north * north)) / DEG;
  return {
    altitude: opts?.refraction === false ? elevation : elevation + noaaRefraction(elevation),
    azimuth: normalizeDeg(Math.atan2(east, north) / DEG),
    declination: ephDecl / DEG,
    equationOfTime: ephEot,
  };
}

/** Unit sun direction in ENU (x = east, y = north, z = up) from apparent altitude and azimuth. */
export function sunVectorEnu(sun: SunPosition): Vec3 {
  const h = sun.altitude * DEG;
  const a = sun.azimuth * DEG;
  const c = Math.cos(h);
  return { x: c * Math.sin(a), y: c * Math.cos(a), z: Math.sin(h) };
}

export interface SunTimes {
  /**
   * Local clock minutes since midnight of the date; null if the sun does not rise in this solar day. May be
   * negative at high latitudes (rises before local midnight, e.g. 85° N on 2025-03-31: −26 min).
   */
  sunrise: number | null;
  /** Local clock minutes of the upper transit (hour angle 0). */
  solarNoon: number;
  /** Local clock minutes; may exceed 1440 at high latitudes (sets after local midnight). */
  sunset: number | null;
  /** 'day' = midnight sun, 'night' = sun stays below −0.833°; null otherwise. */
  polar: 'day' | 'night' | null;
}

/** Transit (hour angle 0) nearest to `refMs`, UTC ms. */
function solarTransit(refMs: number, longitude: number): number {
  const dayStart = Math.floor(refMs / MS_PER_DAY) * MS_PER_DAY;
  let t = refMs;
  // EoT changes < 1 s per hour → 3 fixed-point steps converge far below 1 s.
  for (let i = 0; i < 3; i++) {
    ephemeris(t);
    t = dayStart + (720 - 4 * longitude - ephEot) * MS_PER_MINUTE;
    t += Math.round((refMs - t) / MS_PER_DAY) * MS_PER_DAY;
  }
  return t;
}

/** Bisection for the crossing of g(t) = 0 in [lo, hi] with g(lo) < 0 ≤ g(hi) (rising) or reverse; 0.5 s. */
function crossing(g: (t: number) => number, lo: number, hi: number, rising: boolean): number | null {
  const glo = g(lo);
  const ghi = g(hi);
  if (rising ? !(glo < 0 && ghi >= 0) : !(glo >= 0 && ghi < 0)) return null;
  const loNegative = glo < 0;
  while (hi - lo > 500) {
    const mid = (lo + hi) / 2;
    const midNegative = g(mid) < 0;
    if (midNegative === loNegative) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Sunrise, solar noon and sunset for the local calendar `date` ("YYYY-MM-DD") in `timeZone`.
 * Events are crossings of the sun's center through the geometric altitude −0.833° (upper limb on the
 * apparent horizon, standard refraction) — as NOAA/USNO. Times are local clock minutes (incl. DST).
 * On polar transition days only one of sunrise/sunset may exist. Throws RangeError for an invalid date.
 */
export function sunTimes(date: string, latitude: number, longitude: number, timeZone: string): SunTimes {
  const phi = latitude * DEG;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinH0 = Math.sin(SUNRISE_ALTITUDE * DEG);
  // sin(geometric altitude) − sin(h0); monotonic in altitude.
  const g = (t: number): number => {
    ephemeris(t);
    const h = hourAngle(t, longitude);
    return Math.sin(ephDecl) * sinPhi + Math.cos(ephDecl) * Math.cos(h) * cosPhi - sinH0;
  };

  const noon = solarTransit(localToUtc(date, 720, timeZone), longitude);
  const half = MS_PER_DAY / 2;
  const toLocal = (t: number): number => localClockMinutes(t, date, timeZone);
  const solarNoon = toLocal(noon);

  if (g(noon) < 0) return { sunrise: null, solarNoon, sunset: null, polar: 'night' };
  if (g(noon - half) >= 0 && g(noon + half) >= 0)
    return { sunrise: null, solarNoon, sunset: null, polar: 'day' };
  const rise = crossing(g, noon - half, noon, true);
  const set = crossing(g, noon, noon + half, false);
  return {
    sunrise: rise === null ? null : toLocal(rise),
    solarNoon,
    sunset: set === null ? null : toLocal(set),
    polar: null,
  };
}

export interface SolarPathPoint {
  /** Local clock minutes since midnight. */
  minutes: number;
  utcMs: number;
  sun: SunPosition;
}

/**
 * Sun positions over the local day 00:00–24:00 every `stepMinutes` (24:00 included when on the grid).
 * Clock times that do not exist (DST gap, also 24:00 if the next day starts in a gap) are skipped; repeated times
 * (DST end) use the first occurrence.
 * Throws RangeError for an invalid date or step.
 */
export function solarPath(
  date: string,
  latitude: number,
  longitude: number,
  timeZone: string,
  stepMinutes = 10,
): SolarPathPoint[] {
  if (!(stepMinutes > 0) || !Number.isFinite(stepMinutes))
    throw new RangeError(`Invalid step: ${stepMinutes}`);
  const t0 = localToUtc(date, 0, timeZone);
  const tNoon = localToUtc(date, 720, timeZone);
  const t1 = localToUtc(date, 1440, timeZone);
  // No offset change during the day (usual case) → clock minutes map linearly; no Intl call per point.
  // The last check catches a gap starting at 24:00 (e.g. Santiago, Havana, Cairo): t1 is then shifted to 01:00.
  const uniform =
    tNoon - t0 === 720 * MS_PER_MINUTE &&
    t1 - t0 === 1440 * MS_PER_MINUTE &&
    localClockMinutes(t1, date, timeZone) === 1440;
  const out: SolarPathPoint[] = [];
  const n = Math.floor(1440 / stepMinutes + 1e-9);
  for (let i = 0; i <= n; i++) {
    const minutes = i * stepMinutes;
    let utcMs: number;
    if (uniform) utcMs = t0 + minutes * MS_PER_MINUTE;
    else {
      utcMs = localToUtc(date, minutes, timeZone);
      if (Math.abs(localClockMinutes(utcMs, date, timeZone) - minutes) > 1e-6) continue; // in the gap
    }
    out.push({ minutes, utcMs, sun: sunPosition(utcMs, latitude, longitude) });
  }
  return out;
}
