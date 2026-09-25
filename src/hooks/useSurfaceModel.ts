import { useMemo } from 'react';
import type { Config } from '../model/types';
import { surfaceSiteKey } from '../model/dsmHorizon';
import { useConfigSection } from '../state/configStore';
import { useDataStore, type SurfaceData } from '../state/dataStore';
import { NO_SURROUNDINGS, type SurroundingsSource } from './useTerrain';

// ─────────────────────────────────────────────
// LASER-SCAN (swissSURFACE3D) HORIZON: LOADER AND READERS
// Owned by the laser-scan feature (docs/ARCHITECTURE.md, "Umgebung", file ownership). The foundation provides
// the readers the horizon pipeline and the UI use, and a no-op loader mounted in <DataLoader/>.
// ─────────────────────────────────────────────

/**
 * Loads the laser-scan horizons into dataStore.surface. Call exactly once (in <DataLoader/>).
 *
 * Placeholder of the foundation: does nothing (status stays 'idle', results use the prism fallback). The
 * laser-scan feature implements it: when horizon.surfaceModel.enabled, find the STAC items (CH/FL, else status
 * 'unavailable'), compute the DSM horizons of every floor's observer (surfaceObserverKey; the current tilt
 * first, the tilt-sweep tilts lazily) in the terrain worker for surfaceSiteKey(config), write progress, bytes,
 * dataYears, horizons and siteKey; retry on surfaceAttempt; set INITIAL_SURFACE when disabled.
 */
export function useSurfaceModelLoader(): void {
  // Intentionally empty (see above).
}

/** Pure form of useDsmActive: the scan is enabled and its loaded horizons belong to the config's site key. */
export function isDsmActive(
  config: Config,
  surface: Pick<SurfaceData, 'status' | 'siteKey' | 'horizons'>,
): boolean {
  return (
    config.horizon.surfaceModel.enabled &&
    surface.status === 'ready' &&
    surface.horizons !== null &&
    surface.siteKey === surfaceSiteKey(config)
  );
}

/**
 * dsmActive of the calculation rules (model/surroundings.ts): horizon.surfaceModel.enabled and the DSM
 * horizons are 'ready' for surfaceSiteKey(config). False while loading, after an error, outside coverage and
 * for horizons of another site/facade/mask (stale).
 */
export function useDsmActive(config: Config): boolean {
  const siteKey = useMemo(() => surfaceSiteKey(config), [config]);
  return useDataStore(
    (s) =>
      config.horizon.surfaceModel.enabled &&
      s.surface.status === 'ready' &&
      s.surface.horizons !== null &&
      s.surface.siteKey === siteKey,
  );
}

/** Surroundings input of floorHorizonsWithTerrain for `config` (stable identity while nothing changes). */
export function useSurroundingsSource(config: Config): SurroundingsSource {
  const active = useDsmActive(config);
  const horizons = useDataStore((s) => s.surface.horizons);
  return useMemo(() => (active && horizons ? { dsm: horizons } : NO_SURROUNDINGS), [active, horizons]);
}

/**
 * True while the enabled laser-scan horizon is still arriving (loading): annual results computed meanwhile use
 * the prism fallback and are provisional (useTerrainPending in hooks/useModel.ts includes it).
 */
export function useSurfacePending(): boolean {
  const enabled = useConfigSection('horizon').surfaceModel.enabled;
  const loading = useDataStore((s) => s.surface.status === 'loading');
  return enabled && loading;
}
