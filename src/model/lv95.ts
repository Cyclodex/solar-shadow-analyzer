import type { GeoPoint } from './enu';
import { lonLatToEnu } from './enu';
import type { Vertex } from './polygon';
import { normalizeDeg, toDeg } from './units';

// ─────────────────────────────────────────────
// SWISS LV95 (EPSG:2056) ⇄ WGS84
// swisstopo approximate formulas («Näherungsformeln», version December 2016, U. Marti):
// https://www.swisstopo.admin.ch/dam/en/sd-web/KLRCX9XIdXDu/ch1903wgs84-EN.pdf
// (page «Transformation calculation services»: https://www.swisstopo.admin.ch/en/transformation-calculation-services).
// Forward (WGS84 → LV95) against REFRAME (geodesy.geo.admin.ch) at 10 points in and around CH: ≤ 0.35 m
// (src/model/lv95.test.ts). The published inverse polynomial is up to ~2 m off near Geneva, so lv95ToWgs84
// refines it with Newton steps on the forward formula: both directions agree and share its accuracy.
// Heights are not transformed (LHN95 vs ellipsoidal differ by ~50 m; never mix them, see ARCHITECTURE.md).
// LV95 grid north differs from true north by the meridian convergence (−1.53° Chur … +0.95° Geneva):
// azimuths measured on the LV95 grid must be corrected (gridToTrueAzimuth) before they reach the model.
// ─────────────────────────────────────────────

/** LV95 projection coordinates (m): E ≈ 2.48–2.84 M, N ≈ 1.07–1.30 M in Switzerland. */
export interface Lv95Point {
  east: number;
  north: number;
}

/** WGS84 → LV95 (swisstopo approximate formula). */
export function wgs84ToLv95(latitude: number, longitude: number): Lv95Point {
  const p = (latitude * 3600 - 169028.66) / 10000;
  const l = (longitude * 3600 - 26782.5) / 10000;
  return {
    east: 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l * l * l,
    north:
      1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p * p * p,
  };
}

/** Partial derivatives of wgs84ToLv95 with respect to latitude and longitude, m per degree. */
function jacobian(
  latitude: number,
  longitude: number,
): { eLat: number; eLon: number; nLat: number; nLon: number } {
  const p = (latitude * 3600 - 169028.66) / 10000;
  const l = (longitude * 3600 - 26782.5) / 10000;
  const k = 3600 / 10000; // d(p)/d(latitude°) = d(l)/d(longitude°)
  return {
    eLat: (-10938.51 * l - 0.72 * l * p) * k,
    eLon: (211455.93 - 10938.51 * p - 0.36 * p * p - 133.62 * l * l) * k,
    nLat: (308807.95 + 153.26 * p - 194.56 * l * l + 359.37 * p * p) * k,
    nLon: (7490.5 * l - 389.12 * l * p) * k,
  };
}

/**
 * LV95 → WGS84: the swisstopo inverse polynomial, refined by Newton iteration on wgs84ToLv95 until the forward
 * formula reproduces (east, north) within 1 mm (so lv95ToWgs84 ∘ wgs84ToLv95 is the identity).
 */
export function lv95ToWgs84(east: number, north: number): GeoPoint {
  const y = (east - 2600000) / 1e6;
  const x = (north - 1200000) / 1e6;
  let lon =
    ((2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y) * 100) / 36;
  let lat =
    ((16.9023892 +
      3.238272 * x -
      0.270978 * y * y -
      0.002528 * x * x -
      0.0447 * y * y * x -
      0.014 * x * x * x) *
      100) /
    36;
  for (let i = 0; i < 5; i++) {
    const f = wgs84ToLv95(lat, lon);
    const dE = east - f.east;
    const dN = north - f.north;
    if (Math.abs(dE) < 1e-4 && Math.abs(dN) < 1e-4) break;
    const j = jacobian(lat, lon);
    const det = j.eLat * j.nLon - j.eLon * j.nLat;
    lat += (dE * j.nLon - dN * j.eLon) / det;
    lon += (dN * j.eLat - dE * j.nLat) / det;
  }
  return { latitude: lat, longitude: lon };
}

/**
 * Meridian (grid) convergence at a WGS84 position, degrees: the LV95 grid azimuth of true north, i.e.
 * gridAzimuth − trueAzimuth of any direction. Positive west of Bern (Geneva +0.95°), negative east of it
 * (Chur −1.53°), matching REFRAME.
 */
export function lv95Convergence(latitude: number, longitude: number): number {
  const j = jacobian(latitude, longitude);
  return toDeg(Math.atan2(j.eLat, j.nLat));
}

/** True-north azimuth (degrees, [0, 360)) of a direction measured on the LV95 grid at the given position. */
export function gridToTrueAzimuth(gridAzimuth: number, latitude: number, longitude: number): number {
  return normalizeDeg(gridAzimuth - lv95Convergence(latitude, longitude));
}

/** LV95 grid azimuth (degrees, [0, 360)) of a true-north azimuth at the given position. */
export function trueToGridAzimuth(trueAzimuth: number, latitude: number, longitude: number): number {
  return normalizeDeg(trueAzimuth + lv95Convergence(latitude, longitude));
}

/**
 * Local affine link between LV95 and ENU metres (true north) around `origin`: rotation by the convergence and
 * the projection's scale, from the Jacobian of the forward formula at the origin. It matches
 * wgs84ToLv95(enuToLonLat(…)) to ≤ 1 cm within 300 m of the origin and ≤ 3 cm within 500 m (lv95.test.ts), so
 * ray marching can step in ENU and sample the LV95 raster (0.5 m cells) without per-sample geodesy.
 */
export interface Lv95LocalFrame {
  /** LV95 coordinates of the origin. */
  origin: Lv95Point;
  /** Convergence at the origin, degrees (see lv95Convergence). */
  convergence: number;
  /** ENU [east, north] (m, relative to the origin) → LV95. */
  toLv95: (east: number, north: number) => Lv95Point;
  /** LV95 → ENU [east, north] (m, relative to the origin). */
  toEnu: (lv95East: number, lv95North: number) => Vertex;
}

export function lv95LocalFrame(origin: GeoPoint): Lv95LocalFrame {
  const o = wgs84ToLv95(origin.latitude, origin.longitude);
  const j = jacobian(origin.latitude, origin.longitude);
  // Metres per degree along ENU axes at the origin (lonLatToEnu of a 1e-3° step, linear to ~1e-9).
  const [eastPerLon] = lonLatToEnu(origin, origin.latitude, origin.longitude + 1e-3);
  const [, northPerLat] = lonLatToEnu(origin, origin.latitude + 1e-3, origin.longitude);
  const kx = 1e-3 / eastPerLon; // degrees longitude per metre east
  const ky = 1e-3 / northPerLat; // degrees latitude per metre north
  // d(LV95)/d(ENU)
  const a = j.eLon * kx; // dE/de
  const b = j.eLat * ky; // dE/dn
  const c = j.nLon * kx; // dN/de
  const d = j.nLat * ky; // dN/dn
  const det = a * d - b * c;
  return {
    origin: o,
    convergence: toDeg(Math.atan2(j.eLat, j.nLat)),
    toLv95: (e, n) => ({ east: o.east + a * e + b * n, north: o.north + c * e + d * n }),
    toEnu: (E, N) => {
      const dE = E - o.east;
      const dN = N - o.north;
      return [(d * dE - b * dN) / det, (a * dN - c * dE) / det];
    },
  };
}
