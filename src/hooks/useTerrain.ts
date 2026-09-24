import { useEffect, useRef } from 'react';
import type { Config, FloorPlacement, HorizonProfile } from '../model/types';
import { fetchTerrainHorizon } from '../model/terrain';
import { floorPlacements } from '../model/geometry';
import { FLOOR_HORIZON_STEP_DEG, floorHorizons, maxHorizon } from '../model/horizon';
import { useConfig } from '../state/configStore';
import { useDataStore, INITIAL_TERRAIN, type TerrainProfiles } from '../state/dataStore';

// ─────────────────────────────────────────────
// TERRAIN HORIZON LOADER
// Fetches the DEM terrain horizon (model/terrain.ts) when config.horizon.terrainEnabled, debounced on
// location changes, and writes status/progress/result into dataStore.terrain. Mount once (DataLoader).
// The horizon is computed per panel floor, at that floor's railing height: near hills and valley sides
// the terrain horizon drops noticeably with height. All heights share one tile download (in-memory
// tile cache); a change of the floor heights alone recomputes from those tiles and keeps the current
// profiles meanwhile.
// ─────────────────────────────────────────────

/** Delay after the last location (or floor height) change before downloading tiles / recomputing. */
export const TERRAIN_DEBOUNCE_MS = 800;

/**
 * Observer height above ground of a floor's terrain horizon: top edge of its panel row (slab + railing,
 * independent of the tilt so that tilting never refetches), rounded to 1 m.
 */
export function floorTerrainHeight(placement: Pick<FloorPlacement, 'railTopZ'> | undefined): number {
  return Math.max(1, Math.round(placement?.railTopZ ?? 1));
}

/** Distinct terrain observer heights of all panel floors, ascending (see floorTerrainHeight). */
export function terrainObserverHeights(config: Parameters<typeof floorPlacements>[0]): number[] {
  const heights = new Set(floorPlacements(config).map(floorTerrainHeight));
  return [...heights].sort((a, b) => a - b);
}

/** Terrain observer height of the lowest panel floor (see floorTerrainHeight). */
export function terrainObserverHeight(config: Parameters<typeof floorPlacements>[0]): number {
  return terrainObserverHeights(config)[0] ?? 1;
}

/** Terrain input of the horizons: profiles per height, or one profile used for every height. */
export type TerrainSource = TerrainProfiles | HorizonProfile | null;

const isProfile = (t: TerrainProfiles | HorizonProfile): t is HorizonProfile =>
  Array.isArray((t as Partial<HorizonProfile>).elevations);

/**
 * Terrain profile for an observer height: the profile computed for that height, else the one of the
 * nearest computed height (lower on ties; recomputation still pending), else null.
 */
export function terrainProfileAt(terrain: TerrainSource, height: number): HorizonProfile | null {
  if (!terrain) return null;
  if (isProfile(terrain)) return terrain;
  const exact = terrain[height];
  if (exact) return exact;
  let best: HorizonProfile | null = null;
  let bestDist = Infinity;
  for (const [key, profile] of Object.entries(terrain)) {
    const d = Math.abs(Number(key) - height) + (Number(key) > height ? 1e-6 : 0);
    if (d < bestDist) {
      best = profile;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Horizon per floor as model floorHorizons (terrain if enabled ∪ manual points ∪ obstacles seen from the
 * floor), but with each floor's own terrain horizon (terrainProfileAt its floorTerrainHeight).
 * Equal to floorHorizons(config, profile) when a single profile is given.
 */
export function floorHorizonsWithTerrain(config: Config, terrain: TerrainSource): HorizonProfile[] {
  if (!config.horizon.terrainEnabled || !terrain || isProfile(terrain)) {
    return floorHorizons(config, terrain && isProfile(terrain) ? terrain : null);
  }
  const { manual, obstacles } = config.horizon;
  // Manual points and obstacles per floor, then the pointwise maximum with that floor's terrain. Both
  // profiles are sampled on the same grid, so this equals floorHorizons with the floor's terrain profile.
  const own = manual.length > 0 || obstacles.length > 0 ? floorHorizons(config, null) : null;
  const terrainOnly = new Map<HorizonProfile | null, HorizonProfile>();
  return floorPlacements(config).map((p, k) => {
    const profile = terrainProfileAt(terrain, floorTerrainHeight(p));
    if (own) return profile ? maxHorizon([own[k], profile], FLOOR_HORIZON_STEP_DEG) : own[k];
    let hz = terrainOnly.get(profile);
    if (!hz) {
      hz = maxHorizon([profile], FLOOR_HORIZON_STEP_DEG);
      terrainOnly.set(profile, hz);
    }
    return hz;
  });
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Loads the terrain horizons into dataStore. Call exactly once (in <DataLoader/>). */
export function useTerrainLoader(): void {
  const config = useConfig();
  const enabled = config.horizon.terrainEnabled;
  const { latitude, longitude } = config.location;
  const heightsKey = terrainObserverHeights(config).join(',');
  const attempt = useDataStore((s) => s.terrainAttempt);
  /** Previous run: only a *changed* site or height set is debounced (first load and re-enabling are immediate). */
  const lastRun = useRef<{ site: string; heights: string; attempt: number } | null>(null);

  useEffect(() => {
    const { setTerrain } = useDataStore.getState();
    if (!enabled) {
      lastRun.current = null;
      setTerrain(INITIAL_TERRAIN);
      return;
    }
    const heights = heightsKey.split(',').map(Number);
    const site = `${latitude},${longitude}`;
    const prev = lastRun.current;
    lastRun.current = { site, heights: heightsKey, attempt };
    const unchanged = prev !== null && prev.site === site && prev.heights === heightsKey;
    const delay = prev === null || unchanged ? 0 : TERRAIN_DEBOUNCE_MS;
    // Same site, only the floor heights changed: keep the current profiles (nearest height) until the
    // new ones are computed, instead of flashing "no terrain" while e.g. the floor height is dragged.
    const refresh =
      prev !== null &&
      prev.site === site &&
      prev.attempt === attempt &&
      !unchanged &&
      useDataStore.getState().terrain.status === 'ready';
    const ctrl = new AbortController();
    const { signal } = ctrl;
    if (!refresh) {
      // The old profiles belong to another site: drop them instead of computing with a wrong horizon.
      setTerrain({
        status: 'loading',
        progress: 0,
        profile: null,
        profiles: null,
        siteElevation: null,
        error: null,
      });
    }

    const load = async (): Promise<void> => {
      const [lowest, ...others] = heights;
      let first;
      try {
        first = await fetchTerrainHorizon(latitude, longitude, {
          signal,
          observerHeight: lowest,
          onProgress: refresh
            ? undefined
            : (done, total) => {
                if (!signal.aborted) setTerrain({ progress: total > 0 ? done / total : 0 });
              },
        });
      } catch (e) {
        if (signal.aborted) return;
        setTerrain({
          status: 'error',
          profile: null,
          profiles: null,
          siteElevation: null,
          error: errorMessage(e),
        });
        return;
      }
      if (signal.aborted) return;
      const profiles: Record<number, HorizonProfile> = { [lowest]: first.profile };
      const publish = (): void =>
        setTerrain({
          status: 'ready',
          progress: 1,
          profile: first.profile,
          profiles: { ...profiles },
          siteElevation: first.siteElevation,
          error: null,
        });
      // The site is usable as soon as the lowest floor's horizon exists; the other heights reuse its tiles.
      if (!refresh || others.length === 0) publish();
      if (others.length === 0) return;
      for (const h of others) {
        try {
          profiles[h] = (
            await fetchTerrainHorizon(latitude, longitude, { signal, observerHeight: h })
          ).profile;
        } catch {
          // A failed extra height keeps the nearest computed height (terrainProfileAt).
        }
        if (signal.aborted) return;
      }
      publish();
    };

    const timer = setTimeout(() => void load(), delay);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [enabled, latitude, longitude, heightsKey, attempt]);
}
