import type { ReadonlyVertex, Vertex } from './polygon';
import { toRad } from './units';

// ─────────────────────────────────────────────
// LOCAL EAST/NORTH COORDINATES AND THE FACADE FRAME
// ENU: metres east (x) and north (y, true north) of an anchor on the WGS84 ellipsoid, using the meridian (M)
// and prime-vertical (N) radii of curvature at the anchor latitude (a sphere would be 0.29 % off east-west,
// 0.87 m at 300 m). Accurate to a few centimetres within 1 km, which is far below the source data accuracy.
// Facade frame (docs/ARCHITECTURE.md, "Koordinatensysteme"): n = outward normal (sin γ, cos γ),
// u = along the facade, positive to the right for a person looking at the facade from outside
// (−cos γ, sin γ); γ = facade azimuth. Same convention as horizon.ts obstacleHorizon / sunInFacade.
// ─────────────────────────────────────────────

/** WGS84 semi-major axis, m. */
export const WGS84_A = 6378137;
/** WGS84 flattening. */
export const WGS84_F = 1 / 298.257223563;
const E2 = WGS84_F * (2 - WGS84_F);

/** A WGS84 position in degrees. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Radii of curvature at `latitude` (degrees): meridian M and prime vertical N, m. */
export function wgs84Radii(latitude: number): { meridian: number; primeVertical: number } {
  const s = Math.sin(toRad(latitude));
  const w = Math.sqrt(1 - E2 * s * s);
  return { meridian: (WGS84_A * (1 - E2)) / (w * w * w), primeVertical: WGS84_A / w };
}

/** Metres per degree of latitude (north) and of longitude (east) at `latitude`. */
function metresPerDegree(latitude: number): { north: number; east: number } {
  const { meridian, primeVertical } = wgs84Radii(latitude);
  return { north: toRad(meridian), east: toRad(primeVertical * Math.cos(toRad(latitude))) };
}

/** [east, north] metres of (latitude, longitude) relative to `anchor`. */
export function lonLatToEnu(anchor: GeoPoint, latitude: number, longitude: number): Vertex {
  const m = metresPerDegree(anchor.latitude);
  let dLon = longitude - anchor.longitude;
  if (dLon > 180) dLon -= 360;
  else if (dLon < -180) dLon += 360;
  return [dLon * m.east, (latitude - anchor.latitude) * m.north];
}

/** Inverse of lonLatToEnu. */
export function enuToLonLat(anchor: GeoPoint, east: number, north: number): GeoPoint {
  const m = metresPerDegree(anchor.latitude);
  return { latitude: anchor.latitude + north / m.north, longitude: anchor.longitude + east / m.east };
}

/** ENU [east, north] → facade frame [u, n] for facade azimuth γ (degrees), same origin. */
export function enuToFacade(p: ReadonlyVertex, facadeAzimuth: number): Vertex {
  const g = toRad(facadeAzimuth);
  const c = Math.cos(g);
  const s = Math.sin(g);
  return [-p[0] * c + p[1] * s, p[0] * s + p[1] * c];
}

/** Facade frame [u, n] → ENU [east, north] for facade azimuth γ (degrees), same origin. */
export function facadeToEnu(q: ReadonlyVertex, facadeAzimuth: number): Vertex {
  const g = toRad(facadeAzimuth);
  const c = Math.cos(g);
  const s = Math.sin(g);
  return [-q[0] * c + q[1] * s, q[0] * s + q[1] * c];
}

/** Conversions between an anchor's ENU frame (building footprints) and the facade frame at a location. */
export interface FacadeTransform {
  /** Anchor ENU [east, north] → facade frame [u, n] (origin = location). */
  toFacade: (p: ReadonlyVertex) => Vertex;
  /** Facade frame [u, n] → anchor ENU [east, north]. */
  toAnchor: (q: ReadonlyVertex) => Vertex;
  /** ENU [east, north] of the location relative to the anchor (the facade-frame origin). */
  origin: Vertex;
}

/**
 * Transform between footprints stored relative to `anchor` (horizon.buildingImport) and the facade frame of
 * `location` (config.location = facade origin) with facade azimuth γ. The location's offset is measured in the
 * anchor's ENU frame; the rotation between the two local frames (≈ 0.003° per 300 m) is neglected.
 */
export function facadeTransform(
  anchor: GeoPoint,
  location: GeoPoint,
  facadeAzimuth: number,
): FacadeTransform {
  const origin = lonLatToEnu(anchor, location.latitude, location.longitude);
  const [ox, oy] = origin;
  return {
    origin,
    toFacade: (p) => enuToFacade([p[0] - ox, p[1] - oy], facadeAzimuth),
    toAnchor: (q) => {
      const [e, n] = facadeToEnu(q, facadeAzimuth);
      return [e + ox, n + oy];
    },
  };
}
