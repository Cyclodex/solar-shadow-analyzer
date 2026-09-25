import type { Config, FloorPlacement, HorizonProfile } from './types';

// ─────────────────────────────────────────────
// PRISM HORIZON OF THE SURROUNDING BUILDINGS
// Owned by the buildings feature (docs/ARCHITECTURE.md, "Umgebung", file ownership). The horizon pipeline
// (hooks/useTerrain.ts floorHorizonsWithTerrain) calls prismFloorHorizons for every config with buildings and
// takes the per-azimuth maximum with the other horizons. Contract:
// - which buildings count: surroundings.ts prismBuildings(buildings, dsmActive, ownBuildingIds(…));
// - footprints are anchor ENU (horizon.buildingImport); convert with enu.ts facadeTransform(anchor, location,
//   facadeAzimuth); tops at base + height above the site ground;
// - observer of floor k: placements[k].center (u = 0, n, z; moves with the tilt);
// - result: one profile per floor, step FLOOR_HORIZON_STEP_DEG (horizon.ts), or null when nothing applies.
// ─────────────────────────────────────────────

/**
 * Prism horizon per floor (index = floor) of config.horizon.buildings, or null when no building applies.
 * Placeholder of the foundation: returns null until the buildings feature implements the edge sweep.
 */
export function prismFloorHorizons(
  config: Config,
  placements: readonly FloorPlacement[],
  dsmActive: boolean,
): (HorizonProfile | null)[] | null {
  void config;
  void placements;
  void dsmActive;
  return null;
}
