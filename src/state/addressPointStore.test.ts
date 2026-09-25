import { beforeEach, describe, expect, it } from 'vitest';
import { resetStores } from '../test/utils';
import {
  ADDRESS_POINT_STORAGE_KEY,
  clearAddressPoint,
  isAddressAnchor,
  locationIsUnplacedAddress,
  markAddressPoint,
  rememberAddressAnchor,
  resumeAddressImport,
  retryAddressImport,
  settleAddressImport,
  useAddressPointStore,
} from './addressPointStore';
import { useConfigStore } from './configStore';
import { useUiStore } from './uiStore';

const POINT = { latitude: 46.958474, longitude: 7.45363 };

function pick(): void {
  useConfigStore.getState().patch('location', { ...POINT, name: 'Breitenrainstrasse 10, 3013 Bern' });
  markAddressPoint(POINT.latitude, POINT.longitude);
}

describe('address point', () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
  });

  it('marks the picked point until the location moves, and persists it', () => {
    pick();
    expect(locationIsUnplacedAddress()).toBe(true);
    const stored = JSON.parse(localStorage.getItem(ADDRESS_POINT_STORAGE_KEY) ?? '{}') as {
      state: { point: unknown };
    };
    expect(stored.state.point).toEqual({ ...POINT, importPending: true });
    // Another name at the same point keeps it; another location (site plan, coordinates) clears it.
    useConfigStore.getState().patch('location', { name: 'Zuhause' });
    expect(locationIsUnplacedAddress()).toBe(true);
    useConfigStore.getState().patch('location', { latitude: POINT.latitude + 2e-5 });
    expect(useAddressPointStore.getState().point).toBeNull();
    expect(locationIsUnplacedAddress()).toBe(false);
  });

  it('after a reload an unsettled import is requested again, a settled one is not', () => {
    pick();
    expect(resumeAddressImport()).toBe(true);
    expect(useUiStore.getState().surroundingsImport).toMatchObject(POINT);
    useUiStore.getState().consumeSurroundingsImport();
    settleAddressImport();
    expect(resumeAddressImport()).toBe(false);
    expect(useUiStore.getState().surroundingsImport).toBeNull();
    // «Erneut versuchen» / «Gebäude laden» of the prompt asks again.
    retryAddressImport();
    expect(useAddressPointStore.getState().point?.importPending).toBe(true);
    expect(useUiStore.getState().surroundingsImport).toMatchObject(POINT);
    clearAddressPoint();
    expect(resumeAddressImport()).toBe(false);
  });

  it('remembers the anchor of an address import (the site plan marks it as the address)', () => {
    expect(isAddressAnchor(POINT)).toBe(false);
    rememberAddressAnchor(POINT.latitude, POINT.longitude);
    expect(isAddressAnchor(POINT)).toBe(true);
    expect(isAddressAnchor({ latitude: POINT.latitude + 1e-4, longitude: POINT.longitude })).toBe(false);
    expect(isAddressAnchor(null)).toBe(false);
  });
});
