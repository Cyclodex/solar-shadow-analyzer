import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { HorizonProfile } from '../../model/types';
import { useConfigStore } from '../../state/configStore';
import { useDataStore } from '../../state/dataStore';
import { useUiStore } from '../../state/uiStore';
import { resetStores } from '../../test/utils';
import { useSceneData } from './useSceneData';

/** Flat terrain profile of `deg` degrees (1° step). */
const flat = (deg: number): HorizonProfile => ({ stepDeg: 1, elevations: new Array<number>(360).fill(deg) });

describe('useSceneData', () => {
  beforeEach(() => {
    resetStores();
    useConfigStore.getState().patch('horizon', { terrainEnabled: true });
  });

  it('shows the terrain horizon seen from the focus floor', () => {
    // Rail tops 3.8 m, 6.6 m, 9.4 m → observer heights 4, 7 and 9 m.
    useConfigStore.getState().patch('building', { numFloors: 3 });
    useDataStore
      .getState()
      .setTerrain({ status: 'ready', profile: flat(6), profiles: { 4: flat(6), 7: flat(5), 9: flat(4) } });
    const { result } = renderHook(() => useSceneData());
    expect(result.current.observerHeight).toBe(4);
    expect(result.current.farHorizon?.elevations[0]).toBe(6);

    act(() => useUiStore.getState().setFocusFloor(2));
    expect(result.current.observerHeight).toBe(9);
    expect(result.current.farHorizon?.elevations[0]).toBe(4);
  });
});
