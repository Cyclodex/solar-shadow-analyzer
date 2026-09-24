import { useCallback } from 'react';
import { terrainObserverHeight } from '../../hooks/useTerrain';
import { fetchTerrainHorizon } from '../../model/terrain';
import type { Config } from '../../model/types';
import { useConfigStore } from '../../state/configStore';
import { useDataStore } from '../../state/dataStore';

/** Request key of the terrain loader: a result only applies while the config still asks for it. */
function terrainRequest(config: Config): string | null {
  if (!config.horizon.terrainEnabled) return null;
  const { latitude, longitude } = config.location;
  return `${latitude},${longitude},${terrainObserverHeight(config)}`;
}

/**
 * Retries a failed terrain horizon download for the current config (same request as useTerrainLoader)
 * and writes progress/result into dataStore.terrain. The result is dropped when the location, the
 * observer height or the terrain toggle changed in the meantime: the loader then owns the state again.
 * Not tied to the component's lifetime, so collapsing the section does not leave a stale 'loading' state.
 */
export function useTerrainRetry(): () => void {
  return useCallback(() => {
    const config = useConfigStore.getState().config;
    const request = terrainRequest(config);
    if (request === null) return;
    const current = (): boolean => terrainRequest(useConfigStore.getState().config) === request;
    const { setTerrain } = useDataStore.getState();
    setTerrain({ status: 'loading', progress: 0, profile: null, siteElevation: null, error: null });
    fetchTerrainHorizon(config.location.latitude, config.location.longitude, {
      observerHeight: terrainObserverHeight(config),
      onProgress: (done, total) => {
        if (current()) setTerrain({ progress: total > 0 ? done / total : 0 });
      },
    }).then(
      (r) => {
        if (!current()) return;
        setTerrain({
          status: 'ready',
          progress: 1,
          profile: r.profile,
          siteElevation: r.siteElevation,
          error: null,
        });
      },
      (e: unknown) => {
        if (!current()) return;
        setTerrain({
          status: 'error',
          profile: null,
          siteElevation: null,
          error: e instanceof Error ? e.message : String(e),
        });
      },
    );
  }, []);
}
