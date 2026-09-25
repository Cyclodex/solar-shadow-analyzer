import { create } from 'zustand';
import type { HorizonProfile, WeatherSeries } from '../model/types';
import type { SurfaceHorizons } from '../model/dsmHorizon';

// ─────────────────────────────────────────────
// DATA STORE (runtime only, not persisted)
// Results of network loads, written by the loaders in hooks/useTerrain.ts, hooks/useWeather.ts and
// hooks/useSurfaceModel.ts (mounted once via <DataLoader/>), read by the model hooks and the UI.
// ─────────────────────────────────────────────

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Terrain horizons of one site per observer height above ground (whole metres, see hooks/useTerrain.ts). */
export type TerrainProfiles = Readonly<Record<number, HorizonProfile>>;

export interface TerrainData {
  /** idle = terrain horizon disabled; error = load failed (profile null → computed without terrain). */
  status: LoadStatus;
  /** Download progress 0…1 (tiles done / total). */
  progress: number;
  /** Terrain horizon at the lowest panel floor's height (null unless status 'ready'). */
  profile: HorizonProfile | null;
  /**
   * Terrain horizon per observer height of the panel floors (null unless 'ready'). Heights still being
   * computed are missing: readers fall back to the nearest height (terrainProfileAt).
   */
  profiles: TerrainProfiles | null;
  /** Ground elevation at the site from the DEM, m (null unless 'ready'). */
  siteElevation: number | null;
  /** Error message (technical, English) when status 'error'. */
  error: string | null;
}

export interface WeatherData {
  /**
   * loading = request running (series may still hold the previous, possibly stale series);
   * ready = `series` matches the config; error = Open-Meteo failed → `series` is the clear-sky fallback.
   */
  status: LoadStatus;
  series: WeatherSeries | null;
  /** Error message (technical, English) of the failed Open-Meteo request. */
  error: string | null;
  /** True when Open-Meteo was requested but the clear-sky year is used instead. */
  usingFallback: boolean;
}

/**
 * Load state of the laser-scan (swissSURFACE3D) horizon: idle = off; loading; ready = `horizons` belong to
 * `siteKey`; error = load failed (results use the prism fallback); unavailable = no scan data at the site
 * (outside CH/FL); waiting = the location lies inside its building (a picked address before «Übernehmen» in
 * the site plan): nothing loads until it is on the facade (results use the prisms, as after an error).
 */
export type SurfaceStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable' | 'waiting';

export interface SurfaceData {
  status: SurfaceStatus;
  /** Progress 0…1 (download and computation). */
  progress: number;
  /** Bytes downloaded for the current site (scan raster, ground model). */
  bytes: number;
  /** Acquisition years of the scan tiles used, ascending (e.g. [2023]); [] while unknown. */
  dataYears: number[];
  /**
   * Share of the traced circle with scan data, 0–1 (below 1 at the CH/FL border: no scan outside); null while
   * unknown.
   */
  coverage: number | null;
  /** Error message (technical, English) when status 'error'. */
  error: string | null;
  /**
   * DSM horizon per observer (model/dsmHorizon.ts surfaceObserverKey: panel-row centre of a floor at a tilt),
   * null unless 'ready'. Observers still being computed are missing (dsmFloorHorizons takes the nearest).
   */
  horizons: SurfaceHorizons | null;
  /** surfaceSiteKey(config) the horizons were computed for (null when none). */
  siteKey: string | null;
}

export interface DataState {
  terrain: TerrainData;
  weather: WeatherData;
  surface: SurfaceData;
  /** Incremented by retrySurface(); the laser-scan loader re-runs when it changes. */
  surfaceAttempt: number;
  /** Incremented by retryTerrain(); the terrain loader re-runs when it changes. */
  terrainAttempt: number;
  /** Incremented by retryWeather(); the weather loader re-runs when it changes. */
  weatherAttempt: number;
  setTerrain: (partial: Partial<TerrainData>) => void;
  setWeather: (partial: Partial<WeatherData>) => void;
  setSurface: (partial: Partial<SurfaceData>) => void;
  /** Re-runs the laser-scan load for the current config (e.g. after an error). */
  retrySurface: () => void;
  /** Re-runs the terrain download for the current config (e.g. after an error). */
  retryTerrain: () => void;
  /** Re-runs the Open-Meteo request for the current config (e.g. after an error). */
  retryWeather: () => void;
  /** Back to the initial (idle, empty) state. */
  resetData: () => void;
}

export const INITIAL_TERRAIN: TerrainData = {
  status: 'idle',
  progress: 0,
  profile: null,
  profiles: null,
  siteElevation: null,
  error: null,
};

export const INITIAL_WEATHER: WeatherData = {
  status: 'idle',
  series: null,
  error: null,
  usingFallback: false,
};

export const INITIAL_SURFACE: SurfaceData = {
  status: 'idle',
  progress: 0,
  bytes: 0,
  dataYears: [],
  coverage: null,
  error: null,
  horizons: null,
  siteKey: null,
};

export const useDataStore = create<DataState>()((set) => ({
  terrain: INITIAL_TERRAIN,
  weather: INITIAL_WEATHER,
  surface: INITIAL_SURFACE,
  terrainAttempt: 0,
  weatherAttempt: 0,
  surfaceAttempt: 0,
  setTerrain: (partial) => set((s) => ({ terrain: { ...s.terrain, ...partial } })),
  setWeather: (partial) => set((s) => ({ weather: { ...s.weather, ...partial } })),
  setSurface: (partial) => set((s) => ({ surface: { ...s.surface, ...partial } })),
  retryTerrain: () => set((s) => ({ terrainAttempt: s.terrainAttempt + 1 })),
  retryWeather: () => set((s) => ({ weatherAttempt: s.weatherAttempt + 1 })),
  retrySurface: () => set((s) => ({ surfaceAttempt: s.surfaceAttempt + 1 })),
  resetData: () =>
    set({
      terrain: INITIAL_TERRAIN,
      weather: INITIAL_WEATHER,
      surface: INITIAL_SURFACE,
      terrainAttempt: 0,
      weatherAttempt: 0,
      surfaceAttempt: 0,
    }),
}));
