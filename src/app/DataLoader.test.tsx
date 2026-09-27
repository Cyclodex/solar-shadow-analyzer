import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetSurfaceLoader } from '../hooks/useSurfaceModel';
import { INITIAL_BUILDING_IMPORT, useBuildingImportStore } from '../state/buildingImportStore';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { DataLoader } from './DataLoader';

// The building import and the laser-scan loader are chunks of their own (docs/ARCHITECTURE.md "Laden und
// Rechenlast"): DataLoader loads them on demand.

describe('DataLoader', () => {
  beforeEach(() => {
    resetStores();
    resetSurfaceLoader();
    useBuildingImportStore.setState(INITIAL_BUILDING_IMPORT);
  });
  afterEach(() => useBuildingImportStore.setState(INITIAL_BUILDING_IMPORT));

  it('loads the building import with the first request of the address search, which it takes once', async () => {
    render(<DataLoader />);
    expect(useBuildingImportStore.getState().status).toBe('idle');
    act(() => useUiStore.getState().requestSurroundingsImport(46.947847, 7.449979));
    await waitFor(() => expect(useUiStore.getState().surroundingsImport).toBeNull());
    expect(useBuildingImportStore.getState().request).toMatchObject({
      latitude: 46.947847,
      longitude: 7.449979,
      reason: 'address',
    });
  });

  it('mounts the laser-scan loader once the scan is on, and it resets the state when switched off', async () => {
    render(<DataLoader />);
    const setScan = (enabled: boolean): void =>
      act(() =>
        useConfigStore.getState().patch('horizon', {
          surfaceModel: { ...useConfigStore.getState().config.horizon.surfaceModel, enabled },
        }),
      );
    expect(useDataStore.getState().surface.status).toBe('idle');
    setScan(true);
    await waitFor(() => expect(useDataStore.getState().surface.status).toBe('loading'));
    setScan(false);
    await waitFor(() => expect(useDataStore.getState().surface.status).toBe('idle'));
  });
});
