import type { Building, Config, FloorPlacement, HorizonProfile } from './types';
import { facadePrisms, prismHorizonTangents, tanToDeg, type Prism } from './buildings';
import { facadeTransform } from './enu';
import { FLOOR_HORIZON_STEP_DEG } from './horizon';
import { ownBuildingIds, prismBuildings } from './surroundings';

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
// The edge sweep (model/buildings.ts prismHorizonTangents) handles all floors of an observer position in one
// pass. The tilt sweep calls this once per tilt with the same buildings: the facade-frame prisms are kept for
// the last buildings list, anchor, location, facade and dsmActive (one entry).
// ─────────────────────────────────────────────

interface PrismMemo {
  buildings: readonly Building[];
  key: string;
  prisms: Prism[];
}

let memo: PrismMemo | null = null;

/** Facade-frame prisms of the buildings that count for `config` (see the contract above). */
function countedPrisms(config: Config, dsmActive: boolean): Prism[] {
  const { buildings, buildingImport: anchor } = config.horizon;
  if (!anchor || buildings.length === 0) return [];
  const { location } = config;
  const facadeAzimuth = config.building.facadeAzimuth;
  const key = [
    anchor.latitude,
    anchor.longitude,
    location.latitude,
    location.longitude,
    facadeAzimuth,
    dsmActive ? 1 : 0,
  ].join('|');
  if (memo && memo.buildings === buildings && memo.key === key) return memo.prisms;
  const own = ownBuildingIds(buildings, anchor, location, facadeAzimuth);
  const counted = prismBuildings(buildings, dsmActive, own);
  const prisms = facadePrisms(counted, facadeTransform(anchor, location, facadeAzimuth));
  memo = { buildings, key, prisms };
  return prisms;
}

/**
 * Prism horizon per floor (index = floor) of config.horizon.buildings, or null when no building applies (no
 * anchor, none counted, or none rises above any floor's panel centre). Every flat-topped prism counts as
 * closed down to the ground: a horizon profile has no gaps (a base above the observer only raises the top).
 * Floors sharing an observer position (u, n) are computed in one sweep.
 */
export function prismFloorHorizons(
  config: Config,
  placements: readonly FloorPlacement[],
  dsmActive: boolean,
): (HorizonProfile | null)[] | null {
  if (placements.length === 0) return null;
  const prisms = countedPrisms(config, dsmActive);
  if (prisms.length === 0) return null;
  const facadeAzimuth = config.building.facadeAzimuth;
  const out: (HorizonProfile | null)[] = placements.map(() => null);
  const groups = new Map<string, number[]>();
  placements.forEach((p, k) => {
    const g = `${p.center.u}|${p.center.n}`;
    groups.set(g, [...(groups.get(g) ?? []), k]);
  });
  let any = false;
  for (const floors of groups.values()) {
    const { u, n } = placements[floors[0]].center;
    const tangents = prismHorizonTangents(
      prisms,
      { u, n },
      floors.map((k) => placements[k].center.z),
      facadeAzimuth,
      { stepDeg: FLOOR_HORIZON_STEP_DEG },
    );
    floors.forEach((k, h) => {
      const row = tangents[h];
      const elevations = new Array<number>(row.length);
      for (let i = 0; i < row.length; i++) {
        elevations[i] = tanToDeg(row[i]);
        if (elevations[i] > 0) any = true;
      }
      out[k] = { stepDeg: 360 / row.length, elevations };
    });
  }
  return any ? out : null;
}

/** Forgets the memoised prisms (tests). */
export function clearPrismHorizonMemo(): void {
  memo = null;
}
