import { create } from 'zustand';
import type { HorizonProfile, WeatherSeries } from '../model/types';

// ─────────────────────────────────────────────
// DATA STORE (runtime only, not persisted)
// Results of network loads, written by the loaders in hooks/useTerrain.ts and hooks/useWeather.ts
// (mounted once via <DataLoader/>), read by the model hooks and the UI.
// ─────────────────────────────────────────────

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TerrainData {
  /** idle = terrain horizon disabled; error = load failed (profile null → computed without terrain). */
  status: LoadStatus;
  /** Download progress 0…1 (tiles done / total). */
  progress: number;
  /** Terrain horizon at the site (null unless status 'ready'). */
  profile: HorizonProfile | null;
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

export interface DataState {
  terrain: TerrainData;
  weather: WeatherData;
  /** Incremented by retryTerrain(); the terrain loader re-runs when it changes. */
  terrainAttempt: number;
  /** Incremented by retryWeather(); the weather loader re-runs when it changes. */
  weatherAttempt: number;
  setTerrain: (partial: Partial<TerrainData>) => void;
  setWeather: (partial: Partial<WeatherData>) => void;
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
  siteElevation: null,
  error: null,
};

export const INITIAL_WEATHER: WeatherData = {
  status: 'idle',
  series: null,
  error: null,
  usingFallback: false,
};

export const useDataStore = create<DataState>()((set) => ({
  terrain: INITIAL_TERRAIN,
  weather: INITIAL_WEATHER,
  terrainAttempt: 0,
  weatherAttempt: 0,
  setTerrain: (partial) => set((s) => ({ terrain: { ...s.terrain, ...partial } })),
  setWeather: (partial) => set((s) => ({ weather: { ...s.weather, ...partial } })),
  retryTerrain: () => set((s) => ({ terrainAttempt: s.terrainAttempt + 1 })),
  retryWeather: () => set((s) => ({ weatherAttempt: s.weatherAttempt + 1 })),
  resetData: () => set({ terrain: INITIAL_TERRAIN, weather: INITIAL_WEATHER, terrainAttempt: 0, weatherAttempt: 0 }),
}));
