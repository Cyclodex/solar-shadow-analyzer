import type { Config, FacadeVector, FloorPlacement, HorizonProfile } from './types';
import { panelLayout } from './geometry';
import { dsmMaskPolygons } from './surroundings';

// ─────────────────────────────────────────────
// LASER-SCAN (swissSURFACE3D DSM) HORIZON: KEYS AND LOOKUP
// Owned by the laser-scan feature (docs/ARCHITECTURE.md, "Umgebung", file ownership). The foundation defines
// the contract used by the horizon pipeline (hooks/useTerrain.ts floorHorizonsWithTerrain):
// - dataStore.surface.horizons holds one HorizonProfile per observer (surfaceObserverKey of a floor's panel
//   centre, which moves with the tilt), computed in the terrain worker for dataStore.surface.siteKey;
// - surfaceSiteKey(config) names everything else the horizons depend on; hooks/useSurfaceModel.ts useDsmActive
//   compares it with the loaded key;
// - dsmFloorHorizons picks each floor's profile (exact key, else the nearest observer: a tilt still computing).
// ─────────────────────────────────────────────

/** Laser-scan horizons per observer key (surfaceObserverKey). */
export type SurfaceHorizons = Readonly<Record<string, HorizonProfile>>;

/**
 * Key of a DSM observer: the panel-row centre of a floor in the facade frame (u = 0), n and z in m rounded to
 * 1 cm, e.g. '1.93:5.17'.
 */
export function surfaceObserverKey(center: Pick<FacadeVector, 'n' | 'z'>): string {
  return `${center.n.toFixed(2)}:${center.z.toFixed(2)}`;
}

function parseObserverKey(key: string): { n: number; z: number } | null {
  const [n, z] = key.split(':').map(Number);
  return Number.isFinite(n) && Number.isFinite(z) ? { n: n!, z: z! } : null;
}

/** FNV-1a 32-bit hash as 8 hex digits (compact cache keys, not security). */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Everything the DSM horizons depend on besides the observer points: site (1e-6°), facade azimuth, balcony
 * depth and row width (own-building exclusion), trees and radius, and the masked footprints (removed/edited
 * buildings with their anchor). Horizons loaded for another key are stale (useDsmActive → false).
 */
export function surfaceSiteKey(config: Config): string {
  const { location, building, horizon } = config;
  const { trees, radius } = horizon.surfaceModel;
  const masks = dsmMaskPolygons(horizon.buildings);
  const anchor = horizon.buildingImport;
  const maskKey =
    masks.length > 0 && anchor ? hashString(JSON.stringify([anchor.latitude, anchor.longitude, masks])) : '-';
  const rowWidth = Math.round(panelLayout(config).rowWidth * 10) / 10;
  return [
    location.latitude.toFixed(6),
    location.longitude.toFixed(6),
    building.facadeAzimuth,
    building.balconyDepth,
    rowWidth,
    trees ? 't' : 'b',
    radius,
    maskKey,
  ].join('|');
}

/**
 * The DSM horizon of each floor (index = floor): the profile of its observer key, else the one of the nearest
 * observer (n, z distance; a new tilt is still being computed), else null (no horizons).
 */
export function dsmFloorHorizons(
  horizons: SurfaceHorizons,
  placements: readonly Pick<FloorPlacement, 'center'>[],
): (HorizonProfile | null)[] {
  const entries = Object.entries(horizons)
    .map(([key, profile]) => ({ at: parseObserverKey(key), profile }))
    .filter((e): e is { at: { n: number; z: number }; profile: HorizonProfile } => e.at !== null);
  return placements.map((p) => {
    const exact = horizons[surfaceObserverKey(p.center)];
    if (exact) return exact;
    let best: HorizonProfile | null = null;
    let bestD = Infinity;
    for (const e of entries) {
      const d = Math.hypot(e.at.n - p.center.n, e.at.z - p.center.z);
      if (d < bestD) {
        bestD = d;
        best = e.profile;
      }
    }
    return best;
  });
}
