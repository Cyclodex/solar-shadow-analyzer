import type {
  BaselineFlows,
  BatteryConfig,
  BatteryFlows,
  BatteryResult,
  BatterySeries,
  FacadeVector,
  IrradianceSample,
  WeatherSeries,
} from './types';
import { createStepResult, evaluateStep, type FloorModel, type SunTrack } from './simulation';
import { daysInYear, localClockMinutes, localToUtc } from './time';

// ─────────────────────────────────────────────
// BATTERY STORAGE (balcony storage with integrated MPPT and inverter, e.g. EcoFlow STREAM)
// Energy flow per weather step and storage system (docs/ARCHITECTURE.md, "Batteriespeicher"):
//   PV (after system losses, before any AC limit) → PV input limit (MPPT) → standby
//   → direct output (strategy threshold) → charging (charging power, free capacity, η_charge)
//   → surplus output up to the AC limit → rest curtailed
//   → discharging towards the strategy target (discharging power, AC limit, reserve, η_discharge).
// Efficiencies are relative to the direct path: the system losses (config.system.lossesPct) already contain the
// inverter, so η_charge·η_discharge is the extra loss of a kWh that takes the way through the battery.
// The household (one load for all systems) consumes the AC output first from direct PV, then from the battery;
// the rest of the output is fed into the grid. Energies in Wh inside, kWh in the result.
// ─────────────────────────────────────────────

/** Storage parameters of one system (all systems are identical). */
export interface BatteryParams {
  /** Usable capacity, Wh (0 = no battery). */
  capacityWh: number;
  /** Energy kept as reserve, Wh. */
  reserveWh: number;
  pvInputW: number;
  chargeW: number;
  dischargeW: number;
  acLimitW: number;
  /** 0…1 */
  etaCharge: number;
  etaDischarge: number;
  standbyW: number;
  strategy: BatteryConfig['strategy'];
  baseLoadW: number;
}

export function batteryParams(b: BatteryConfig): BatteryParams {
  const capacityWh = Math.max(0, b.units * b.unitCapacityWh);
  return {
    capacityWh,
    reserveWh: (capacityWh * Math.min(100, Math.max(0, b.minSocPct))) / 100,
    pvInputW: b.pvInputW,
    chargeW: b.chargeW,
    dischargeW: b.dischargeW,
    acLimitW: b.acLimitW,
    etaCharge: b.chargeEfficiencyPct / 100,
    etaDischarge: b.dischargeEfficiencyPct / 100,
    standbyW: b.standbyW,
    strategy: b.strategy,
    baseLoadW: b.baseLoadW,
  };
}

/** Number of storage systems for `numFloors` floors. */
export function batterySystems(layout: BatteryConfig['layout'], numFloors: number): number {
  return layout === 'per-floor' ? numFloors : 1;
}

// ── PV input ─────────────────────────────────

/**
 * PV power per weather step and floor after system losses and before any AC limit (FloorModel dcW), W;
 * row-major [step · numFloors + floor], 0 at night. Depends only on the PV model and the weather.
 */
export function pvPowerMatrix(model: FloorModel, weather: WeatherSeries, track: SunTrack): Float64Array {
  const n = model.numFloors;
  const out = new Float64Array(weather.timesUtc.length * n);
  const step = createStepResult(n);
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
    evaluateStep(model, track.altitude[j], track.azimuth[j], sf, sample, weather.temperature[i], step, false);
    for (let k = 0; k < n; k++) out[i * n + k] = step.dcW[k];
  }
  return out;
}

/** Sums the floor columns of `pvFloors` into `systems` columns (1 = all floors, numFloors = one each). */
export function pvPerSystem(pvFloors: Float64Array, numFloors: number, systems: number): Float64Array {
  if (systems === numFloors) return pvFloors;
  const steps = pvFloors.length / numFloors;
  const out = new Float64Array(steps * systems);
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < numFloors; k++) out[i * systems + (k % systems)] += pvFloors[i * numFloors + k];
  }
  return out;
}

// ── Dispatch ─────────────────────────────────

export interface DispatchInput {
  /** PV power per step and system, W, row-major [step · systems + system]. */
  pvW: Float64Array;
  systems: number;
  /** Household load per step, W. */
  loadW: Float64Array;
  stepHours: number;
  /** Month (0…11) of every step; all in month 0 if omitted. */
  months?: Uint8Array;
}

/** Per-step series (W) filled when requested. */
interface Recorder {
  pv: Float32Array;
  direct: Float32Array;
  charge: Float32Array;
  discharge: Float32Array;
  load: Float32Array;
  exported: Float32Array;
  imported: Float32Array;
  soc: Float32Array;
}

export interface DispatchResult {
  /** Wh per month. */
  monthly: BatteryFlows[];
  baselineMonthly: BaselineFlows[];
  annual: BatteryFlows;
  baselineAnnual: BaselineFlows;
  /** Energy taken from the cells (discharging incl. its losses, standby from the battery), Wh. */
  cellOutWh: number;
  /** Stored energy of each system at the start (after the warm-up pass) and at the end, Wh. */
  startWh: number[];
  endWh: number[];
  series: Recorder | null;
}

export const emptyFlows = (): BatteryFlows => ({
  pv: 0,
  pvInputLimited: 0,
  direct: 0,
  charged: 0,
  discharged: 0,
  selfDirect: 0,
  selfBattery: 0,
  exported: 0,
  imported: 0,
  load: 0,
  curtailed: 0,
  chargeLoss: 0,
  dischargeLoss: 0,
  standby: 0,
  storedDelta: 0,
});

export const emptyBaseline = (): BaselineFlows => ({
  output: 0,
  selfConsumed: 0,
  exported: 0,
  imported: 0,
  curtailed: 0,
});

function addFlows(into: BatteryFlows, from: BatteryFlows): void {
  for (const k of Object.keys(into) as (keyof BatteryFlows)[]) into[k] += from[k];
}

function addBaseline(into: BaselineFlows, from: BaselineFlows): void {
  for (const k of Object.keys(into) as (keyof BaselineFlows)[]) into[k] += from[k];
}

/**
 * One pass over all steps. `stored` (Wh per system) is the start state and is updated in place. Accumulates
 * into `monthly` / `baseline` when given.
 */
function runPass(
  input: DispatchInput,
  p: BatteryParams,
  stored: Float64Array,
  monthly: BatteryFlows[] | null,
  baseline: BaselineFlows[] | null,
  rec: Recorder | null,
): number {
  const { pvW, systems: S, loadW, stepHours: h, months } = input;
  const steps = loadW.length;
  const L = Math.max(0, p.acLimitW);
  const cap = p.capacityWh;
  const reserve = Math.min(p.reserveWh, cap);
  const etaC = Math.max(0, p.etaCharge);
  const etaD = Math.max(0, p.etaDischarge);
  const hasBattery = cap > 0;
  const chargeMax = Math.max(0, p.chargeW);
  const dischargeMax = Math.max(0, p.dischargeW);
  const standby = hasBattery ? Math.max(0, p.standbyW) : 0;
  const pvIn = hasBattery ? Math.max(0, p.pvInputW) : Infinity;

  const pv = new Float64Array(S);
  const direct = new Float64Array(S);
  const exp = new Float64Array(S);
  const avail = new Float64Array(S);
  const f = emptyFlows();
  let cellOut = 0;

  for (let i = 0; i < steps; i++) {
    const load = Math.max(0, loadW[i]);
    let stepPv = 0;
    let standbyGrid = 0;
    // Zero the step accumulators (reused object).
    for (const k of Object.keys(f) as (keyof BatteryFlows)[]) f[k] = 0;

    // 1. PV input limit and standby (from PV, then the battery above the reserve, then the grid).
    for (let j = 0; j < S; j++) {
      const raw = Math.max(0, pvW[i * S + j]);
      stepPv += raw;
      let x = Math.min(raw, pvIn);
      f.pvInputLimited += (raw - x) * h;
      if (standby > 0) {
        const fromPv = Math.min(x, standby);
        x -= fromPv;
        let rest = standby - fromPv;
        const fromBat = Math.min(rest, Math.max(0, stored[j] - reserve) / h);
        stored[j] -= fromBat * h;
        cellOut += fromBat * h;
        rest -= fromBat;
        standbyGrid += rest;
        f.standby += standby * h;
      }
      pv[j] = x;
    }
    f.pv = stepPv * h;

    // 2. Direct output (threshold of the strategy).
    if (p.strategy === 'self-consumption') {
      let capSum = 0;
      for (let j = 0; j < S; j++) capSum += Math.min(pv[j], L);
      const share = capSum > 0 ? Math.min(1, load / capSum) : 0;
      for (let j = 0; j < S; j++) direct[j] = Math.min(pv[j], L) * share;
    } else {
      const threshold = p.strategy === 'base-load' ? Math.min(Math.max(0, p.baseLoadW), L) : L;
      for (let j = 0; j < S; j++) direct[j] = Math.min(pv[j], threshold);
    }

    // 3. Charging, 4. surplus output up to the AC limit, rest curtailed.
    let directSum = 0;
    for (let j = 0; j < S; j++) {
      const surplus = pv[j] - direct[j];
      let charge = 0;
      if (hasBattery && surplus > 0 && etaC > 0) {
        const room = Math.max(0, cap - stored[j]) / (etaC * h);
        charge = Math.min(surplus, chargeMax, room);
        stored[j] += charge * etaC * h;
        f.charged += charge * h;
        f.chargeLoss += charge * (1 - etaC) * h;
        if (rec) rec.charge[i] += charge;
      }
      const out = Math.min(surplus - charge, Math.max(0, L - direct[j]));
      exp[j] = out;
      f.curtailed += (surplus - charge - out) * h;
      directSum += direct[j] + out;
    }

    // 5. Discharging towards the target.
    let dischargeSum = 0;
    if (hasBattery && etaD > 0) {
      let availSum = 0;
      for (let j = 0; j < S; j++) {
        const headroom = Math.max(0, L - direct[j] - exp[j]);
        const energy = (Math.max(0, stored[j] - reserve) * etaD) / h;
        avail[j] = Math.min(dischargeMax, headroom, energy);
        availSum += avail[j];
      }
      if (p.strategy === 'self-consumption') {
        const need = Math.max(0, load - directSum);
        const share = availSum > 0 ? Math.min(1, need / availSum) : 0;
        for (let j = 0; j < S; j++) avail[j] *= share;
      } else {
        const target = Math.max(0, p.baseLoadW);
        for (let j = 0; j < S; j++) avail[j] = Math.min(avail[j], Math.max(0, target - direct[j] - exp[j]));
      }
      for (let j = 0; j < S; j++) {
        const x = avail[j];
        if (x <= 0) continue;
        stored[j] -= (x / etaD) * h;
        cellOut += (x / etaD) * h;
        f.dischargeLoss += x * (1 / etaD - 1) * h;
        dischargeSum += x;
      }
    }

    // 6. Household: direct PV first, then the battery; the rest of the output is fed in.
    const selfDirect = Math.min(directSum, load);
    const selfBattery = Math.min(dischargeSum, load - selfDirect);
    f.direct = directSum * h;
    f.discharged = dischargeSum * h;
    f.selfDirect = selfDirect * h;
    f.selfBattery = selfBattery * h;
    f.exported = (directSum + dischargeSum - selfDirect - selfBattery) * h;
    f.imported = (load - selfDirect - selfBattery + standbyGrid) * h;
    f.load = load * h;

    const m = months ? months[i] : 0;
    if (monthly) addFlows(monthly[m], f);

    // Baseline: the same systems as plain inverters with the same AC limit, no standby.
    if (baseline) {
      let out = 0;
      let raw = 0;
      for (let j = 0; j < S; j++) {
        const x = Math.max(0, pvW[i * S + j]);
        raw += x;
        out += Math.min(x, L);
      }
      const self = Math.min(out, load);
      const b = baseline[m];
      b.output += out * h;
      b.selfConsumed += self * h;
      b.exported += (out - self) * h;
      b.imported += (load - self) * h;
      b.curtailed += (raw - out) * h;
    }

    if (rec) {
      let e = 0;
      for (let j = 0; j < S; j++) e += stored[j];
      rec.pv[i] = stepPv;
      rec.direct[i] = directSum;
      rec.discharge[i] = dischargeSum;
      rec.load[i] = load;
      rec.exported[i] = f.exported / h;
      rec.imported[i] = f.imported / h;
      rec.soc[i] = cap > 0 ? e / (cap * S) : 0;
    }
  }
  return cellOut;
}

/**
 * Runs the storage over all steps. The start state is periodic: a first pass from the reserve gives the
 * stored energy at the end of the period, the second (reported) pass starts from it, so 31 December flows
 * into 1 January as in a continuous operation. Energies in Wh.
 */
export function dispatchBattery(input: DispatchInput, p: BatteryParams, record = false): DispatchResult {
  const S = input.systems;
  const steps = input.loadW.length;
  if (input.pvW.length !== steps * S) throw new RangeError('pvW does not match loadW × systems');
  const reserve = Math.min(p.reserveWh, p.capacityWh);
  const stored = new Float64Array(S).fill(reserve);
  if (p.capacityWh > 0) runPass(input, p, stored, null, null, null);
  const startWh = Array.from(stored);
  const monthly = Array.from({ length: 12 }, emptyFlows);
  const baselineMonthly = Array.from({ length: 12 }, emptyBaseline);
  const f32 = (): Float32Array => new Float32Array(steps);
  const rec: Recorder | null = record
    ? {
        pv: f32(),
        direct: f32(),
        charge: f32(),
        discharge: f32(),
        load: f32(),
        exported: f32(),
        imported: f32(),
        soc: f32(),
      }
    : null;
  const cellOutWh = runPass(input, p, stored, monthly, baselineMonthly, rec);
  const endWh = Array.from(stored);
  const annual = emptyFlows();
  for (const m of monthly) addFlows(annual, m);
  annual.storedDelta = endWh.reduce((a, b) => a + b, 0) - startWh.reduce((a, b) => a + b, 0);
  const baselineAnnual = emptyBaseline();
  for (const b of baselineMonthly) addBaseline(baselineAnnual, b);
  return { monthly, baselineMonthly, annual, baselineAnnual, cellOutWh, startWh, endWh, series: rec };
}

// ── Result ───────────────────────────────────

const toKwh = <T extends object>(o: T): T => {
  const out = { ...o } as Record<string, number>;
  for (const k of Object.keys(out)) out[k] /= 1000;
  return out as T;
};

const pct = (part: number, whole: number): number => (whole > 0 ? (part / whole) * 100 : 0);

/**
 * Storage simulation for a year of weather: `pvFloors` from pvPowerMatrix, `loadW` from householdLoadW,
 * `months` from stepMonths. The monthly stored-energy change is not tracked (0); the annual one is.
 */
export function simulateBattery(
  battery: BatteryConfig,
  numFloors: number,
  weather: WeatherSeries,
  pvFloors: Float64Array,
  loadW: Float64Array,
  months: Uint8Array,
): BatteryResult {
  const systems = batterySystems(battery.layout, numFloors);
  const p = batteryParams(battery);
  const r = dispatchBattery(
    {
      pvW: pvPerSystem(pvFloors, numFloors, systems),
      systems,
      loadW,
      stepHours: weather.stepMinutes / 60,
      months,
    },
    p,
    true,
  );
  const annual = toKwh(r.annual);
  const baseAnnual = toKwh(r.baselineAnnual);
  const capacityWh = p.capacityWh * systems;
  const selfWith = annual.selfDirect + annual.selfBattery;
  const rec = r.series as Recorder;
  const series: BatterySeries = { timesUtc: weather.timesUtc, stepMinutes: weather.stepMinutes, ...rec };
  return {
    source: weather.source,
    year: weather.year,
    systems,
    capacityKwh: capacityWh / 1000,
    annual,
    monthly: r.monthly.map(toKwh),
    baseline: { annual: baseAnnual, monthly: r.baselineMonthly.map(toKwh) },
    cycles: capacityWh > 0 ? r.cellOutWh / capacityWh : 0,
    selfConsumptionPct: pct(selfWith, annual.pv),
    baselineSelfConsumptionPct: pct(baseAnnual.selfConsumed, annual.pv),
    autarkyPct: pct(selfWith, annual.load),
    baselineAutarkyPct: pct(baseAnnual.selfConsumed, annual.load),
    extraOutputKwh: annual.direct + annual.discharged - baseAnnual.output,
    extraSelfKwh: selfWith - baseAnnual.selfConsumed,
    series,
  };
}

// ── Day view ─────────────────────────────────

/** One weather step of a day, W (soc 0…1); `minutes` = local clock minutes of the step's midpoint. */
export interface BatteryDayPoint {
  minutes: number;
  pv: number;
  direct: number;
  charge: number;
  discharge: number;
  load: number;
  exported: number;
  imported: number;
  soc: number;
}

/**
 * The same calendar day as `date` (month and day) in the result's weather year (29 February → 28 February in
 * a common year), as "YYYY-MM-DD".
 */
export function dayInYear(date: string, year: number): string {
  const month = date.slice(5, 7);
  let day = date.slice(8, 10);
  if (month === '02' && day === '29' && daysInYear(year) === 365) day = '28';
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}

/** Steps of the local day `day` ("YYYY-MM-DD" in the weather year) from the result's series. */
export function batteryDay(series: BatterySeries, day: string, timeZone: string): BatteryDayPoint[] {
  const start = localToUtc(day, 0, timeZone);
  const end = localToUtc(day, 1440, timeZone);
  const out: BatteryDayPoint[] = [];
  const t = series.timesUtc;
  for (let i = 0; i < t.length; i++) {
    if (t[i] < start || t[i] >= end) continue;
    out.push({
      minutes: localClockMinutes(t[i], day, timeZone),
      pv: series.pv[i],
      direct: series.direct[i],
      charge: series.charge[i],
      discharge: series.discharge[i],
      load: series.load[i],
      exported: series.exported[i],
      imported: series.imported[i],
      soc: series.soc[i],
    });
  }
  return out;
}
