import type {
  Config,
  FacadeVector,
  FloorYield,
  HorizonProfile,
  IrradianceSample,
  PanelLayout,
  SimulationResult,
  WeatherSeries,
} from './types';
import { MS_PER_DAY, MS_PER_MINUTE, dayOffsetsForYear, daysInYear } from './time';
import { sunPosition } from './sun';
import { cosIncidence, panelLayout, shadeFromAbove, substringBeamLoss, sunInFacade } from './geometry';
import { horizonAt } from './horizon';
import { groundViewFactor, iamAshrae, skyViewFromGrid, skyViewGrid } from './irradiance';

// ─────────────────────────────────────────────
// ENERGY SIMULATION
// Per time step and floor: sun → facade frame → beam (horizon, facade, row above) + isotropic diffuse
// (sky view factor) + ground reflection → NOCT cell temperature → DC → system losses → inverter limit.
// Model: docs/ARCHITECTURE.md ("Energie-Modell"). Power in W, energy in kWh.
// ─────────────────────────────────────────────

/** Options of the energy model. */
export interface SimulationOptions {
  /**
   * The facade wall blocks sun and sky behind its plane (s_n ≤ 0). Default true. false = free-standing row
   * (reference mode for comparisons with PVGIS; shading by a row above is then still only evaluated for
   * sun in front of the facade).
   */
  facade?: boolean;
  /** Grid step of the sky view factor integration, degrees. Default 1. */
  skyGridDeg?: number;
}

/** Constants of the row power model derived from the config. */
export interface PowerParams {
  /** count · Wp, W. */
  ratedW: number;
  /** Temperature coefficient, 1/K (e.g. −0.0035). */
  tempCoeff: number;
  /** (NOCT − 20)/800, K per W/m². */
  noctFactor: number;
  /** 1 − losses/100. */
  lossFactor: number;
  /** AC limit, W. */
  limitW: number;
}

/** Row power model constants of `config`. */
export function powerParams(config: Config): PowerParams {
  const { panels, system } = config;
  return {
    ratedW: panels.count * panels.powerWp,
    tempCoeff: system.tempCoeffPct / 100,
    noctFactor: (system.noct - 20) / 800,
    lossFactor: 1 - system.lossesPct / 100,
    limitW: system.inverterLimitW,
  };
}

/**
 * Row output before the inverter limit, W: T_cell = T_air + POA·(NOCT − 20)/800,
 * P = count·Wp·POA/1000·(1 + γ·(T_cell − 25))·(1 − losses), floored at 0.
 */
function rowDcW(poa: number, airTempC: number, p: PowerParams): number {
  if (!(poa > 0)) return 0;
  const tCell = airTempC + poa * p.noctFactor;
  const dc = ((p.ratedW * poa) / 1000) * (1 + p.tempCoeff * (tCell - 25)) * p.lossFactor;
  return dc > 0 ? dc : 0;
}

/**
 * Power of one floor's row for plane-of-array irradiance `poa` (W/m²) and air temperature (°C):
 * `dcW` = output after system losses before the inverter limit, `acW` = min(dcW, inverterLimitW).
 * (Losses include the inverter efficiency, so dcW is the "unlimited AC" power.)
 */
export function floorPowerW(poa: number, airTempC: number, config: Config): { dcW: number; acW: number } {
  const p = powerParams(config);
  const dcW = rowDcW(poa, airTempC, p);
  return { dcW, acW: Math.min(dcW, p.limitW) };
}

/** Per-config quantities shared by all time steps (build once per config/horizon change). */
export interface FloorModel {
  layout: PanelLayout;
  numFloors: number;
  facadeAzimuth: number;
  /** Horizon per floor (null = flat). */
  horizons: (HorizonProfile | null)[];
  /** Sky view factor per floor as installed (row above present except for the top floor). */
  skyView: number[];
  /** Sky view factor per floor without a row above (unshaded reference). */
  skyViewUnshaded: number[];
  /** albedo·(1 − cos β)/2 */
  groundFactor: number;
  substring: boolean;
  facade: boolean;
  power: PowerParams;
}

/** Builds the FloorModel: layout, per-floor horizons and sky view factors (≈ 2 ms). */
export function createFloorModel(
  config: Config,
  horizons: readonly (HorizonProfile | null | undefined)[],
  opts: SimulationOptions = {},
): FloorModel {
  const layout = panelLayout(config);
  const n = config.building.numFloors;
  const facade = opts.facade ?? true;
  const gamma = config.building.facadeAzimuth;
  const grid = skyViewGrid(layout, { gridDeg: opts.skyGridDeg, facade });
  const hz: (HorizonProfile | null)[] = [];
  const skyView: number[] = [];
  const skyViewUnshaded: number[] = [];
  for (let k = 0; k < n; k++) {
    const h = horizons[k] ?? null;
    hz.push(h);
    const open = skyViewFromGrid(grid, h, gamma, false);
    skyViewUnshaded.push(open);
    skyView.push(k < n - 1 ? skyViewFromGrid(grid, h, gamma, true) : open);
  }
  return {
    layout,
    numFloors: n,
    facadeAzimuth: gamma,
    horizons: hz,
    skyView,
    skyViewUnshaded,
    groundFactor: config.system.albedo * groundViewFactor(layout),
    substring: config.system.shadingModel === 'substring',
    facade,
    power: powerParams(config),
  };
}

/** Per-floor output of one time step (buffers reused between steps). */
export interface StepResult {
  /** POA irradiance incl. shading, W/m². */
  poa: Float64Array;
  /** Output before / after the inverter limit, W. */
  dcW: Float64Array;
  acW: Float64Array;
  /** Shaded area fraction of the row by the row above (0 if the beam does not reach the floor). */
  shade: Float64Array;
  /** Same without the row above (unshaded reference); filled only when requested. */
  poaUnshaded: Float64Array;
  dcUnshadedW: Float64Array;
  acUnshadedW: Float64Array;
}

/** Allocates a StepResult for `numFloors` floors. */
export function createStepResult(numFloors: number): StepResult {
  const f = (): Float64Array => new Float64Array(numFloors);
  return { poa: f(), dcW: f(), acW: f(), shade: f(), poaUnshaded: f(), dcUnshadedW: f(), acUnshadedW: f() };
}

/**
 * Evaluates all floors for one instant: sun (apparent altitude/azimuth, degrees) and its facade-frame
 * vector `sf`, irradiance sample and air temperature. Beam reaches floor k if the sun is above the horizontal,
 * in front of the facade (unless free-standing), in front of the panel and above that floor's horizon.
 * Floors below the top lose the beam share of the row above (linear: shaded area; substring: substringBeamLoss)
 * and use their reduced sky view factor. Writes into `out`; the unshaded reference only if `withUnshaded`.
 */
export function evaluateStep(
  model: FloorModel,
  altitude: number,
  azimuth: number,
  sf: FacadeVector,
  sample: IrradianceSample,
  airTempC: number,
  out: StepResult,
  withUnshaded: boolean,
): void {
  const { layout, numFloors: n, power } = model;
  const ci = cosIncidence(sf, layout);
  const beamOk = sample.dni > 0 && altitude > 0 && sf.z > 0 && ci > 0 && (!model.facade || sf.n > 0);
  const beamBase = beamOk ? sample.dni * ci * iamAshrae(ci) : 0;

  // The row geometry is identical on every floor: one shade evaluation serves all floors below the top.
  let shadeFrac = 0;
  let beamLoss = 0;
  if (beamBase > 0 && n > 1) {
    const s = shadeFromAbove(sf, layout);
    shadeFrac = s.fraction;
    if (s.fraction > 0) {
      const loss = model.substring ? substringBeamLoss(s, layout) : s.perModule;
      let sum = 0;
      for (const x of loss) sum += x;
      beamLoss = loss.length > 0 ? sum / loss.length : 0;
    }
  }
  const ground = sample.ghi * model.groundFactor;
  for (let k = 0; k < n; k++) {
    const h = model.horizons[k];
    const visible = beamBase > 0 && !(h && altitude < horizonAt(h, azimuth));
    const beam = visible ? beamBase : 0;
    const below = k < n - 1;
    const poa = (below ? beam * (1 - beamLoss) : beam) + sample.dhi * model.skyView[k] + ground;
    const dc = rowDcW(poa, airTempC, power);
    out.poa[k] = poa;
    out.dcW[k] = dc;
    out.acW[k] = Math.min(dc, power.limitW);
    out.shade[k] = visible && below ? shadeFrac : 0;
    if (withUnshaded) {
      const poaU = below ? beam + sample.dhi * model.skyViewUnshaded[k] + ground : poa;
      const dcU = below ? rowDcW(poaU, airTempC, power) : dc;
      out.poaUnshaded[k] = poaU;
      out.dcUnshadedW[k] = dcU;
      out.acUnshadedW[k] = Math.min(dcU, power.limitW);
    }
  }
}

// ── Yearly loop ──────────────────────────────

/** Sun positions of the daylight steps of a weather series (independent of tilt; reusable across configs). */
export interface SunTrack {
  /** Indices into the weather series of steps with any irradiance. */
  steps: Int32Array;
  altitude: Float64Array;
  azimuth: Float64Array;
  /** Sun vector in the facade frame. */
  su: Float64Array;
  sn: Float64Array;
  sz: Float64Array;
}

/** Sun position (NOAA, apparent) at every step with GHI, DNI or DHI > 0, for the config's site and facade. */
export function sunTrack(config: Config, weather: WeatherSeries): SunTrack {
  const { latitude, longitude } = config.location;
  const gamma = config.building.facadeAzimuth;
  const idx: number[] = [];
  for (let i = 0; i < weather.timesUtc.length; i++) {
    if (weather.ghi[i] > 0 || weather.dni[i] > 0 || weather.dhi[i] > 0) idx.push(i);
  }
  const m = idx.length;
  const t: SunTrack = {
    steps: Int32Array.from(idx),
    altitude: new Float64Array(m),
    azimuth: new Float64Array(m),
    su: new Float64Array(m),
    sn: new Float64Array(m),
    sz: new Float64Array(m),
  };
  for (let j = 0; j < m; j++) {
    const sun = sunPosition(weather.timesUtc[idx[j]], latitude, longitude);
    const sf = sunInFacade(sun, gamma);
    t.altitude[j] = sun.altitude;
    t.azimuth[j] = sun.azimuth;
    t.su[j] = sf.u;
    t.sn[j] = sf.n;
    t.sz[j] = sf.z;
  }
  return t;
}

/** Month index 0…11 of every step in local time of `timeZone` (steps outside the year: Dec before, Jan after). */
export function stepMonths(timesUtc: readonly number[], year: number, timeZone: string): Uint8Array {
  const offsets = dayOffsetsForYear(year, timeZone);
  const nDays = daysInYear(year);
  const monthOfDay = new Uint8Array(nDays);
  for (let m = 0, d = 0; m < 12; m++) {
    const len = Math.round((Date.UTC(year, m + 1, 1) - Date.UTC(year, m, 1)) / MS_PER_DAY);
    monthOfDay.fill(m, d, d + len);
    d += len;
  }
  const start = Date.UTC(year, 0, 1);
  const out = new Uint8Array(timesUtc.length);
  for (let i = 0; i < timesUtc.length; i++) {
    const t = timesUtc[i];
    const dUtc = Math.min(nDays - 1, Math.max(0, Math.floor((t - start) / MS_PER_DAY)));
    const dLocal = Math.floor((t + offsets[dUtc] * MS_PER_MINUTE - start) / MS_PER_DAY);
    out[i] = dLocal < 0 ? 11 : dLocal >= nDays ? 0 : monthOfDay[dLocal];
  }
  return out;
}

/** Accumulators of one yearly run (per floor). */
interface Totals {
  monthly: Float64Array[];
  monthlyUnshaded: Float64Array[];
  poaWh: Float64Array;
  clippedWh: Float64Array;
}

/** Yearly loop over the daylight steps of `track`; energies in Wh per floor (and month if `months` given). */
function runYear(
  model: FloorModel,
  weather: WeatherSeries,
  track: SunTrack,
  months: Uint8Array | null,
  withUnshaded: boolean,
): Totals {
  const n = model.numFloors;
  const hours = weather.stepMinutes / 60;
  const totals: Totals = {
    monthly: Array.from({ length: n }, () => new Float64Array(12)),
    monthlyUnshaded: Array.from({ length: n }, () => new Float64Array(12)),
    poaWh: new Float64Array(n),
    clippedWh: new Float64Array(n),
  };
  const out = createStepResult(n);
  const sf: FacadeVector = { u: 0, n: 0, z: 0 };
  const sample: IrradianceSample = { ghi: 0, dni: 0, dhi: 0 };
  for (let j = 0; j < track.steps.length; j++) {
    const i = track.steps[j];
    sf.u = track.su[j];
    sf.n = track.sn[j];
    sf.z = track.sz[j];
    sample.ghi = weather.ghi[i];
    sample.dni = weather.dni[i];
    sample.dhi = weather.dhi[i];
    evaluateStep(model, track.altitude[j], track.azimuth[j], sf, sample, weather.temperature[i], out, withUnshaded);
    const m = months ? months[i] : 0;
    for (let k = 0; k < n; k++) {
      totals.monthly[k][m] += out.acW[k] * hours;
      totals.poaWh[k] += out.poa[k] * hours;
      totals.clippedWh[k] += (out.dcW[k] - out.acW[k]) * hours;
      if (withUnshaded) totals.monthlyUnshaded[k][m] += out.acUnshadedW[k] * hours;
    }
  }
  return totals;
}

/** Annual AC energy per floor, kWh, without monthly split or unshaded reference (tilt sweeps etc.). */
export function annualFloorKwh(model: FloorModel, weather: WeatherSeries, track: SunTrack): number[] {
  const t = runYear(model, weather, track, null, false);
  return t.monthly.map((m) => m[0] / 1000);
}

const sum = (a: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s;
};

/** Inputs of simulateYear that callers may have built already (e.g. cached across tilt changes). */
export interface PrebuiltInputs {
  /** createFloorModel(config, horizons, opts) — must match the config, horizons AND options of the call. */
  model?: FloorModel;
  /** sunTrack(config, weather) — depends only on the site, the facade azimuth and the weather series. */
  track?: SunTrack;
}

/**
 * Yearly energy per floor for `weather` (sun position at each interval midpoint, config's site).
 * `horizons[k]` = horizon of floor k (missing = flat). Monthly values in local time of the site.
 * The unshaded reference of a floor removes the row above (beam shading and sky blocking); for the top floor
 * it equals the actual yield. ≈ 15–40 ms for 8760 steps × 8 floors × 8 modules, of which the floor model and
 * the sun track take ≈ 6–8 ms (reusable via `prebuilt`).
 */
export function simulateYear(
  config: Config,
  weather: WeatherSeries,
  horizons: readonly (HorizonProfile | null | undefined)[],
  opts: SimulationOptions = {},
  prebuilt: PrebuiltInputs = {},
): SimulationResult {
  const model = prebuilt.model ?? createFloorModel(config, horizons, opts);
  const track = prebuilt.track ?? sunTrack(config, weather);
  const months = stepMonths(weather.timesUtc, weather.year, config.location.timezone);
  const t = runYear(model, weather, track, months, true);
  const ratedKw = model.power.ratedW / 1000;
  const floors: FloorYield[] = [];
  for (let k = 0; k < model.numFloors; k++) {
    const monthlyKwh = Array.from(t.monthly[k], (x) => x / 1000);
    const monthlyUnshadedKwh = Array.from(t.monthlyUnshaded[k], (x) => x / 1000);
    const annualKwh = sum(monthlyKwh);
    const annualUnshadedKwh = sum(monthlyUnshadedKwh);
    const shadingLossKwh = Math.max(0, annualUnshadedKwh - annualKwh);
    floors.push({
      floor: k,
      storey: config.building.lowestFloor + k,
      monthlyKwh,
      annualKwh,
      monthlyUnshadedKwh,
      annualUnshadedKwh,
      shadingLossKwh,
      shadingLossPct: annualUnshadedKwh > 0 ? (shadingLossKwh / annualUnshadedKwh) * 100 : 0,
      poaKwhPerM2: t.poaWh[k] / 1000,
      clippedKwh: t.clippedWh[k] / 1000,
      specificYield: ratedKw > 0 ? annualKwh / ratedKw : 0,
      skyViewFactor: model.skyView[k],
    });
  }
  const totalMonthlyKwh = Array.from({ length: 12 }, (_, m) => floors.reduce((s, f) => s + f.monthlyKwh[m], 0));
  return {
    source: weather.source,
    year: weather.year,
    floors,
    totalAnnualKwh: sum(totalMonthlyKwh),
    totalMonthlyKwh,
    totalShadingLossKwh: floors.reduce((s, f) => s + f.shadingLossKwh, 0),
  };
}
