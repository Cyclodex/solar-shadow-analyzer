import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LocationConfig } from '../model/types';
import { useConfigStore } from './configStore';
import { safeJsonStorage } from './storage';
import { useUiStore } from './uiStore';

// ─────────────────────────────────────────────
// PICKED ADDRESS POINT (persisted: localStorage 'ssa.addressPoint')
// docs/ARCHITECTURE.md, "Integration": after an address pick the location is the address point, which lies
// inside the own building. Until the site plan places the balcony on a facade («Übernehmen») the laser scan
// must not compute from there (its horizon would be that building), whatever became of the building import:
// failed, cancelled, still running when the page was reloaded or closed. The point is kept here (not in the
// config, not in share links) while the location still is exactly that point; any other location (site plan,
// coordinates, search, preset, share link) clears it. `importPending`: the surroundings import of the pick has
// not settled yet; after a reload it is requested again (resumeAddressImport).
// ─────────────────────────────────────────────

export interface AddressPoint {
  /** WGS84 degrees of the picked address (1e-6), the location it set. */
  latitude: number;
  longitude: number;
  /** The building import of the pick has not finished, failed or been cancelled yet. */
  importPending: boolean;
}

interface AddressPointState {
  point: AddressPoint | null;
  /**
   * The address the stored buildings were last imported around (their anchor then); kept after «Übernehmen»,
   * so the site plan can call the anchor «Adresse» after a reload too.
   */
  anchor: { latitude: number; longitude: number } | null;
}

export const ADDRESS_POINT_STORAGE_KEY = 'ssa.addressPoint';

/** Location and point are the same (the config rounds to 1e-6°). */
const TOLERANCE_DEG = 2e-7;

function validPoint(v: unknown): AddressPoint | null {
  if (typeof v !== 'object' || v === null) return null;
  const p = v as Record<string, unknown>;
  if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return null;
  if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null;
  return { latitude: p.latitude, longitude: p.longitude, importPending: p.importPending === true };
}

export const useAddressPointStore = create<AddressPointState>()(
  persist((): AddressPointState => ({ point: null, anchor: null }), {
    name: ADDRESS_POINT_STORAGE_KEY,
    version: 1,
    storage: safeJsonStorage<AddressPointState>(),
    merge: (persisted, current) => {
      const p = persisted as Partial<AddressPointState> | null;
      const anchor = validPoint(p?.anchor);
      return {
        ...current,
        point: validPoint(p?.point),
        anchor: anchor && { latitude: anchor.latitude, longitude: anchor.longitude },
      };
    },
  }),
);

/** True while `location` is the stored address point (not yet placed on a facade). */
export function isAddressPoint(
  point: AddressPoint | null,
  location: Pick<LocationConfig, 'latitude' | 'longitude'>,
): point is AddressPoint {
  return (
    point !== null &&
    Math.abs(point.latitude - location.latitude) <= TOLERANCE_DEG &&
    Math.abs(point.longitude - location.longitude) <= TOLERANCE_DEG
  );
}

/** The location is a picked address point that the site plan has not placed on a facade yet. */
export function locationIsUnplacedAddress(
  location: Pick<LocationConfig, 'latitude' | 'longitude'> = useConfigStore.getState().config.location,
): boolean {
  return isAddressPoint(useAddressPointStore.getState().point, location);
}

/** Hook form of locationIsUnplacedAddress for the configured location. */
export function useUnplacedAddress(): AddressPoint | null {
  const point = useAddressPointStore((s) => s.point);
  const location = useConfigStore((s) => s.config.location);
  return isAddressPoint(point, location) ? point : null;
}

/** An address was picked: its point is the location now, and its surroundings import is requested. */
export function markAddressPoint(latitude: number, longitude: number): void {
  useAddressPointStore.setState({ point: { latitude, longitude, importPending: true } });
}

/** The surroundings import of the pick finished, failed or was cancelled (not requested again on reload). */
export function settleAddressImport(): void {
  const { point } = useAddressPointStore.getState();
  if (point?.importPending) useAddressPointStore.setState({ point: { ...point, importPending: false } });
}

/** The buildings of an address pick were stored around (latitude, longitude) (their anchor). */
export function rememberAddressAnchor(latitude: number, longitude: number): void {
  useAddressPointStore.setState({ anchor: { latitude, longitude } });
}

/** The anchor is the point of an address pick (not the location of «Gebäude laden»). */
export function isAddressAnchor(anchor: { latitude: number; longitude: number } | null): boolean {
  const a = useAddressPointStore.getState().anchor;
  return (
    a !== null &&
    anchor !== null &&
    Math.abs(a.latitude - anchor.latitude) <= TOLERANCE_DEG &&
    Math.abs(a.longitude - anchor.longitude) <= TOLERANCE_DEG
  );
}

/** The location left the address point (site plan «Übernehmen», or any other location). */
export function clearAddressPoint(): void {
  if (useAddressPointStore.getState().point) useAddressPointStore.setState({ point: null });
}

/** Requests the surroundings import of the unplaced address point again (after a failure or «Abbrechen»). */
export function retryAddressImport(): void {
  const { point } = useAddressPointStore.getState();
  if (!point || !locationIsUnplacedAddress()) return;
  useAddressPointStore.setState({ point: { ...point, importPending: true } });
  useUiStore.getState().requestSurroundingsImport(point.latitude, point.longitude);
}

/**
 * After a reload: a pick whose surroundings import had not settled (the page was reloaded or closed while it
 * ran) requests it again, while the location still is that address point. Returns whether it did.
 */
export function resumeAddressImport(): boolean {
  const { point } = useAddressPointStore.getState();
  if (!point?.importPending || !locationIsUnplacedAddress()) return false;
  useUiStore.getState().requestSurroundingsImport(point.latitude, point.longitude);
  return true;
}

// Any other location clears the point (also a share link or the stored config at start-up).
useConfigStore.subscribe((s, prev) => {
  if (s.config.location === prev.config.location) return;
  const { point } = useAddressPointStore.getState();
  if (point && !isAddressPoint(point, s.config.location)) clearAddressPoint();
});
