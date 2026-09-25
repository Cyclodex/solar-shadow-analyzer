import { useMemo } from 'react';
import type { Building, BuildingImport, HorizonConfig, Lang, LocationConfig } from '../../model/types';
import { buildingBearing, type BuildingBearing } from '../../model/buildings';
import { facadeTransform, type FacadeTransform } from '../../model/enu';
import type { Vertex } from '../../model/polygon';
import { ownBuildingIds } from '../../model/surroundings';
import type { Messages } from '../../i18n';
import { useConfigSection } from '../../state/configStore';

// ─────────────────────────────────────────────
// SURROUNDING BUILDINGS: SHARED UI HELPERS (buildings list, site plan)
// Display names and the site geometry (anchor ↔ facade frame, own building, where each building lies as
// seen from the balcony).
// ─────────────────────────────────────────────

const fallbackNames: Messages<(n: number) => string> = {
  de: (n) => `Gebäude ${n}`,
  en: (n) => `Building ${n}`,
};

/** Number shown for a building without a name: k of its id 'b<k>', else its position + 1. */
export function buildingNumber(building: Pick<Building, 'id'>, index: number): number {
  const m = /^b(\d+)$/.exec(building.id);
  return m ? Number(m[1]) : index + 1;
}

/** Display name: its own name, else "Gebäude k" (buildingNumber). */
export function buildingName(building: Pick<Building, 'id' | 'name'>, index: number, lang: Lang): string {
  return building.name || fallbackNames[lang](buildingNumber(building, index));
}

/** Unused id 'b<k>' (same scheme as sanitizeConfig and the import). */
export function newBuildingId(existing: readonly Pick<Building, 'id'>[]): string {
  const used = new Set(existing.map((b) => b.id));
  let k = existing.length + 1;
  while (used.has(`b${k}`)) k++;
  return `b${k}`;
}

/** Geometry of the site: the footprints' anchor seen from the location (facade origin). */
export interface SiteGeometry {
  anchor: BuildingImport | null;
  /** Anchor ENU ⇄ facade frame of the location; null without an anchor. */
  transform: FacadeTransform | null;
  /** The location (facade origin, balcony) in anchor ENU, m; null without an anchor. */
  origin: Vertex | null;
  /** Ids of the stored buildings that are the own building (surroundings.ts ownBuildingIds). */
  ownIds: ReadonlySet<string>;
}

/** Site geometry of a horizon config, location and facade azimuth. */
export function siteGeometry(
  horizon: Pick<HorizonConfig, 'buildings' | 'buildingImport'>,
  location: Pick<LocationConfig, 'latitude' | 'longitude'>,
  facadeAzimuth: number,
): SiteGeometry {
  const anchor = horizon.buildingImport;
  if (!anchor) return { anchor, transform: null, origin: null, ownIds: new Set() };
  const transform = facadeTransform(anchor, location, facadeAzimuth);
  return {
    anchor,
    transform,
    origin: transform.origin,
    ownIds: new Set(ownBuildingIds(horizon.buildings, anchor, location, facadeAzimuth)),
  };
}

/** siteGeometry of the current config (memoised on the config sections). */
export function useSiteGeometry(): SiteGeometry {
  const horizon = useConfigSection('horizon');
  const location = useConfigSection('location');
  const facadeAzimuth = useConfigSection('building').facadeAzimuth;
  return useMemo(() => siteGeometry(horizon, location, facadeAzimuth), [horizon, location, facadeAzimuth]);
}

/** Where a building lies as seen from the location (null without an anchor). */
export function bearingFromSite(
  building: Pick<Building, 'footprint'>,
  site: SiteGeometry,
): BuildingBearing | null {
  return site.origin ? buildingBearing(building.footprint, site.origin) : null;
}
