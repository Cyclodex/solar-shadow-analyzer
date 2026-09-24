import type {
  Config,
  DailyProfilePoint,
  HeatmapData,
  HorizonProfile,
  TiltSweepPoint,
  WeatherSeries,
} from './types';
import { MS_PER_DAY, MS_PER_MINUTE, dayOfYear, dayOffsetsForYear, daysInYear } from './time';
import { solarPath, sunPosition } from './sun';
import { panelLayout, shadeFromAbove, sunInFacade } from './geometry';
import { horizonAt } from './horizon';
import { clearSkyIrradiance } from './irradiance';
import { CLEAR_SKY_TEMPERATURE_C } from './weather';
import {
  annualFloorKwh,
  createFloorModel,
  createStepResult,
  evaluateStep,
  sunTrack,
  type FloorModel,
  type SunTrack,
} from './simulation';

// ─────────────────────────────────────────────
// ANALYSES
// Shade heatmap (day × local clock time), tilt sweep and clear-sky daily power profile.
// ─────────────────────────────────────────────

/** Heatmap cell codes (values ≥ 0 are shaded fractions). */
export const HEATMAP_NIGHT = -3;
export const HEATMAP_BEHIND = -2;
export const HEATMAP_HORIZON = -1;

/** Cells with a shaded fraction above this count as shaded in heatmapStats. */
export const SHADED_THRESHOLD = 0.01;

/**
 * Sun position (apparent altitude/azimuth) at the midpoint of every local clock slot of every day of `year`
 * (site time zone incl. DST via dayOffsetsForYear — the offset at local noon is used for the whole day).
 * Depends only on the site and the year, so one grid serves every tilt, facade, geometry and floor
 * (≈ 30 ms for 10-min slots; 365 × 144 × 2 doubles ≈ 840 kB). `slotMinutes` should divide 1440.
 */
export interface SunGrid {
  year: number;
  /** Days in the year (365/366). */
  days: number;
  slotsPerDay: number;
  slotMinutes: number;
  /** Row-major [day][slot], degrees. */
  altitude: Float64Array;
  azimuth: Float64Array;
}

/** Builds the SunGrid of a site and year (see SunGrid). */
export function sunGrid(
  latitude: number,
  longitude: number,
  timeZone: string,
  year: number,
  slotMinutes = 10,
): SunGrid {
  if (!(slotMinutes > 0) || slotMinutes > 1440) throw new RangeError(`Invalid slot: ${slotMinutes}`);
  const days = daysInYear(year);
  const slotsPerDay = Math.floor(1440 / slotMinutes + 1e-9);
  const offsets = dayOffsetsForYear(year, timeZone);
  const altitude = new Float64Array(days * slotsPerDay);
  const azimuth = new Float64Array(days * slotsPerDay);
  const start = Date.UTC(year, 0, 1);
  for (let d = 0; d < days; d++) {
    const t0 = start + d * MS_PER_DAY - offsets[d] * MS_PER_MINUTE;
    for (let s = 0; s < slotsPerDay; s++) {
      const sun = sunPosition(t0 + (s + 0.5) * slotMinutes * MS_PER_MINUTE, latitude, longitude);
      altitude[d * slotsPerDay + s] = sun.altitude;
      azimuth[d * slotsPerDay + s] = sun.azimuth;
    }
  }
  return { year, days, slotsPerDay, slotMinutes, altitude, azimuth };
}

/**
 * Shade of floor `floor` by the row above for every cell of `grid`, which must be the SunGrid of the config's
 * site (see shadeHeatmap). Only the facade, geometry and horizons are evaluated here (≈ 6 ms for 10-min slots).
 */
export function shadeHeatmapFromGrid(
  grid: SunGrid,
  config: Config,
  horizons: readonly (HorizonProfile | null | undefined)[],
  floor = 0,
): HeatmapData {
  const { year, days, slotsPerDay, slotMinutes } = grid;
  const n = config.building.numFloors;
  const k = Math.min(n - 1, Math.max(0, Math.round(floor)));
  const gamma = config.building.facadeAzimuth;
  const layout = panelLayout(config);
  const hz = horizons[k] ?? null;
  const hasAbove = k < n - 1;
  const values = new Float32Array(days * slotsPerDay);
  const sun = { altitude: 0, azimuth: 0 };
  for (let i = 0; i < values.length; i++) {
    sun.altitude = grid.altitude[i];
    sun.azimuth = grid.azimuth[i];
    let v: number;
    if (sun.altitude <= 0) v = HEATMAP_NIGHT;
    else {
      const sf = sunInFacade(sun, gamma);
      if (sf.n <= 0) v = HEATMAP_BEHIND;
      else if (hz && sun.altitude < horizonAt(hz, sun.azimuth)) v = HEATMAP_HORIZON;
      else v = hasAbove ? shadeFromAbove(sf, layout).fraction : 0;
    }
    values[i] = v;
  }
  return { year, days, slotsPerDay, slotMinutes, values, floor: k };
}

/**
 * Shade of floor `floor` by the row above for every day of `year` × local clock slot (slot midpoints,
 * site time zone incl. DST via dayOffsetsForYear — the offset at local noon is used for the whole day).
 * Codes: HEATMAP_NIGHT (sun ≤ 0°), HEATMAP_BEHIND (behind the facade), HEATMAP_HORIZON (below this floor's
 * horizon), else the shaded area fraction 0…1 (always 0 for the top floor). `slotMinutes` should divide 1440.
 * Callers that vary only the facade, geometry, horizons or floor should reuse a sunGrid via shadeHeatmapFromGrid.
 */
export function shadeHeatmap(
  config: Config,
  horizons: readonly (HorizonProfile | null | undefined)[],
  year: number,
  floor = 0,
  slotMinutes = 10,
): HeatmapData {
  const { latitude, longitude, timezone } = config.location;
  return shadeHeatmapFromGrid(sunGrid(latitude, longitude, timezone, year, slotMinutes), config, horizons, floor);
}

/** Summary of a heatmap (hours from slot counts). */
export interface HeatmapStats {
  /** Hours with direct sun on the panel plane (lit, shaded or not). */
  litHours: number;
  /** Lit hours with a shaded fraction > SHADED_THRESHOLD. */
  shadedHours: number;
  /** shadedHours / litHours, %. */
  shadedPct: number;
  /** Per calendar month (month = 0…11). maxShade = largest shaded fraction in that month. */
  monthly: { month: number; litHours: number; shadedHours: number; maxShade: number }[];
}

/** Lit / shaded hours of a heatmap, total and per month (a cell counts slotMinutes). */
export function heatmapStats(h: HeatmapData): HeatmapStats {
  const hoursPerSlot = h.slotMinutes / 60;
  const monthly = Array.from({ length: 12 }, (_, month) => ({ month, litHours: 0, shadedHours: 0, maxShade: 0 }));
  const start = Date.UTC(h.year, 0, 1);
  let lit = 0;
  let shaded = 0;
  for (let d = 0; d < h.days; d++) {
    const m = monthly[new Date(start + d * MS_PER_DAY).getUTCMonth()];
    for (let s = 0; s < h.slotsPerDay; s++) {
      const v = h.values[d * h.slotsPerDay + s];
      if (v < 0) continue;
      lit++;
      m.litHours += hoursPerSlot;
      if (v > SHADED_THRESHOLD) {
        shaded++;
        m.shadedHours += hoursPerSlot;
      }
      if (v > m.maxShade) m.maxShade = v;
    }
  }
  return {
    litHours: lit * hoursPerSlot,
    shadedHours: shaded * hoursPerSlot,
    shadedPct: lit > 0 ? (shaded / lit) * 100 : 0,
    monthly,
  };
}

/** Default tilts of tiltSweep: 0°, 5°, …, 90° from vertical. */
export const DEFAULT_SWEEP_TILTS: readonly number[] = Array.from({ length: 19 }, (_, i) => i * 5);

/**
 * Annual AC energy per floor for each tilt from vertical (same weather, horizons, everything else as
 * `config`). Sun positions are computed once and shared by all tilts; pass `track` = sunTrack(config, weather)
 * to reuse one built elsewhere. The horizons are used as given (obstacle horizons move slightly with the tilt;
 * ignored). ≈ 4–10 ms per tilt for 8760 steps (2–8 floors).
 */
export function tiltSweep(
  config: Config,
  weather: WeatherSeries,
  horizons: readonly (HorizonProfile | null | undefined)[],
  tilts: readonly number[] = DEFAULT_SWEEP_TILTS,
  track: SunTrack = sunTrack(config, weather),
): TiltSweepPoint[] {
  return tilts.map((tiltFromVertical) => {
    const c: Config = { ...config, panels: { ...config.panels, tiltFromVertical } };
    const floorsKwh = annualFloorKwh(createFloorModel(c, horizons), weather, track);
    return { tiltFromVertical, floorsKwh, totalKwh: floorsKwh.reduce((a, b) => a + b, 0) };
  });
}

/**
 * Clear-sky AC power and shade per floor over the local day `date` (solarPath grid, 00:00–24:00 every
 * `stepMinutes`; clear sky as clearSkyIrradiance, air temperature CLEAR_SKY_TEMPERATURE_C).
 * floorsShade = shaded area fraction by the row above while the beam reaches that floor, else 0.
 * `model` = createFloorModel(config, horizons) (default options) when already built elsewhere.
 */
export function dailyProfile(
  config: Config,
  date: string,
  horizons: readonly (HorizonProfile | null | undefined)[],
  stepMinutes = 10,
  model: FloorModel = createFloorModel(config, horizons),
): DailyProfilePoint[] {
  const { latitude, longitude, timezone } = config.location;
  const path = solarPath(date, latitude, longitude, timezone, stepMinutes);
  const doy = dayOfYear(date);
  const out = createStepResult(model.numFloors);
  return path.map((p) => {
    const sample = clearSkyIrradiance(p.sun.altitude, doy);
    const sf = sunInFacade(p.sun, config.building.facadeAzimuth);
    evaluateStep(model, p.sun.altitude, p.sun.azimuth, sf, sample, CLEAR_SKY_TEMPERATURE_C, out, false);
    return {
      minutes: p.minutes,
      altitude: p.sun.altitude,
      azimuth: p.sun.azimuth,
      floorsW: Array.from(out.acW),
      floorsShade: Array.from(out.shade),
    };
  });
}
