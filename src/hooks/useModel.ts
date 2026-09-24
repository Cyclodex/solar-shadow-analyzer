import { useDeferredValue, useMemo } from 'react';
import type {
  Config,
  DailyProfilePoint,
  EconomicsResult,
  FloorPlacement,
  HeatmapData,
  HorizonProfile,
  InstantState,
  PanelLayout,
  SimulationResult,
  TiltSweepPoint,
} from '../model/types';
import { floorPlacements, instantStateFromSun, panelLayout } from '../model/geometry';
import { floorHorizons } from '../model/horizon';
import { sunPosition, sunTimes, solarPath, type SolarPathPoint, type SunTimes } from '../model/sun';
import { dayOfYear, localToUtc } from '../model/time';
import {
  simulateYear,
  createFloorModel,
  createStepResult,
  evaluateStep,
  type FloorModel,
} from '../model/simulation';
import { dailyProfile, heatmapStats, shadeHeatmap, tiltSweep, type HeatmapStats } from '../model/analysis';
import { economics } from '../model/economics';
import { clearSkyIrradiance } from '../model/irradiance';
import { CLEAR_SKY_TEMPERATURE_C } from '../model/weather';
import { clamp } from '../model/units';
import { useConfig } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { createCache } from './cache';

// ─────────────────────────────────────────────
// MODEL HOOKS
// Thin, memoised wrappers around src/model. Results are shared between components (createCache) and
// keyed by config *sections* (stable references, see configStore), so e.g. a tilt change never
// refetches weather/terrain and never recomputes the tilt sweep, and a time-slider change only
// re-evaluates the instant (never a yearly computation).
// Heavy yearly computations (simulation, tilt sweep, heatmap) read their inputs through
// useDeferredValue: while a slider is dragged React renders the old result first and computes the
// new one in a background render.
// ─────────────────────────────────────────────

const layoutCache = createCache<PanelLayout>(4);
const placementsCache = createCache<FloorPlacement[]>(4);
const horizonsCache = createCache<HorizonProfile[]>(4);
const sunTimesCache = createCache<SunTimes>(8);
// Frontal + sun-path views alone use 4 dates (selected, solstices, equinox); leave room for other callers.
const solarPathCache = createCache<SolarPathPoint[]>(8);
const simulationCache = createCache<SimulationResult>(3);
const sweepCache = createCache<TiltSweepResult>(2);
const heatmapCache = createCache<HeatmapData>(4);
const heatmapStatsCache = createCache<HeatmapStats>(4);
const dailyCache = createCache<DailyProfilePoint[]>(4);
const economicsCache = createCache<EconomicsResult>(3);
const floorModelCache = createCache<FloorModel>(3);

/** Drops all shared model caches (tests). */
export function clearModelCaches(): void {
  for (const c of [
    layoutCache,
    placementsCache,
    horizonsCache,
    sunTimesCache,
    solarPathCache,
    simulationCache,
    sweepCache,
    heatmapCache,
    heatmapStatsCache,
    dailyCache,
    economicsCache,
    floorModelCache,
  ]) {
    c.clear();
  }
}

// ── Geometry ─────────────────────────────────

function layoutOf(config: Config): PanelLayout {
  return layoutCache.get([config.panels, config.building], () => panelLayout(config));
}

function horizonsOf(config: Config, terrain: HorizonProfile | null): HorizonProfile[] {
  const { horizon, building, panels } = config;
  // Obstacle horizons are seen from the panel centre (depends on the panels); terrain only if enabled.
  const deps = [
    horizon,
    building,
    horizon.obstacles.length > 0 ? panels : null,
    horizon.terrainEnabled ? terrain : null,
  ];
  return horizonsCache.get(deps, () => floorHorizons(config, terrain));
}

/** Panel row geometry in metres (identical for every floor). */
export function useLayout(): PanelLayout {
  return layoutOf(useConfig());
}

/** Placement of every floor's panel row (index 0 = lowest panel floor). */
export function useFloorPlacements(): FloorPlacement[] {
  const config = useConfig();
  return placementsCache.get([config.building, config.panels], () => floorPlacements(config));
}

/** Terrain horizon profile when loaded (null while loading, on error or when disabled). */
export function useTerrainProfile(): HorizonProfile | null {
  const enabled = useConfig().horizon.terrainEnabled;
  const profile = useDataStore((s) => s.terrain.profile);
  return enabled ? profile : null;
}

/** Horizon per floor (index = floor): terrain ∪ manual points ∪ obstacles seen from that floor. */
export function useHorizons(): HorizonProfile[] {
  const config = useConfig();
  const terrain = useDataStore((s) => s.terrain.profile);
  return horizonsOf(config, terrain);
}

/** Analysed floor (uiStore.focusFloor clamped to 0…numFloors−1). */
export function useFocusFloor(): number {
  const numFloors = useConfig().building.numFloors;
  const focus = useUiStore((s) => s.focusFloor);
  return clamp(focus, 0, numFloors - 1);
}

// ── Instant (selected date + time) ───────────

/** UTC ms of the selected local date/time at the site. */
export function useSelectedUtc(): number {
  const tz = useConfig().location.timezone;
  const date = useTimeStore((s) => s.date);
  const minutes = useTimeStore((s) => s.minutes);
  return useMemo(() => localToUtc(date, minutes, tz), [date, minutes, tz]);
}

/** Sun position, per-floor sun state and exact 3D shade from the floor above at the selected instant. */
export function useInstant(): InstantState {
  const config = useConfig();
  const horizons = useHorizons();
  const layout = layoutOf(config);
  const utcMs = useSelectedUtc();
  return useMemo(() => {
    const sun = sunPosition(utcMs, config.location.latitude, config.location.longitude);
    return instantStateFromSun(config, utcMs, sun, horizons, layout);
  }, [config, horizons, layout, utcMs]);
}

/**
 * Clear-sky AC power per floor (W) at the selected instant — same model as dailyProfile
 * (clearSkyIrradiance, CLEAR_SKY_TEMPERATURE_C, shading by the row above, horizons, inverter limit).
 */
export function useInstantPower(): number[] {
  const config = useConfig();
  const horizons = useHorizons();
  const instant = useInstant();
  const date = useTimeStore((s) => s.date);
  const { panels, building, system } = config;
  const model = floorModelCache.get([panels, building, system, horizons], () =>
    createFloorModel(config, horizons),
  );
  return useMemo(() => {
    const { altitude, azimuth } = instant.sun;
    const sample = clearSkyIrradiance(altitude, dayOfYear(date));
    const out = createStepResult(model.numFloors);
    evaluateStep(model, altitude, azimuth, instant.sunFacade, sample, CLEAR_SKY_TEMPERATURE_C, out, false);
    return Array.from(out.acW);
  }, [model, instant, date]);
}

/** Sunrise / solar noon / sunset (local clock minutes) of `date` (default: selected date). */
export function useSunTimes(date?: string): SunTimes {
  const location = useConfig().location;
  const selected = useTimeStore((s) => s.date);
  const d = date ?? selected;
  return sunTimesCache.get([d, location], () =>
    sunTimes(d, location.latitude, location.longitude, location.timezone),
  );
}

/** Sun positions over the local day 00:00–24:00 of `date` (default: selected date). */
export function useSolarPath(date?: string, stepMinutes = 10): SolarPathPoint[] {
  const location = useConfig().location;
  const selected = useTimeStore((s) => s.date);
  const d = date ?? selected;
  return solarPathCache.get([d, location, stepMinutes], () =>
    solarPath(d, location.latitude, location.longitude, location.timezone, stepMinutes),
  );
}

// ── Yearly computations (deferred) ───────────

/** Deferred config + horizons + weather: consistent snapshot for heavy computations. */
function useDeferredInputs(): { config: Config; horizons: HorizonProfile[]; terrain: HorizonProfile | null } {
  const config = useDeferredValue(useConfig());
  const terrain = useDeferredValue(useDataStore((s) => s.terrain.profile));
  return { config, terrain, horizons: horizonsOf(config, terrain) };
}

/**
 * Annual simulation (kWh per floor/month, shading loss) for the loaded weather series;
 * null until a series is available (see dataStore.weather).
 */
export function useSimulation(): SimulationResult | null {
  const { config, horizons } = useDeferredInputs();
  const weather = useDeferredValue(useDataStore((s) => s.weather.series));
  if (!weather) return null;
  const { location, building, panels, system } = config;
  return simulationCache.get([location, building, panels, system, horizons, weather], () =>
    simulateYear(config, weather, horizons),
  );
}

export interface TiltSweepResult {
  /** Annual kWh per tilt from vertical (0°, 5°, … 90°). */
  points: TiltSweepPoint[];
  /** Point with the highest total annual yield (first one on ties). */
  optimum: TiltSweepPoint;
}

/** Tilt at which the (tilt-dependent) obstacle horizons for the sweep are evaluated. */
const SWEEP_HORIZON_TILT = 45;

/**
 * Annual yield for every tilt 0…90° (step 5). The cache key excludes panels.tiltFromVertical, so
 * dragging the tilt never recomputes it. Pass enabled = false to skip the computation (returns null).
 */
export function useTiltSweep(enabled = true): TiltSweepResult | null {
  const { config, terrain } = useDeferredInputs();
  const weather = useDeferredValue(useDataStore((s) => s.weather.series));
  if (!enabled || !weather) return null;
  const { location, building, panels, system, horizon } = config;
  const panelsWithoutTilt = JSON.stringify({ ...panels, tiltFromVertical: 0 });
  const terrainDep = horizon.terrainEnabled ? terrain : null;
  return sweepCache.get([location, building, panelsWithoutTilt, system, horizon, terrainDep, weather], () => {
    const c: Config = { ...config, panels: { ...panels, tiltFromVertical: SWEEP_HORIZON_TILT } };
    const points = tiltSweep(c, weather, floorHorizons(c, terrain));
    const optimum = points.reduce((best, p) => (p.totalKwh > best.totalKwh ? p : best), points[0]);
    return { points, optimum };
  });
}

/**
 * Shade heatmap (day × 10-min local slot) of `floor` (default: focus floor) for config.weather.year.
 * Geometry only (no weather), so it is available immediately.
 */
export function useHeatmap(floor?: number): HeatmapData {
  const { config, horizons } = useDeferredInputs();
  const focus = useFocusFloor();
  const k = clamp(Math.round(floor ?? focus), 0, config.building.numFloors - 1);
  const { location, building, panels } = config;
  const year = config.weather.year;
  return heatmapCache.get([location, building, panels, horizons, year, k], () =>
    shadeHeatmap(config, horizons, year, k, 10),
  );
}

/** Lit/shaded hours (total and per month) of useHeatmap(floor). */
export function useHeatmapStats(floor?: number): HeatmapStats {
  const heatmap = useHeatmap(floor);
  return heatmapStatsCache.get([heatmap], () => heatmapStats(heatmap));
}

/** Clear-sky power and shade per floor over the day `date` (default: selected date), 10-min steps. */
export function useDailyProfile(date?: string): DailyProfilePoint[] {
  const config = useConfig();
  const horizons = useHorizons();
  const selected = useTimeStore((s) => s.date);
  const d = date ?? selected;
  const { location, building, panels, system } = config;
  return dailyCache.get([d, location, building, panels, system, horizons], () =>
    dailyProfile(config, d, horizons),
  );
}

/** Economics for the simulated annual yield; null while no simulation is available. */
export function useEconomics(): EconomicsResult | null {
  const simulation = useSimulation();
  const config = useConfig();
  if (!simulation) return null;
  const { economics: e, building } = config;
  return economicsCache.get([simulation, e, building.numFloors], () =>
    economics(simulation.totalAnnualKwh, building.numFloors, e),
  );
}
