import { describe, it, expect } from 'vitest';
import {
  batteryParams,
  dispatchBattery,
  pvPerSystem,
  pvPowerMatrix,
  simulateBattery,
  type BatteryParams,
  type DispatchInput,
} from './battery';
import { createFloorModel, simulateYear, stepMonths, sunTrack } from './simulation';
import { householdLoadW } from './loadProfile';
import { clearSkyYear } from './weather';
import { emptyHorizon } from './horizon';
import { DEFAULT_CONFIG } from './defaults';
import type { BatteryConfig, BatteryFlows, BatteryStrategy, Config } from './types';

/** Mulberry32 — seeded PRNG for reproducible random cases. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const params = (over: Partial<BatteryParams> = {}): BatteryParams => ({
  capacityWh: 1000,
  reserveWh: 0,
  pvInputW: Infinity,
  chargeW: 2000,
  dischargeW: 2000,
  acLimitW: 600,
  etaCharge: 0.9,
  etaDischarge: 0.9,
  standbyW: 0,
  strategy: 'surplus',
  baseLoadW: 200,
  ...over,
});

const input = (pv: number[], load: number[], systems = 1): DispatchInput => ({
  pvW: Float64Array.from(pv),
  systems,
  loadW: Float64Array.from(load),
  stepHours: 1,
});

/** Random PV (W per system) and load series over `steps` hours. */
function randomInput(seed: number, steps: number, systems: number): DispatchInput {
  const rnd = prng(seed);
  const pv: number[] = [];
  const load: number[] = [];
  for (let i = 0; i < steps; i++) {
    const hour = i % 24;
    const day = hour >= 6 && hour <= 19 ? Math.sin(((hour - 6) / 13) * Math.PI) : 0;
    for (let j = 0; j < systems; j++) pv.push(day * 1200 * rnd());
    load.push(80 + 900 * rnd() ** 3);
  }
  return input(pv, load, systems);
}

/**
 * Energy balance of the flows (Wh or kWh): PV side and AC side. The grid part of the standby is
 * imported − (load − self-consumed).
 */
function expectBalanced(f: BatteryFlows, tol = 1e-6): void {
  const standbyGrid = f.imported - (f.load - f.selfDirect - f.selfBattery);
  const pvSide =
    f.pvInputLimited +
    f.direct +
    f.discharged +
    f.curtailed +
    f.chargeLoss +
    f.dischargeLoss +
    (f.standby - standbyGrid) +
    f.storedDelta;
  expect(pvSide).toBeCloseTo(f.pv, -Math.log10(tol * Math.max(1, f.pv)));
  expect(f.selfDirect + f.selfBattery + f.exported).toBeCloseTo(f.direct + f.discharged, 6);
  for (const v of Object.values(f) as number[])
    if (v !== f.storedDelta) expect(v).toBeGreaterThanOrEqual(-1e-9);
}

/**
 * Independent reference: one system, written step by step after the strategy descriptions in
 * docs/ARCHITECTURE.md (periodic start from a first pass). Returns the flows of the second pass, Wh.
 */
function reference(pv: number[], load: number[], p: BatteryParams) {
  const L = p.acLimitW;
  const run = (e0: number) => {
    let e = e0;
    const t = { direct: 0, charged: 0, discharged: 0, curtailed: 0, self: 0, exported: 0, imported: 0 };
    for (let i = 0; i < pv.length; i++) {
      const P = pv[i];
      const D = load[i];
      // Direct output.
      let direct: number;
      if (p.strategy === 'surplus') direct = Math.min(P, L);
      else if (p.strategy === 'base-load') direct = Math.min(P, p.baseLoadW, L);
      else direct = Math.min(P, L, D);
      // Charging with what is left.
      let rest = P - direct;
      const canStore = (p.capacityWh - e) / p.etaCharge;
      const charge = Math.max(0, Math.min(rest, p.chargeW, canStore));
      e += charge * p.etaCharge;
      rest -= charge;
      // Battery full or charging power exceeded: out up to the AC limit, the rest is lost.
      const extra = Math.min(rest, L - direct);
      const out = direct + extra;
      // Discharging.
      const want = p.strategy === 'self-consumption' ? D - out : p.baseLoadW - out;
      const discharge = Math.max(
        0,
        Math.min(want, p.dischargeW, L - out, (e - p.reserveWh) * p.etaDischarge),
      );
      e -= discharge / p.etaDischarge;
      const self = Math.min(out + discharge, D);
      t.direct += out;
      t.charged += charge;
      t.discharged += discharge;
      t.curtailed += rest - extra;
      t.self += self;
      t.exported += out + discharge - self;
      t.imported += D - self;
    }
    return { t, e };
  };
  const first = run(p.reserveWh);
  return run(first.e).t;
}

describe('dispatchBattery', () => {
  it('matches a hand-computed day (surplus strategy, η 0.9, periodic start)', () => {
    // PV 0/800/1000/300/0 W, load 200 W, AC limit 600 W, base load 200 W, 1 kWh.
    // Pass 1 from 0 Wh: +200·0.9, +400·0.9 → 540 Wh, −200/0.9 at night → 317.78 Wh (start of pass 2).
    // Pass 2: 317.78 − 222.22 = 95.56 → +180 = 275.56 → +360 = 635.56 → −222.22 = 413.33 Wh.
    const r = dispatchBattery(input([0, 800, 1000, 300, 0], [200, 200, 200, 200, 200]), params());
    const a = r.annual;
    expect(r.startWh[0]).toBeCloseTo(540 - 200 / 0.9, 9);
    expect(r.endWh[0]).toBeCloseTo(540 - 200 / 0.9 + 540 - 400 / 0.9, 9);
    expect(a.pv).toBeCloseTo(2100, 9);
    expect(a.direct).toBeCloseTo(1500, 9);
    expect(a.charged).toBeCloseTo(600, 9);
    expect(a.discharged).toBeCloseTo(400, 9);
    expect(a.chargeLoss).toBeCloseTo(60, 9);
    expect(a.dischargeLoss).toBeCloseTo(400 / 0.9 - 400, 9);
    expect(a.curtailed).toBeCloseTo(0, 9);
    expect(a.selfDirect).toBeCloseTo(600, 9);
    expect(a.selfBattery).toBeCloseTo(400, 9);
    expect(a.exported).toBeCloseTo(900, 9);
    expect(a.imported).toBeCloseTo(0, 9);
    expect(a.storedDelta).toBeCloseTo(540 - 400 / 0.9, 9);
    // Without battery: 0/600/600/300/0 W out, 600 Wh curtailed, 400 Wh bought at night.
    expect(r.baselineAnnual).toEqual({
      output: 1500,
      selfConsumed: 600,
      exported: 900,
      imported: 400,
      curtailed: 600,
    });
    expect(r.cellOutWh).toBeCloseTo(400 / 0.9, 9);
    expectBalanced(a);
  });

  it('matches a hand-computed day (self-consumption, η 1, reserve and charging limit)', () => {
    // PV 900 W at noon, load 300 W: 300 direct, charge ≤ 400 W, the rest (200 W) out up to 600 W.
    // Night load 500 W: the battery gives what it holds above the 100 Wh reserve.
    const p = params({
      strategy: 'self-consumption',
      etaCharge: 1,
      etaDischarge: 1,
      chargeW: 400,
      reserveWh: 100,
    });
    const r = dispatchBattery(input([0, 900, 0], [500, 300, 500]), p);
    const a = r.annual;
    // Pass 1: 100 → 500 → 100 (night) → pass 2 starts at 100 Wh: night 0 (reserve), noon +400, night −400.
    expect(r.startWh[0]).toBeCloseTo(100, 9);
    expect(a.direct).toBeCloseTo(300 + 200, 9);
    expect(a.charged).toBeCloseTo(400, 9);
    expect(a.discharged).toBeCloseTo(400, 9);
    expect(a.exported).toBeCloseTo(200, 9);
    expect(a.imported).toBeCloseTo(500 + 100, 9);
    expect(a.storedDelta).toBeCloseTo(0, 9);
    expectBalanced(a);
  });

  it('agrees with the independent reference for every strategy (random year, one system)', () => {
    for (const strategy of ['surplus', 'base-load', 'self-consumption'] as BatteryStrategy[]) {
      for (const seed of [1, 2, 3]) {
        const inp = randomInput(seed, 24 * 60, 1);
        const p = params({
          strategy,
          capacityWh: 1500 + 500 * seed,
          reserveWh: 150,
          chargeW: 700,
          dischargeW: 500,
        });
        const r = dispatchBattery(inp, p).annual;
        const ref = reference(Array.from(inp.pvW), Array.from(inp.loadW), p);
        expect(r.direct).toBeCloseTo(ref.direct, 6);
        expect(r.charged).toBeCloseTo(ref.charged, 6);
        expect(r.discharged).toBeCloseTo(ref.discharged, 6);
        expect(r.curtailed).toBeCloseTo(ref.curtailed, 6);
        expect(r.selfDirect + r.selfBattery).toBeCloseTo(ref.self, 6);
        expect(r.exported).toBeCloseTo(ref.exported, 6);
        expect(r.imported).toBeCloseTo(ref.imported, 6);
      }
    }
  });

  it('conserves energy for every strategy, shared and per system, with standby and PV input limit', () => {
    for (const strategy of ['surplus', 'base-load', 'self-consumption'] as BatteryStrategy[]) {
      for (const systems of [1, 3]) {
        const inp = randomInput(10 + systems, 24 * 90, systems);
        const p = params({ strategy, standbyW: 12, pvInputW: 900, reserveWh: 100, capacityWh: 2000 });
        const r = dispatchBattery(inp, p);
        expectBalanced(r.annual, 1e-9);
        // Battery side: stored = charged − charging losses − energy taken from the cells.
        const a = r.annual;
        expect(a.charged - a.chargeLoss - r.cellOutWh).toBeCloseTo(a.storedDelta, 6);
        expect(r.cellOutWh).toBeGreaterThanOrEqual(a.discharged + a.dischargeLoss - 1e-6);
        let pv = 0;
        for (const x of inp.pvW) pv += x;
        expect(r.annual.pv).toBeCloseTo(pv, 6);
        expect(r.annual.pvInputLimited).toBeGreaterThan(0);
        // Monthly flows add up to the year (storedDelta only annual).
        expect(r.monthly.reduce((s, m) => s + m.discharged, 0)).toBeCloseTo(r.annual.discharged, 6);
      }
    }
  });

  it('never exceeds the AC limit, the charging/discharging power or the capacity window', () => {
    const inp = randomInput(7, 24 * 30, 2);
    const p = params({
      strategy: 'self-consumption',
      capacityWh: 1200,
      reserveWh: 240,
      chargeW: 500,
      dischargeW: 300,
    });
    const r = dispatchBattery(inp, p, true);
    const s = r.series!;
    for (let i = 0; i < s.pv.length; i++) {
      expect(s.direct[i] + s.discharge[i]).toBeLessThanOrEqual(2 * p.acLimitW + 1e-3);
      expect(s.charge[i]).toBeLessThanOrEqual(2 * p.chargeW + 1e-3);
      expect(s.discharge[i]).toBeLessThanOrEqual(2 * p.dischargeW + 1e-3);
      expect(s.soc[i]).toBeGreaterThanOrEqual(0.2 - 1e-6);
      expect(s.soc[i]).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('capacity 0 is the plain inverter: output = min(PV, AC limit), no standby, no PV input limit', () => {
    for (const strategy of ['surplus', 'base-load', 'self-consumption'] as BatteryStrategy[]) {
      const inp = randomInput(3, 24 * 20, 2);
      const r = dispatchBattery(inp, params({ strategy, capacityWh: 0, standbyW: 50, pvInputW: 100 }));
      const a = r.annual;
      expect(a.direct).toBeCloseTo(r.baselineAnnual.output, 6);
      expect(a.discharged).toBe(0);
      expect(a.charged).toBe(0);
      expect(a.standby).toBe(0);
      expect(a.pvInputLimited).toBe(0);
      expect(a.curtailed).toBeCloseTo(r.baselineAnnual.curtailed, 6);
      expect(a.selfDirect).toBeCloseTo(r.baselineAnnual.selfConsumed, 6);
      expect(a.imported).toBeCloseTo(r.baselineAnnual.imported, 6);
    }
  });

  it('an unlimited battery stores every surplus (nothing curtailed) and a high AC limit curtails nothing', () => {
    const inp = randomInput(5, 24 * 30, 1);
    const big = dispatchBattery(
      inp,
      params({ capacityWh: 1e9, chargeW: Infinity, etaCharge: 1, etaDischarge: 1 }),
    );
    expect(big.annual.curtailed).toBeCloseTo(0, 9);
    expect(big.annual.charged).toBeCloseTo(big.baselineAnnual.curtailed, 6);
    const open = dispatchBattery(inp, params({ acLimitW: 1e6, capacityWh: 0 }));
    expect(open.annual.curtailed).toBe(0);
    expect(open.annual.direct).toBeCloseTo(open.annual.pv, 6);
  });
});

// ── Year simulation ───────────────────────────

const battery = (over: Partial<BatteryConfig> = {}): BatteryConfig => ({
  ...DEFAULT_CONFIG.battery,
  enabled: true,
  ...over,
});

function yearInputs(config: Config) {
  const weather = clearSkyYear(config.location.latitude, config.location.longitude, 2023);
  const horizons = Array.from({ length: config.building.numFloors }, () => emptyHorizon(1));
  const model = createFloorModel(config, horizons);
  const track = sunTrack(config, weather);
  const months = stepMonths(weather.timesUtc, weather.year, config.location.timezone);
  const pv = pvPowerMatrix(model, weather, track);
  return { weather, horizons, model, track, months, pv };
}

describe('simulateBattery', () => {
  const config: Config = structuredClone(DEFAULT_CONFIG);
  const { weather, horizons, months, pv } = yearInputs(config);
  const load = householdLoadW(
    weather.timesUtc,
    weather.stepMinutes,
    weather.year,
    'Europe/Zurich',
    2500,
    'h0',
  );

  it('capacity 0 per floor with the inverter limit reproduces simulateYear exactly', () => {
    const sim = simulateYear(config, weather, horizons);
    const b = battery({ layout: 'per-floor', unitCapacityWh: 0, acLimitW: config.system.inverterLimitW });
    const r = simulateBattery(b, 2, weather, pv, load, months);
    expect(r.annual.direct).toBeCloseTo(sim.totalAnnualKwh, 9);
    expect(r.baseline.annual.output).toBeCloseTo(sim.totalAnnualKwh, 9);
    for (let m = 0; m < 12; m++) expect(r.monthly[m].direct).toBeCloseTo(sim.totalMonthlyKwh[m], 9);
    const clipped = sim.floors.reduce((s, f) => s + f.clippedKwh, 0);
    expect(r.annual.curtailed).toBeCloseTo(clipped, 9);
    expect(r.annual.pv).toBeCloseTo(sim.totalAnnualKwh + clipped, 9);
    expect(r.extraOutputKwh).toBeCloseTo(0, 9);
    expect(r.cycles).toBe(0);
  });

  it('the default storage (2 × 3.84 kWh, 600 W shared) recovers the curtailed PV and raises self-consumption', () => {
    const r = simulateBattery(battery(), 2, weather, pv, load, months);
    expectBalanced(r.annual);
    expect(r.systems).toBe(1);
    expect(r.capacityKwh).toBeCloseTo(7.68, 12);
    expect(r.annual.load).toBeCloseTo(2500, 6);
    expect(r.extraOutputKwh).toBeGreaterThan(0);
    expect(r.extraSelfKwh).toBeGreaterThan(0);
    expect(r.autarkyPct).toBeGreaterThan(r.baselineAutarkyPct);
    expect(r.selfConsumptionPct).toBeGreaterThan(r.baselineSelfConsumptionPct);
    // Output with storage = baseline output + recovered curtailment − storage losses (− stored change).
    const a = r.annual;
    const recovered = r.baseline.annual.curtailed - a.curtailed - a.pvInputLimited;
    expect(r.extraOutputKwh).toBeCloseTo(
      recovered - a.chargeLoss - a.dischargeLoss - a.standby - a.storedDelta,
      6,
    );
    // Series: SoC within the reserve window, hourly load sums to the year.
    let e = 0;
    for (let i = 0; i < r.series.load.length; i++) e += r.series.load[i];
    expect(e / 1000).toBeCloseTo(2500, 1);
    expect(Math.min(...r.series.soc)).toBeGreaterThanOrEqual(0.1 - 1e-6);
  });

  it('per-floor splits the PV by floor, shared sums it', () => {
    const per = pvPerSystem(pv, 2, 2);
    expect(per).toBe(pv);
    const shared = pvPerSystem(pv, 2, 1);
    for (let i = 0; i < shared.length; i++) expect(shared[i]).toBeCloseTo(pv[2 * i] + pv[2 * i + 1], 9);
    const r = simulateBattery(battery({ layout: 'per-floor' }), 2, weather, pv, load, months);
    expect(r.systems).toBe(2);
    expect(r.capacityKwh).toBeCloseTo(15.36, 12);
    expectBalanced(r.annual);
  });

  it('batteryParams derives capacity and reserve from units and SoC', () => {
    const p = batteryParams(battery({ units: 3, unitCapacityWh: 2000, minSocPct: 15 }));
    expect(p.capacityWh).toBe(6000);
    expect(p.reserveWh).toBe(900);
  });
});
