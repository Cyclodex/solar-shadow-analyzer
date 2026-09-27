import { anchorDistance, OTHER_SITE_DISTANCE } from '../../model/buildings';
import { useUnplacedAddress } from '../../state/addressPointStore';
import { requestSitePlan, useBuildingImportStore } from '../../state/buildingImportStore';
import { useConfigSection } from '../../state/configStore';
import { useDataStore } from '../../state/dataStore';

// What the location's placement on a facade needs now (PlacementPrompt.tsx shows it).

/** What the location's placement needs now. */
export type PlacementNeed =
  /** Nothing: the location is placed (or no address was picked). */
  | 'none'
  /** The building import of the pick is running (the site plan opens after it). */
  | 'loading'
  /** Buildings are stored: confirm facade and balcony in the site plan. */
  | 'plan'
  /** The import failed: no buildings to place the balcony on. */
  | 'failed'
  /** No buildings (import cancelled, or they belong to another site). */
  | 'missing';

/**
 * The placement state of the location: an unplaced address point (addressPointStore) or a location inside its
 * building (laser scan 'waiting'), with what the user can do about it.
 */
export function usePlacementNeed(): PlacementNeed {
  const unplaced = useUnplacedAddress() !== null;
  const waiting = useDataStore((s) => s.surface.status === 'waiting');
  const importing = useBuildingImportStore(
    (s) => s.status === 'loading' || (s.pendingConfirm !== null && s.pendingConfirm.reason === 'address'),
  );
  const failed = useBuildingImportStore((s) => s.status === 'error');
  const { buildings, buildingImport } = useConfigSection('horizon');
  const location = useConfigSection('location');
  if (!unplaced && !waiting) return 'none';
  const site =
    buildingImport !== null &&
    buildings.some((b) => !b.removed) &&
    anchorDistance(buildingImport, location) <= OTHER_SITE_DISTANCE;
  if (site) return 'plan';
  if (importing) return 'loading';
  return failed ? 'failed' : 'missing';
}

/** Opens the «Gebäude» section and the site plan with its instructions, and moves the focus there. */
export function goToSitePlan(): void {
  requestSitePlan('address');
}
