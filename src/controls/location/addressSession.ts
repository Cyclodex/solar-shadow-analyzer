import { create } from 'zustand';
import { LIMITS } from '../../model/defaults';
import type { BuildingInfo, GeoErrorKind, SwissAddress } from '../../model/geocode';
import { withGeocode } from '../../model/geocodeLazy';
import { wgs84ToLv95 } from '../../model/lv95';
import type { LocationConfig } from '../../model/types';
import { useConfigStore } from '../../state/configStore';
import { useUiStore } from '../../state/uiStore';

// ─────────────────────────────────────────────
// PICKED ADDRESS (session only, not persisted)
// applyAddress() is what picking an address does, from the search or «Nächste Adresse übernehmen»
// (docs/ARCHITECTURE.md, "Ablauf nach einer Adresswahl"): location = the address (label, 1e-6°, Europe/Zurich or
// Europe/Vaduz), laser scan on (trees unchanged), surroundings import requested; then, in the background, the
// ground height (→ location.elevation; kept when the height service fails) and the building register record for
// the read-only building block. Nothing of it is stored in the config: after a reload the block is gone
// (fetching it again would be a request without a user action).
// ─────────────────────────────────────────────

export type BuildingInfoState =
  | { status: 'loading' }
  | { status: 'ready'; info: BuildingInfo | null }
  | { status: 'error'; error: GeoErrorKind };

export interface AddressSession {
  /** The address picked last in this session, null before. */
  address: SwissAddress | null;
  building: BuildingInfoState;
}

export const INITIAL_ADDRESS_SESSION: AddressSession = { address: null, building: { status: 'loading' } };

export const useAddressSession = create<AddressSession>()(() => INITIAL_ADDRESS_SESSION);

/**
 * How far (m) the location may move from the picked entrance and still belong to the address: the site plan
 * moves it onto the facade of the own building, which lies within the laser-scan radius (≤ 500 m).
 */
export const ADDRESS_MATCH_RADIUS = LIMITS.surfaceModel.radius.max;

/**
 * The location still is the picked address: same name (the label) and within ADDRESS_MATCH_RADIUS of its
 * entrance (compared in LV95, where the address point comes from).
 */
export function addressMatchesLocation(
  address: SwissAddress,
  location: Pick<LocationConfig, 'name' | 'latitude' | 'longitude'>,
): boolean {
  if (location.name !== address.label) return false;
  const p = wgs84ToLv95(location.latitude, location.longitude);
  return Math.hypot(p.east - address.lv95.east, p.north - address.lv95.north) <= ADDRESS_MATCH_RADIUS;
}

/** Requests of the current pick: ground height and building register (a retry replaces only the latter). */
let heightRequest: AbortController | null = null;
let buildingRequest: AbortController | null = null;

function loadBuilding(address: SwissAddress): void {
  buildingRequest?.abort();
  const ctrl = new AbortController();
  buildingRequest = ctrl;
  useAddressSession.setState({ building: { status: 'loading' } });
  void withGeocode((m) => m.fetchBuildingInfo(address.featureId, { signal: ctrl.signal })).then((res) => {
    if (ctrl.signal.aborted || useAddressSession.getState().address !== address) return;
    useAddressSession.setState({
      building: res.ok ? { status: 'ready', info: res.value } : { status: 'error', error: res.error.kind },
    });
  });
}

/**
 * Applies a picked address: location, laser scan on, surroundings import; then height and building register in
 * the background (an earlier pick's requests are aborted).
 */
export function applyAddress(address: SwissAddress): void {
  const { patch } = useConfigStore.getState();
  patch('location', {
    name: address.label,
    latitude: address.latitude,
    longitude: address.longitude,
    timezone: address.timezone,
  });
  const { surfaceModel } = useConfigStore.getState().config.horizon;
  patch('horizon', { surfaceModel: { ...surfaceModel, enabled: true } });
  useUiStore.getState().requestSurroundingsImport(address.latitude, address.longitude);

  heightRequest?.abort();
  const ctrl = new AbortController();
  heightRequest = ctrl;
  useAddressSession.setState({ address });
  loadBuilding(address);
  void withGeocode((m) => m.fetchGroundHeight(address.lv95, { signal: ctrl.signal })).then((res) => {
    if (!res.ok || ctrl.signal.aborted || useAddressSession.getState().address !== address) return;
    const { location } = useConfigStore.getState().config;
    if (addressMatchesLocation(address, location)) {
      useConfigStore.getState().patch('location', { elevation: Math.round(res.value) });
    }
  });
}

/** Asks the building register again after an error (button in the building block). */
export function retryBuildingInfo(): void {
  const { address } = useAddressSession.getState();
  if (address) loadBuilding(address);
}

/** Aborts running requests and forgets the address (tests). */
export function resetAddressSession(): void {
  heightRequest?.abort();
  buildingRequest?.abort();
  heightRequest = null;
  buildingRequest = null;
  useAddressSession.setState(INITIAL_ADDRESS_SESSION);
}
