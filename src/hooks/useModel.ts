import { useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
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
  WeatherSeries,
  WeatherSource,
} from '../model/types';
import { floorPlacements, instantStateFromSun, panelLayout } from '../model/geometry';
import { sunPosition, sunTimes, solarPath, type SolarPathPoint, type SunTimes } from '../model/sun';
import { dayOfYear, localToUtc } from '../model/time';
import {
  annualFloorKwh,
  simulateYear,
  createFloorModel,
  createStepResult,
  evaluateStep,
  stepMonths,
  sunTrack,
  type FloorModel,
  type SunTrack,
} from '../model/simulation';
import {
  DEFAULT_SWEEP_TILTS,
  dailyProfile,
  heatmapFromSunCells,
  heatmapStats,
  heatmapSunCells,
  sunGrid,
  type HeatmapStats,
  type HeatmapSunCells,
  type SunGrid,
} from '../model/analysis';
import { economics } from '../model/economics';
import { clearSkyIrradiance } from '../model/irradiance';
import { CLEAR_SKY_TEMPERATURE_C, sameWeatherSite } from '../model/weather';
import { clamp } from '../model/units';
import { useConfig, useConfigSection } from '../state/configStore';
import { useDataStore, type DataState } from '../state/dataStore';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { createCache, sameDeps } from './cache';
import {
  floorHorizonsWithTerrain,
  floorTerrainHeight,
  terrainProfileAt,
  type TerrainSource,
} from './useTerrain';
import { useWeatherBusy } from './useWeather';

// ─────────────────────────────────────────────
// MODEL HOOKS
// Thin, memoised wrappers around src/model. Results are shared between components (createCache) and
// keyed by config *sections* (stable references, see configStore), so e.g. a tilt change never
// refetches weather/terrain and never recomputes the tilt sweep, and a time-slider change only
// re-evaluates the instant (never a yearly computation). `location` is keyed by latitude, longitude
// and time zone only: its name and elevation are display-only.
// Heavy yearly computations (simulation, tilt sweep, heatmap) read their inputs through
// useDeferredValue: while a slider is dragged React renders the old result first and computes the
// new one in a background render. useDeferredValue without an initial value does not defer on mount,
// so consumers far below the fold (heatmap) can opt out of the first render (`enabled`).
// Annual results never mix inputs: they are null while the loaded weather series belongs to another
// site or year than the config (e.g. right after a location change).
// ─────────────────────────────────────────────

const layoutCache = createCache<PanelLayout>(4);
const placementsCache = createCache<FloorPlacement[]>(4);
const horizonsCache = createCache<HorizonProfile[]>(4);
const sunTimesCache = createCache<SunTimes>(8);
// Frontal + sun-path views alone use 4 dates (selected, solstices, equinox); leave room for other callers.
const solarPathCache = createCache<SolarPathPoint[]>(8);
const simulationCache = createCache<SimulationResult>(3);
const sweepCache = createCache<TiltSweepResult>(3);
const heatmapCache = createCache<HeatmapData>(4);
const heatmapStatsCache = createCache<HeatmapStats>(4);
const dailyCache = createCache<DailyProfilePoint[]>(4);
const economicsCache = createCache<EconomicsResult>(3);
// Live (instant power, daily profile) and deferred (simulation) configs both hit it while a slider moves.
const floorModelCache = createCache<FloorModel>(4);
// Sun positions shared by every tilt/geometry step: the heatmap's day × slot grid (site + year) and the
// weather series' sun track (site + facade + series).
const sunGridCache = createCache<SunGrid>(2);
// Heatmap cells in the facade frame and against the floor's horizon (grid + facade + horizon, no panels).
const sunCellsCache = createCache<HeatmapSunCells>(2);
const sunTrackCache = createCache<SunTrack>(2);
// Local month of every weather step (series + time zone): shared by every simulation of a series.
const monthsCache = createCache<Uint8Array>(2);

/** Heatmap resolution: local clock slots of 10 minutes. */
const HEATMAP_SLOT_MINUTES = 10;

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
    sunGridCache,
    sunCellsCache,
    sunTrackCache,
    monthsCache,
  ]) {
    c.clear();
  }
  resetSweeps();
}

// ── Geometry ─────────────────────────────────

/** Cache key of the panel geometry (everything but the module power, which no geometry depends on). */
const panelGeometryKey = (panels: Config['panels']): string => JSON.stringify({ ...panels, powerWp: 0 });

function layoutOf(config: Config): PanelLayout {
  return layoutCache.get([config.panels, config.building], () => panelLayout(config));
}

function horizonsOf(config: Config, terrain: TerrainSource): HorizonProfile[] {
  const { horizon, building, panels } = config;
  // Obstacle horizons are seen from the panel centre (depends on the panel geometry); terrain only if enabled.
  const deps = [
    horizon,
    building,
    horizon.obstacles.length > 0 ? panelGeometryKey(panels) : null,
    horizon.terrainEnabled ? terrain : null,
  ];
  return horizonsCache.get(deps, () => floorHorizonsWithTerrain(config, terrain));
}

/** Floor model (layout, horizons, sky view factors) shared by the instant power, daily profile and simulation. */
function floorModelOf(config: Config, horizons: HorizonProfile[]): FloorModel {
  const { panels, building, system } = config;
  return floorModelCache.get([panels, building, system, horizons], () => createFloorModel(config, horizons));
}

/** Sun track of a weather series (site + facade only, so every tilt and geometry step reuses it). */
function trackOf(config: Config, weather: WeatherSeries): SunTrack {
  const { latitude, longitude } = config.location;
  return sunTrackCache.get([latitude, longitude, config.building.facadeAzimuth, weather], () =>
    sunTrack(config, weather),
  );
}

/** Local month (0…11) of every step of a weather series in the site's time zone (no geometry). */
function monthsOf(config: Config, weather: WeatherSeries): Uint8Array {
  const tz = config.location.timezone;
  return monthsCache.get([weather, tz], () => stepMonths(weather.timesUtc, weather.year, tz));
}

/** Sun positions of the heatmap grid (10-min slots of every day of `year`; site only). */
function sunGridOf(config: Config, year: number): SunGrid {
  const { latitude, longitude, timezone } = config.location;
  return sunGridCache.get([latitude, longitude, timezone, year], () =>
    sunGrid(latitude, longitude, timezone, year, HEATMAP_SLOT_MINUTES),
  );
}

/** Terrain input of the horizons: profiles per floor height, or the single site profile. */
const terrainSourceOf = (s: DataState): TerrainSource => s.terrain.profiles ?? s.terrain.profile;

/** Panel row geometry in metres (identical for every floor). */
export function useLayout(): PanelLayout {
  return layoutOf(useConfig());
}

/** Placement of every floor's panel row (index 0 = lowest panel floor). */
export function useFloorPlacements(): FloorPlacement[] {
  const config = useConfig();
  return placementsCache.get([config.building, config.panels], () => floorPlacements(config));
}

/**
 * Terrain horizon of `floor` (default: the lowest panel floor), seen from that floor's railing height;
 * null while loading, on error or when disabled.
 */
export function useTerrainProfile(floor = 0): HorizonProfile | null {
  const enabled = useConfigSection('horizon').terrainEnabled;
  const placements = useFloorPlacements();
  const terrain = useDataStore(terrainSourceOf);
  if (!enabled) return null;
  const placement = placements[clamp(Math.round(floor), 0, placements.length - 1)];
  return terrainProfileAt(terrain, floorTerrainHeight(placement));
}

/** Horizon per floor (index = floor): terrain ∪ manual points ∪ obstacles seen from that floor. */
export function useHorizons(): HorizonProfile[] {
  const config = useConfig();
  const terrain = useDataStore(terrainSourceOf);
  return horizonsOf(config, terrain);
}

/** Focus floor (uiStore.focusFloor clamped to 0…numFloors−1): Panel-Schatten, sun path, horizon lists. */
export function useFocusFloor(): number {
  const numFloors = useConfig().building.numFloors;
  const focus = useUiStore((s) => s.focusFloor);
  return clamp(focus, 0, numFloors - 1);
}

/**
 * Floor analysed by the "shade now" KPI, the heatmap and the shaded-hours column: the focus floor, but
 * never the top floor when there are floors below it (no panels above the top row, so it is never
 * shaded by them). A single floor is floor 0.
 */
export function useShadedFloor(): number {
  const numFloors = useConfigSection('building').numFloors;
  const focus = useFocusFloor();
  return numFloors <= 1 ? 0 : Math.min(focus, numFloors - 2);
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
  const model = floorModelOf(config, horizons);
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
  const { latitude, longitude, timezone } = useConfigSection('location');
  const selected = useTimeStore((s) => s.date);
  const d = date ?? selected;
  return sunTimesCache.get([d, latitude, longitude, timezone], () =>
    sunTimes(d, latitude, longitude, timezone),
  );
}

/** Sun positions over the local day 00:00–24:00 of `date` (default: selected date). */
export function useSolarPath(date?: string, stepMinutes = 10): SolarPathPoint[] {
  const { latitude, longitude, timezone } = useConfigSection('location');
  const selected = useTimeStore((s) => s.date);
  const d = date ?? selected;
  return solarPathCache.get([d, latitude, longitude, timezone, stepMinutes], () =>
    solarPath(d, latitude, longitude, timezone, stepMinutes),
  );
}

// ── Yearly computations (deferred) ───────────

/** Deferred config + horizons + terrain: consistent snapshot for heavy computations. */
function useDeferredInputs(): { config: Config; horizons: HorizonProfile[]; terrain: TerrainSource } {
  const config = useDeferredValue(useConfig());
  const terrain = useDeferredValue(useDataStore(terrainSourceOf));
  return { config, terrain, horizons: horizonsOf(config, terrain) };
}

/**
 * The deferred weather series if it belongs to the site and year of both the deferred `config` and the
 * current config, else null: after a location or year change the previous series is kept while the new
 * one loads (stale-while-revalidate), and the new site's sun must never be combined with it.
 */
function useAnnualWeather(config: Config): WeatherSeries | null {
  const weather = useDeferredValue(useDataStore((s) => s.weather.series));
  const live = useConfigSection('location');
  const liveYear = useConfigSection('weather').year;
  if (!weather) return null;
  const { latitude, longitude } = config.location;
  const matches =
    sameWeatherSite(weather, latitude, longitude, config.weather.year) &&
    sameWeatherSite(weather, live.latitude, live.longitude, liveYear);
  return matches ? weather : null;
}

/**
 * True while the weather series of the annual results is still arriving: it is loading, or a newly
 * arrived series has not reached the (deferred) annual results yet.
 */
export function useWeatherPending(): boolean {
  const loading = useDataStore((s) => s.weather.status === 'loading');
  const weather = useDataStore((s) => s.weather.series);
  // Same deferral as useDeferredInputs / useAnnualWeather: differs only in the urgent render.
  const deferredWeather = useDeferredValue(weather);
  return loading || deferredWeather !== weather;
}

/**
 * True while the terrain horizon is enabled and still arriving: it is loading, or a newly arrived horizon
 * has not reached the (deferred) annual results yet. Annual numbers computed meanwhile lack the terrain.
 */
export function useTerrainPending(): boolean {
  const terrainEnabled = useConfigSection('horizon').terrainEnabled;
  const loading = useDataStore((s) => s.terrain.status === 'loading');
  const terrain = useDataStore(terrainSourceOf);
  const deferredTerrain = useDeferredValue(terrain);
  return terrainEnabled && (loading || deferredTerrain !== terrain);
}

/**
 * True while inputs of the annual results are still arriving: the weather series (useWeatherPending) or
 * the enabled terrain horizon (useTerrainPending). Annual numbers computed meanwhile are provisional.
 */
export function useAnnualInputsPending(): boolean {
  const weather = useWeatherPending();
  const terrain = useTerrainPending();
  return weather || terrain;
}

/**
 * True when the annual results (useSimulation, useEconomics, useTiltSweep) are final for the current
 * inputs: no input is pending (useAnnualInputsPending) and the weather belongs to the configured site and
 * year (useWeatherBusy). Offer exports and derived actions (apply the optimum tilt) only then.
 */
export function useResultsReady(): boolean {
  const pending = useAnnualInputsPending();
  const weatherBusy = useWeatherBusy();
  return !pending && !weatherBusy;
}

/**
 * How long the terrain horizon may be pending before annual results without it are shown as provisional
 * (ms). A fast link or a cached horizon finishes within it: skeleton → final, without a provisional flash.
 */
export const PROVISIONAL_DELAY_MS = 1500;

/** Presentation state of the annual results, see useAnnualResultsState. */
export type AnnualResultsState = 'loading' | 'provisional' | 'final';

/**
 * Presentation state of the annual results (headline numbers, optimum tilt):
 * - 'loading': the weather of the configured site and year has not reached the results (numbers would
 *   belong to another site or year: never show them), or the terrain horizon is pending for less than
 *   PROVISIONAL_DELAY_MS;
 * - 'provisional': only the terrain horizon is still pending (a slow download, ~2 MB): the results are
 *   computed without it — show them marked as provisional, but offer no export or derived action;
 * - 'final': as useResultsReady().
 */
export function useAnnualResultsState(): AnnualResultsState {
  const weatherPending = useWeatherPending();
  const weatherBusy = useWeatherBusy();
  const terrainPending = useTerrainPending();
  const weatherReady = !weatherPending && !weatherBusy;
  const waited = useHeldFor(weatherReady && terrainPending, PROVISIONAL_DELAY_MS);
  if (!weatherReady) return 'loading';
  if (!terrainPending) return 'final';
  return waited ? 'provisional' : 'loading';
}

/** True once `active` has been true for `ms` without interruption (false while inactive). */
function useHeldFor(active: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  // Reset during render (not in an effect): the next activation waits again.
  if (!active && held) setHeld(false);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setHeld(true), ms);
    return () => clearTimeout(id);
  }, [active, ms]);
  return active && held;
}

/**
 * The (deferred) config the annual results (useSimulation, useEconomics) are computed from. Values shown
 * next to them (e.g. installed kWp for kWh/kWp) must come from it, never from the live config: while a
 * slider is dragged the live config is ahead of the results.
 */
export function useSimulationConfig(): Config {
  return useDeferredInputs().config;
}

/**
 * Annual simulation (kWh per floor/month, shading loss) for the loaded weather series;
 * null until a series of the configured site and year is available (see dataStore.weather).
 */
export function useSimulation(): SimulationResult | null {
  const { config, horizons } = useDeferredInputs();
  const weather = useAnnualWeather(config);
  if (!weather) return null;
  const { building, panels, system } = config;
  const { latitude, longitude, timezone } = config.location;
  return simulationCache.get(
    [latitude, longitude, timezone, building, panels, system, horizons, weather],
    () =>
      simulateYear(
        config,
        weather,
        horizons,
        {},
        {
          model: floorModelOf(config, horizons),
          track: trackOf(config, weather),
          months: monthsOf(config, weather),
        },
      ),
  );
}

export interface TiltSweepResult {
  /** Annual kWh per tilt from vertical (0°, 5°, … 90°). */
  points: TiltSweepPoint[];
  /** Point with the highest total annual yield (first one on ties). */
  optimum: TiltSweepPoint;
  /** Year and source of the weather series the sweep was computed from (e.g. to name an export). */
  year: number;
  source: WeatherSource;
  /**
   * True while inputs other than the tilt are being changed: the result is the previous one (the sweep
   * is recomputed once the inputs have settled). Mark it as updating; do not export it.
   */
  updating?: boolean;
}

/** Quiet time after the last change of building/panel/system/horizon inputs before the sweep recomputes. */
export const SWEEP_SETTLE_MS = 250;

/** `value`, but a changed value only once it has stopped changing for `ms` (the first value at once). */
function useSettledValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(settled, value)) return;
    const id = setTimeout(() => setSettled(() => value), ms);
    return () => clearTimeout(id);
  }, [value, settled, ms]);
  return settled;
}

/** Config sections a drag can change continuously (sliders, dial); location and weather year are discrete. */
interface SweepShape {
  building: Config['building'];
  panels: Config['panels'];
  system: Config['system'];
  horizon: Config['horizon'];
}

/** Inputs of one tilt sweep and its cache key. */
interface SweepRequest {
  deps: unknown[];
  config: Config;
  weather: WeatherSeries;
  terrain: TerrainSource;
}

function sweepRequest(
  config: Config,
  shape: SweepShape,
  terrain: TerrainSource,
  weather: WeatherSeries,
): SweepRequest {
  const { latitude, longitude, timezone } = config.location;
  const { building, panels, system, horizon } = shape;
  const panelsWithoutTilt = JSON.stringify({ ...panels, tiltFromVertical: 0 });
  const terrainDep = horizon.terrainEnabled ? terrain : null;
  return {
    deps: [latitude, longitude, timezone, building, panelsWithoutTilt, system, horizon, terrainDep, weather],
    config: { ...config, ...shape },
    weather,
    terrain,
  };
}

/**
 * Tilt sweep in steps — model tiltSweep (sun track shared by all tilts), but with each tilt's own
 * horizons: obstacle horizons are seen from the panel centre, which moves with the tilt, so every point
 * equals simulateYear at that tilt. `step()` computes the next tilt; `points` is complete when done.
 */
function createSweep(req: SweepRequest): { points: TiltSweepPoint[]; done: () => boolean; step: () => void } {
  const { config, weather, terrain } = req;
  let track: SunTrack | null = null;
  // Without obstacles no horizon depends on the tilt.
  const fixed = config.horizon.obstacles.length > 0 ? null : floorHorizonsWithTerrain(config, terrain);
  const points: TiltSweepPoint[] = [];
  return {
    points,
    done: () => points.length === DEFAULT_SWEEP_TILTS.length,
    step: () => {
      track ??= trackOf(config, weather);
      const tiltFromVertical = DEFAULT_SWEEP_TILTS[points.length];
      const c: Config = { ...config, panels: { ...config.panels, tiltFromVertical } };
      const floorsKwh = annualFloorKwh(
        createFloorModel(c, fixed ?? floorHorizonsWithTerrain(c, terrain)),
        weather,
        track,
      );
      points.push({ tiltFromVertical, floorsKwh, totalKwh: floorsKwh.reduce((a, b) => a + b, 0) });
    },
  };
}

function sweepResult(points: TiltSweepPoint[], weather: WeatherSeries): TiltSweepResult {
  const optimum = points.reduce((best, p) => (p.totalKwh > best.totalKwh ? p : best), points[0]);
  return { points, optimum, year: weather.year, source: weather.source };
}

/** The updating variant of each sweep result (stable identity for consumers' memos). */
const updatingSweeps = new WeakMap<TiltSweepResult, TiltSweepResult>();

function asUpdating(result: TiltSweepResult): TiltSweepResult {
  let r = updatingSweeps.get(result);
  if (!r) {
    r = { ...result, updating: true };
    updatingSweeps.set(result, r);
  }
  return r;
}

// ── Background sweep ──
// A sweep takes 50–150 ms (19 annual runs); on a slow phone several times that (≈ 0.4–0.5 s at 4× CPU
// throttling). It is always computed in slices of ≈ SWEEP_SLICE_MS between frames instead of blocking the
// main thread; the hooks re-render when it is done.

/** Time budget of one background slice (one tilt at least). */
const SWEEP_SLICE_MS = 8;

let sweepJob: { req: SweepRequest; sweep: ReturnType<typeof createSweep> } | null = null;
let sweepTimer: ReturnType<typeof setTimeout> | undefined;
/** Last finished sweep: shown (updating) while the next one of the same site and weather computes. */
let lastSweep: { req: SweepRequest; result: TiltSweepResult } | null = null;
let sweepVersion = 0;
const sweepListeners = new Set<() => void>();

function subscribeSweeps(listener: () => void): () => void {
  sweepListeners.add(listener);
  return () => sweepListeners.delete(listener);
}

const getSweepVersion = (): number => sweepVersion;

/** Remembers the sweep shown for `req`: the "previous" result for the next change of the inputs. */
function rememberSweep(req: SweepRequest, result: TiltSweepResult): void {
  lastSweep = { req, result };
}

function finishSweep(req: SweepRequest, points: TiltSweepPoint[]): TiltSweepResult {
  const result = sweepCache.get(req.deps, () => sweepResult(points, req.weather));
  rememberSweep(req, result);
  return result;
}

function runSweepSlice(): void {
  sweepTimer = undefined;
  const job = sweepJob;
  if (!job) return;
  const start = performance.now();
  do job.sweep.step();
  while (!job.sweep.done() && performance.now() - start < SWEEP_SLICE_MS);
  if (!job.sweep.done()) {
    sweepTimer = setTimeout(runSweepSlice, 0);
    return;
  }
  completeSweep(job);
}

function completeSweep(job: NonNullable<typeof sweepJob>): void {
  sweepJob = null;
  finishSweep(job.req, job.sweep.points);
  sweepVersion++;
  sweepListeners.forEach((l) => l());
}

/**
 * Finishes the pending background sweep at once and re-renders its hooks. For the print snapshot (taken
 * right after the beforeprint handlers) and for tests (`act(() => flushSweeps())`).
 */
export function flushSweeps(): void {
  const job = sweepJob;
  if (!job) return;
  clearTimeout(sweepTimer);
  sweepTimer = undefined;
  while (!job.sweep.done()) job.sweep.step();
  completeSweep(job);
}

// Registered on load, i.e. before the print mode's own handler (export/print.ts): a sweep still computing
// (e.g. printed right after a location change) is in the report.
if (typeof window !== 'undefined') window.addEventListener('beforeprint', () => flushSync(flushSweeps));

/** Starts (or keeps) the background sweep for `req`; a job for other inputs is dropped. */
function startSweep(req: SweepRequest): void {
  if (sweepJob && sameDeps(sweepJob.req.deps, req.deps)) return;
  if (sweepCache.peek(req.deps)) return;
  sweepJob = { req, sweep: createSweep(req) };
  clearTimeout(sweepTimer);
  sweepTimer = setTimeout(runSweepSlice, 0);
}

function resetSweeps(): void {
  clearTimeout(sweepTimer);
  sweepTimer = undefined;
  sweepJob = null;
  lastSweep = null;
}

/** The last finished sweep if it belongs to the same site and weather series as `req` (else null). */
function previousSweep(req: SweepRequest): TiltSweepResult | null {
  if (!lastSweep) return null;
  const [lat, lon, tz] = lastSweep.req.deps;
  const [rLat, rLon, rTz] = req.deps;
  const sameSite = lat === rLat && lon === rLon && tz === rTz && lastSweep.req.weather === req.weather;
  return sameSite ? lastSweep.result : null;
}

/**
 * Annual yield for every tilt 0…90° (step 5). The cache key excludes panels.tiltFromVertical, so
 * dragging the tilt never recomputes it. Other building/panel/system/horizon changes are applied once
 * they have settled (SWEEP_SETTLE_MS), so a slider drag computes one sweep instead of one per step, and
 * that sweep runs in the background in short slices. Meanwhile the previous result is returned with
 * `updating: true`. The first result for a site and weather series is computed in the background as well
 * and is null until then (the hook re-renders when it is done). Null without a matching weather series;
 * pass enabled = false to skip the computation (returns null).
 */
export function useTiltSweep(enabled = true): TiltSweepResult | null {
  const { config, terrain } = useDeferredInputs();
  const weather = useAnnualWeather(config);
  const { building, panels, system, horizon } = config;
  const shape = useMemo<SweepShape>(
    () => ({ building, panels, system, horizon }),
    [building, panels, system, horizon],
  );
  const settled = useSettledValue(shape, SWEEP_SETTLE_MS);
  // Re-render when a background sweep has finished.
  useSyncExternalStore(subscribeSweeps, getSweepVersion, getSweepVersion);
  const req = enabled && weather ? sweepRequest(config, settled, terrain, weather) : null;
  const cached = req ? sweepCache.peek(req.deps) : undefined;
  const previous = req && !cached ? previousSweep(req) : null;
  useEffect(() => {
    if (!req) return;
    if (cached) rememberSweep(req, cached);
    else startSweep(req);
  });
  if (!req || !weather) return null;
  const updating = !sameDeps(sweepRequest(config, shape, terrain, weather).deps, req.deps);
  if (cached) return updating ? asUpdating(cached) : cached;
  if (previous) return asUpdating(previous);
  return null; // first result for this site and weather: computing in the background (startSweep)
}

/**
 * Shade heatmap (day × 10-min local slot) of `floor` (default: the shaded floor, see useShadedFloor) for
 * config.weather.year. Geometry only (no weather), so it is available immediately; the sun positions are
 * cached per site and year (sunGrid), and per facade and horizon in the facade frame (heatmapSunCells), so a
 * tilt or geometry step only re-evaluates the shade. With
 * enabled = false nothing is computed and null is returned (e.g. `useDeferredValue(true, false)` to keep
 * it out of the first render).
 */
export function useHeatmap(floor?: number): HeatmapData;
export function useHeatmap(floor: number | undefined, enabled: boolean): HeatmapData | null;
export function useHeatmap(floor?: number, enabled = true): HeatmapData | null {
  const { config, horizons } = useDeferredInputs();
  const shaded = useShadedFloor();
  if (!enabled) return null;
  const k = clamp(Math.round(floor ?? shaded), 0, config.building.numFloors - 1);
  const { building, panels } = config;
  const grid = sunGridOf(config, config.weather.year);
  return heatmapCache.get([grid, building, panelGeometryKey(panels), horizons, k], () => {
    const horizon = horizons[k] ?? null;
    const cells = sunCellsCache.get([grid, building.facadeAzimuth, horizon], () =>
      heatmapSunCells(grid, building.facadeAzimuth, horizon),
    );
    return heatmapFromSunCells(cells, config, k);
  });
}

/**
 * Lit/shaded hours (total and per month) of useHeatmap(floor) (default: the shaded floor); null (not
 * computed) when disabled.
 */
export function useHeatmapStats(floor?: number): HeatmapStats;
export function useHeatmapStats(floor: number | undefined, enabled: boolean): HeatmapStats | null;
export function useHeatmapStats(floor?: number, enabled = true): HeatmapStats | null {
  const heatmap = useHeatmap(floor, enabled);
  if (!heatmap) return null;
  return heatmapStatsCache.get([heatmap], () => heatmapStats(heatmap));
}

/**
 * Clear-sky power and shade per floor over the day `date` (default: selected date), 10-min steps. Shares
 * the floor model with useInstantPower.
 */
export function useDailyProfile(date?: string): DailyProfilePoint[] {
  const config = useConfig();
  const horizons = useHorizons();
  const selected = useTimeStore((s) => s.date);
  const d = date ?? selected;
  const { building, panels, system } = config;
  const { latitude, longitude, timezone } = config.location;
  return dailyCache.get([d, latitude, longitude, timezone, building, panels, system, horizons], () =>
    dailyProfile(
      config,
      d,
      horizons,
      10,
      floorModelOf(config, horizons),
      // Same sun positions as useSolarPath(d): a tilt or geometry step only re-evaluates the power.
      solarPathCache.get([d, latitude, longitude, timezone, 10], () =>
        solarPath(d, latitude, longitude, timezone, 10),
      ),
    ),
  );
}

/**
 * Economics for the simulated annual yield; null while no simulation is available. The investment
 * follows the simulated floors (same snapshot as the yield), the economics inputs are live.
 */
export function useEconomics(): EconomicsResult | null {
  const simulation = useSimulation();
  const e = useConfigSection('economics');
  if (!simulation) return null;
  const floors = simulation.floors.length;
  return economicsCache.get([simulation, e, floors], () => economics(simulation.totalAnnualKwh, floors, e));
}
