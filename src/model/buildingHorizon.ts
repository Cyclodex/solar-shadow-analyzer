import type { Building, Config, FloorPlacement, HorizonProfile } from './types';
import { clipRingAbove, facadePrisms, prismHorizonTangents, tanToDeg, type Prism } from './buildings';
import { facadeTransform, type FacadeTransform } from './enu';
import { FLOOR_HORIZON_STEP_DEG } from './horizon';
import { segmentDistance, type ReadonlyVertex } from './polygon';
import { OWN_BUILDING_EXCLUSION, ownBuildingIds, ownExclusionZone, prismBuildings } from './surroundings';
import { cmToM } from './units';

// ─────────────────────────────────────────────
// PRISM HORIZON OF THE SURROUNDING BUILDINGS
// Owned by the buildings feature (docs/ARCHITECTURE.md, "Umgebung", file ownership). The horizon pipeline
// (hooks/useTerrain.ts floorHorizonsWithTerrain) calls prismFloorHorizons for every config with buildings and
// takes the per-azimuth maximum with the other horizons. Contract:
// - which buildings count: surroundings.ts prismBuildings(buildings, dsmActive); the own building
//   (ownBuildingIds) only with the part the laser scan also keeps (see ownPrismPieces);
// - footprints are anchor ENU (horizon.buildingImport); convert with enu.ts facadeTransform(anchor, location,
//   facadeAzimuth); tops at base + height above the site ground;
// - observer of floor k: placements[k].center (u = 0, n, z; moves with the tilt);
// - result: one profile per floor, step FLOOR_HORIZON_STEP_DEG (horizon.ts), or null when nothing applies.
// The edge sweep (model/buildings.ts prismHorizonTangents) handles all floors of an observer position in one
// pass. The tilt sweep calls this once per tilt with the same buildings: the facade-frame prisms are kept for
// the last buildings list, anchor, location, facade, balcony depth and dsmActive (one entry).
// ─────────────────────────────────────────────

/**
 * The location counts as on a wall of the own building when it is at most this far from the footprint's
 * outline (m): after «Übernehmen» in the site plan it lies on the facade line (≤ 0.07 m after rounding).
 */
export const OWN_WALL_TOLERANCE_M = OWN_BUILDING_EXCLUSION.behindFacadeN;

interface PrismMemo {
  buildings: readonly Building[];
  key: string;
  prisms: Prism[];
}

let memo: PrismMemo | null = null;

/** Distance of a point from a ring's outline (m; also for points inside, unlike ringDistance). */
function outlineDistance(ring: readonly ReadonlyVertex[], x: number, y: number): number {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    d = Math.min(d, segmentDistance(x, y, ring[j], ring[i]));
  }
  return d;
}

const flatRing = (ring: readonly ReadonlyVertex[]): Float64Array => {
  const out = new Float64Array(ring.length * 2);
  ring.forEach(([u, n], k) => {
    out[2 * k] = u;
    out[2 * k + 1] = n;
  });
  return out;
};

/**
 * Prisms of an own building (footprint containing the probe behind the facade origin), the same part the
 * laser scan keeps (surroundings.ts isOwnBuildingCell): its footprint in front of the balcony zone,
 * n > balconyDepth + 0.5 m (the zone spans the own footprint along the facade, so nothing beside it stays).
 * A wing or annex of the same part in front of the facade shades, like a separate part would. Only while the
 * location lies on its wall (site plan applied): the address point inside the building would put the whole
 * front of it into the horizon, so until then the own building does not count at all (as before).
 */
function ownPrismPieces(building: Building, transform: FacadeTransform, balconyDepthM: number): Prism[] {
  const [ox, oy] = transform.origin;
  if (!(outlineDistance(building.footprint, ox, oy) <= OWN_WALL_TOLERANCE_M)) return [];
  const ring = building.footprint.map((p) => transform.toFacade(p));
  // The row width only bounds the zone when no own footprint is known; here it always is.
  const zone = ownExclusionZone(balconyDepthM, 0, ring);
  const top = building.base + building.height;
  return clipRingAbove(ring, Math.max(zone.behindN, zone.balconyN)).map((piece) => ({
    ring: flatRing(piece),
    top,
  }));
}

/** Facade-frame prisms of the buildings that count for `config` (see the contract above). */
function countedPrisms(config: Config, dsmActive: boolean): Prism[] {
  const { buildings, buildingImport: anchor } = config.horizon;
  if (!anchor || buildings.length === 0) return [];
  const { location } = config;
  const facadeAzimuth = config.building.facadeAzimuth;
  const balconyDepthM = cmToM(config.building.balconyDepth);
  const key = [
    anchor.latitude,
    anchor.longitude,
    location.latitude,
    location.longitude,
    facadeAzimuth,
    balconyDepthM,
    dsmActive ? 1 : 0,
  ].join('|');
  if (memo && memo.buildings === buildings && memo.key === key) return memo.prisms;
  const own = new Set(ownBuildingIds(buildings, anchor, location, facadeAzimuth));
  const transform = facadeTransform(anchor, location, facadeAzimuth);
  const counted = prismBuildings(buildings, dsmActive);
  const prisms = facadePrisms(
    counted.filter((b) => !own.has(b.id)),
    transform,
  );
  for (const b of counted) if (own.has(b.id)) prisms.push(...ownPrismPieces(b, transform, balconyDepthM));
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
