import { lazy, Suspense, useEffect, useState } from 'react';
import { useTerrainLoader } from '../hooks/useTerrain';
import { useWeatherLoader } from '../hooks/useWeather';
import { useBuildingImportStore } from '../state/buildingImportStore';
import { useConfigSection } from '../state/configStore';
import { useUiStore } from '../state/uiStore';

// The laser-scan loader (computations, downloads, result cache) is a chunk of its own: it loads the first
// time the scan is on in this session and then stays mounted (it resets dataStore.surface when switched off).
const SurfaceModelLoader = lazy(() =>
  import('../hooks/surfaceModelLoader').then((m) => ({ default: m.SurfaceModelLoader })),
);

/**
 * The building import after an address pick (hooks/useBuildingImport.ts, a chunk of its own): loaded with the
 * first request of the address search, which it takes from uiStore.surroundingsImport. Until then the request
 * stays there (the laser-scan download waits for it, surfaceModelLoader.ts). A module that cannot load
 * (offline right after a new deployment) ends the request as a failed import.
 */
function useBuildingImportTrigger(): void {
  useEffect(() => {
    const load = (): void => {
      import('../hooks/useBuildingImport').then(
        (m) => m.takeSurroundingsImport(),
        (e: unknown) => {
          if (!useUiStore.getState().consumeSurroundingsImport()) return;
          useBuildingImportStore.setState({
            status: 'error',
            progress: null,
            error: { kind: 'network', message: e instanceof Error ? e.message : String(e) },
          });
        },
      );
    };
    if (useUiStore.getState().surroundingsImport) load();
    return useUiStore.subscribe((s, prev) => {
      if (s.surroundingsImport && s.surroundingsImport !== prev.surroundingsImport) load();
    });
  }, []);
}

/**
 * Runs the network loaders (terrain horizon, weather year, laser-scan horizon) and the building import after
 * an address pick once for the whole app. Renders nothing.
 */
export function DataLoader() {
  useTerrainLoader();
  useWeatherLoader();
  useBuildingImportTrigger();
  const surfaceOn = useConfigSection('horizon').surfaceModel.enabled;
  const [surfaceUsed, setSurfaceUsed] = useState(surfaceOn);
  // Set during render (not in an effect): the loader mounts in the same commit.
  if (surfaceOn && !surfaceUsed) setSurfaceUsed(true);
  return surfaceUsed ? (
    <Suspense fallback={null}>
      <SurfaceModelLoader />
    </Suspense>
  ) : null;
}
