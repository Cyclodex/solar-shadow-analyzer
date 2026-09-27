import type { Building, BuildingImport, LocationConfig } from './types';
import { facadeTransform, type GeoPoint } from './enu';
import { pointInRing, ringBounds, type ReadonlyVertex } from './polygon';

// ─────────────────────────────────────────────
// SURROUNDINGS: CALCULATION RULES (binding; docs/ARCHITECTURE.md, "Umgebung: Adresse, Laserscan, Gebäude")
// Pure helpers that decide which surrounding buildings enter which horizon. They carry no geometry work of
// their own: the prism horizon (model/buildingHorizon.ts) and the laser-scan (DSM) horizon (terrain worker,
// model/dsmHorizon.ts) apply them.
//
// dsmActive = horizon.surfaceModel.enabled && the DSM horizons are loaded ('ready') for the current site key
// (hooks/useSurfaceModel.ts useDsmActive). Per floor and tilt the horizon is the per-azimuth maximum of terrain
// (if enabled) ∪ manual points ∪ box obstacles ∪ prism horizon ∪ DSM horizon (if dsmActive).
// ─────────────────────────────────────────────

/**
 * Buildings that enter the prism horizon. With the laser scan active it already contains every scanned
 * building, so only buildings it cannot know are added: manual ones and imported ones the user edited
 * (their scan cells are masked, see dsmMaskPolygons). Without it, every building that is not removed.
 * Removed buildings never count. `exclude` lists own-building ids (ownBuildingIds): they never shade the
 * facade they belong to.
 */
export function prismBuildings(
  buildings: readonly Building[],
  dsmActive: boolean,
  exclude: readonly string[] = [],
): Building[] {
  return buildings.filter(
    (b) =>
      !b.removed && !exclude.includes(b.id) && (!dsmActive || b.source === 'manual' || b.edited === true),
  );
}

/**
 * Footprints (anchor ENU, m) whose laser-scan cells are replaced by the ground (DTM): imported buildings the
 * user removed (demolished) or edited (the prism with the new height/base replaces the scan).
 */
export function dsmMaskPolygons(buildings: readonly Building[]): [number, number][][] {
  return buildings
    .filter((b) => b.source === 'swisstopo' && (b.removed === true || b.edited === true))
    .map((b) => b.footprint.map((p): [number, number] => [p[0], p[1]]));
}

/**
 * Own-building exclusion (facade frame of config.location, m; n = outward from the facade wall).
 *
 * The laser scan contains the own building, its balconies and railings. They must not become horizon: the
 * model handles the floor above via the panel-row shading (geometry.ts), not via balcony slabs, and the facade
 * itself blocks every sun position behind it (s_n ≤ 0). Rule for DSM cells:
 * - n < behindFacadeN: behind (or in) the facade plane → ignored everywhere;
 * - 0 ≤ n ≤ balconyDepth + balconyMarginN, within the own building's extent along the facade → ignored
 *   (own balconies). The extent comes from the own footprint (vector tiles; the part containing the probe point
 *   (u, n) = (0, probeN)); if it is unknown: ± (rowWidth / 2 + fallbackSideMarginM).
 * Assumption: neighbours' balconies beyond that extent are real obstacles and stay in the scan.
 *
 * For prisms the own building is excluded by id (ownBuildingIds): every stored building containing the probe
 * point. Other parts of the own building (wings, annexes in front of the facade) stay: they really shade.
 */
export const OWN_BUILDING_EXCLUSION = {
  behindFacadeN: 0.5,
  balconyMarginN: 0.5,
  fallbackSideMarginM: 2,
  probeN: -0.5,
} as const;

/** Own-building zone of the DSM in the facade frame (see OWN_BUILDING_EXCLUSION). */
export interface OwnExclusionZone {
  /** Cells with n below this are ignored (m). */
  behindN: number;
  /** Balcony zone: 0 ≤ n ≤ balconyN (m) … */
  balconyN: number;
  /** … and u0 ≤ u ≤ u1 (m, along the facade). */
  u0: number;
  u1: number;
}

/**
 * The exclusion zone for a balcony depth and row width (m). `ownFootprint` is the own building's footprint in
 * the facade frame [u, n] when known: its extent along the facade bounds the balcony zone.
 */
export function ownExclusionZone(
  balconyDepthM: number,
  rowWidthM: number,
  ownFootprint?: readonly ReadonlyVertex[] | null,
): OwnExclusionZone {
  const X = OWN_BUILDING_EXCLUSION;
  const half = rowWidthM / 2 + X.fallbackSideMarginM;
  let u0 = -half;
  let u1 = half;
  if (ownFootprint && ownFootprint.length >= 3) {
    const [minU, , maxU] = ringBounds(ownFootprint);
    u0 = Math.min(minU, 0);
    u1 = Math.max(maxU, 0);
  }
  return { behindN: X.behindFacadeN, balconyN: balconyDepthM + X.balconyMarginN, u0, u1 };
}

/** True if a DSM cell at facade-frame (u, n) belongs to the own building / balconies and must be ignored. */
export function isOwnBuildingCell(u: number, n: number, zone: OwnExclusionZone): boolean {
  if (n < zone.behindN) return true;
  return n <= zone.balconyN && u >= zone.u0 && u <= zone.u1;
}

/**
 * Ids of the stored buildings that are the own building: their footprint contains the probe point 0.5 m behind
 * the facade origin (config.location). Needs the anchor (horizon.buildingImport); none without it.
 */
export function ownBuildingIds(
  buildings: readonly Building[],
  anchor: BuildingImport | GeoPoint | null,
  location: Pick<LocationConfig, 'latitude' | 'longitude'>,
  facadeAzimuth: number,
): string[] {
  if (!anchor || buildings.length === 0) return [];
  const t = facadeTransform(anchor, location, facadeAzimuth);
  const [pe, pn] = t.toAnchor([0, OWN_BUILDING_EXCLUSION.probeN]);
  return buildings.filter((b) => pointInRing(b.footprint, pe, pn)).map((b) => b.id);
}
