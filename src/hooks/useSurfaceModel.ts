import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { Config } from '../model/types';
import { surfaceObserverKey, surfaceSiteKey } from '../model/dsmHorizon';
import { floorPlacements } from '../model/geometry';
import { useConfig, useConfigSection } from '../state/configStore';
import { useDataStore, type SurfaceData } from '../state/dataStore';
import { NO_SURROUNDINGS, type SurroundingsSource } from './useTerrain';

// ─────────────────────────────────────────────
// LASER-SCAN (swissSURFACE3D) HORIZON: READERS
// docs/ARCHITECTURE.md, "Umgebung: Adresse, Laserscan, Gebäude". What the results read of dataStore.surface
// (dsmActive, the surroundings source, pending and provisional states) and the loader's own small state store.
// The loader itself (computations, downloads, result cache) is hooks/surfaceModelLoader.ts, a chunk of its own.
// ─────────────────────────────────────────────

/** A download for new observers while the site's horizons stay shown ('ready'), or its failure. */
export type SurfaceRefresh =
  { status: 'loading'; progress: number; bytes: number } | { status: 'error'; error: string };

interface SurfaceLocalState {
  /** jobKey of the horizons in dataStore.surface (null when none). */
  jobKey: string | null;
  /** The tilt-sweep observers are being computed. */
  sweepPending: boolean;
  /** Data key whose download a memory-only job asked for (the download effect runs it), null when none. */
  wanted: string | null;
  /** Data key being downloaded, null when none. */
  downloading: string | null;
  /** Data key of the last download that finished. */
  loadedKey: string | null;
  /** Bumped when a download finished: the computations run again, from the worker's memory. */
  loaded: number;
  /** Download for new observers of the shown site, or its failure (null when none). */
  refresh: SurfaceRefresh | null;
}

const LOCAL_INITIAL: SurfaceLocalState = {
  jobKey: null,
  sweepPending: false,
  wanted: null,
  downloading: null,
  loadedKey: null,
  loaded: 0,
  refresh: null,
};

/** Loader state beyond dataStore.surface (module store of this hook). */
export const useSurfaceLocal = create<SurfaceLocalState>()(() => LOCAL_INITIAL);

/** Resets the loader's own state (tests). */
export function resetSurfaceLoader(): void {
  useSurfaceLocal.setState(LOCAL_INITIAL);
}

/** Sweep horizons computed longer than this are shown as pending (a fast sweep does not flash a hint). */
export const SURFACE_SWEEP_HINT_DELAY_MS = 1500;

/**
 * True once the horizons of the tilt-sweep tilts have been computing in the background for
 * SURFACE_SWEEP_HINT_DELAY_MS: until they arrive the sweep uses the nearest tilt's horizon (approximate).
 */
export function useSurfaceSweepPending(): boolean {
  const enabled = useConfigSection('horizon').surfaceModel.enabled;
  const active = useSurfaceLocal((s) => s.sweepPending) && enabled;
  const [held, setHeld] = useState(false);
  // Reset during render (not in an effect): the next activation waits again.
  if (!active && held) setHeld(false);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setHeld(true), SURFACE_SWEEP_HINT_DELAY_MS);
    return () => clearTimeout(id);
  }, [active]);
  return active && held;
}

// ── Readers ──────────────────────────────────

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
 * The download of the shown site's data for new observers (progress), or its failure; null when none (also
 * while the scan is off or not 'ready': then dataStore.surface has the state).
 */
export function useSurfaceRefresh(): SurfaceRefresh | null {
  const enabled = useConfigSection('horizon').surfaceModel.enabled;
  const ready = useDataStore((s) => s.surface.status === 'ready');
  const refresh = useSurfaceLocal((s) => s.refresh);
  return enabled && ready ? refresh : null;
}

/**
 * True while the laser-scan horizon of the annual results is still arriving: the enabled scan loads, its data
 * is downloaded again for current observers that have no horizon of their own yet (useSurfaceRefresh; the
 * nearest observer stands in), or newly arrived horizons have not reached the deferred annual results yet
 * (same deferral as useDeferredInputs in hooks/useModel.ts). Results computed meanwhile use the prism fallback
 * or the nearest observer and are provisional (useTerrainPending includes this).
 */
export function useSurfacePending(): boolean {
  const config = useConfig();
  const enabled = config.horizon.surfaceModel.enabled;
  const loading = useDataStore((s) => s.surface.status === 'loading');
  const refreshing = useSurfaceRefresh()?.status === 'loading';
  const horizons = useDataStore((s) => s.surface.horizons);
  const lacking =
    refreshing &&
    horizons !== null &&
    floorPlacements(config).some((p) => !horizons[surfaceObserverKey(p.center)]);
  const source = useSurroundingsSource(config);
  const deferred = useDeferredValue(source);
  return (enabled && (loading || lacking)) || deferred !== source;
}

/** What keeps provisional results provisional: the terrain horizon, the laser scan, or both (hints). */
export type ProvisionalCause = 'terrain' | 'surface' | 'both';

/**
 * Cause for the "vorläufig" hints: the laser scan while it loads (useSurfacePending), the terrain horizon
 * otherwise (also for the moment a newly arrived terrain horizon needs to reach the deferred results).
 */
export function useProvisionalCause(): ProvisionalCause {
  const surface = useSurfacePending();
  const terrainEnabled = useConfigSection('horizon').terrainEnabled;
  const terrainLoading = useDataStore((s) => s.terrain.status === 'loading');
  const terrain = terrainEnabled && terrainLoading;
  if (surface) return terrain ? 'both' : 'surface';
  return 'terrain';
}
