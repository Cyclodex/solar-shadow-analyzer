import { useEffect, useRef } from 'react';
import { fetchTerrainHorizon } from '../model/terrain';
import { floorPlacements } from '../model/geometry';
import { useConfig } from '../state/configStore';
import { useDataStore, INITIAL_TERRAIN, type TerrainData } from '../state/dataStore';

// ─────────────────────────────────────────────
// TERRAIN HORIZON LOADER
// Fetches the DEM terrain horizon (model/terrain.ts) when config.horizon.terrainEnabled, debounced on
// location changes, and writes status/progress/result into dataStore.terrain. Mount once (DataLoader).
// ─────────────────────────────────────────────

/** Delay after the last location change before downloading tiles. */
export const TERRAIN_DEBOUNCE_MS = 800;

/**
 * Observer height above ground for the terrain horizon: top edge of the lowest panel row
 * (slab + railing, independent of the tilt so that tilting never refetches), rounded to 1 m.
 */
export function terrainObserverHeight(config: Parameters<typeof floorPlacements>[0]): number {
  const lowest = floorPlacements(config)[0];
  return Math.max(1, Math.round(lowest?.railTopZ ?? 1));
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Loads the terrain horizon into dataStore. Call exactly once (in <DataLoader/>). */
export function useTerrainLoader(): void {
  const config = useConfig();
  const enabled = config.horizon.terrainEnabled;
  const { latitude, longitude } = config.location;
  const observerHeight = terrainObserverHeight(config);
  /** Site of the previous run: only a *changed* site is debounced (first load and re-enabling are immediate). */
  const lastSite = useRef<string | null>(null);

  useEffect(() => {
    const { setTerrain } = useDataStore.getState();
    if (!enabled) {
      setTerrain(INITIAL_TERRAIN);
      return;
    }
    const site = `${latitude},${longitude},${observerHeight}`;
    const delay = lastSite.current === null || lastSite.current === site ? 0 : TERRAIN_DEBOUNCE_MS;
    lastSite.current = site;
    const ctrl = new AbortController();
    // The old profile belongs to another site: drop it instead of computing with a wrong horizon.
    setTerrain({ status: 'loading', progress: 0, profile: null, siteElevation: null, error: null });
    const timer = setTimeout(() => {
      fetchTerrainHorizon(latitude, longitude, {
        signal: ctrl.signal,
        observerHeight,
        onProgress: (done, total) => {
          if (!ctrl.signal.aborted) setTerrain({ progress: total > 0 ? done / total : 0 });
        },
      }).then(
        (r) => {
          if (ctrl.signal.aborted) return;
          setTerrain({
            status: 'ready',
            progress: 1,
            profile: r.profile,
            siteElevation: r.siteElevation,
            error: null,
          });
        },
        (e: unknown) => {
          if (ctrl.signal.aborted) return;
          setTerrain({ status: 'error', profile: null, siteElevation: null, error: errorMessage(e) });
        },
      );
    }, delay);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [enabled, latitude, longitude, observerHeight]);
}

/** Terrain load state (status, progress, profile, error). */
export function useTerrain(): TerrainData {
  return useDataStore((s) => s.terrain);
}
