import { describe, it, expect } from 'vitest';
import { batteryInvestments, economics, economicsFromFlows } from './economics';
import { DEFAULT_CONFIG } from './defaults';
import type { EconomicsConfig } from './types';

const E: EconomicsConfig = {
  ...DEFAULT_CONFIG.economics,
  electricityPrice: 0.3,
  feedInTariff: 0.08,
  selfConsumptionPct: 70,
  investmentPerFloor: 900,
  degradationPct: 0.5,
  lifetimeYears: 25,
};

describe('economics', () => {
  it('hand-computed example with degradation', () => {
    // 1000 kWh, 2 floors: self 700 kWh·0.30 = 210, export 300 kWh·0.08 = 24 → a = 234 per year; I = 1800.
    // Year n saves a·q^(n−1), q = 0.995; cumulative S(N) = a·(1 − q^N)/(1 − q) (geometric series).
    // S(7) = 1613.6… < 1800 ≤ S(8) = 1839.5… → payback = 7 + (I − S(7)) / (a·q^7).
    const r = economics(1000, 2, E);
    const a = 234;
    const q = 0.995;
    const S = (n: number): number => (a * (1 - q ** n)) / (1 - q);
    expect(S(7)).toBeLessThan(1800);
    expect(S(8)).toBeGreaterThanOrEqual(1800);
    expect(r.annualKwh).toBe(1000);
    expect(r.selfConsumedKwh).toBeCloseTo(700, 12);
    expect(r.exportedKwh).toBeCloseTo(300, 12);
    expect(r.annualSavings).toBeCloseTo(a, 12);
    expect(r.investment).toBe(1800);
    expect(r.paybackYears).toBeCloseTo(7 + (1800 - S(7)) / (a * q ** 7), 10);
    expect(r.lifetimeNet).toBeCloseTo(S(25) - 1800, 9);
  });

  it('without degradation: payback = I / a, lifetime net = N·a − I', () => {
    const r = economics(2000, 1, { ...E, degradationPct: 0 });
    // a = 1400·0.3 + 600·0.08 = 468.
    expect(r.annualSavings).toBeCloseTo(468, 12);
    expect(r.paybackYears).toBeCloseTo(900 / 468, 12);
    expect(r.lifetimeNet).toBeCloseTo(25 * 468 - 900, 9);
  });

  it('never pays back when the degrading savings converge below the investment', () => {
    // 100 kWh, all exported at 0.1 → a = 10; with 3 %/yr the total ever saved is a/(1 − q) = 333.3 < 900.
    const r = economics(100, 1, { ...E, selfConsumptionPct: 0, feedInTariff: 0.1, degradationPct: 3 });
    expect(r.annualSavings).toBeCloseTo(10, 12);
    expect(r.paybackYears).toBe(Infinity);
    expect(r.lifetimeNet).toBeLessThan(0);
  });

  it('payback beyond the lifetime stays finite (lifetime does not cut the search)', () => {
    // 600 kWh, 3 floors: self 480 kWh·0.30 = 144, export 120 kWh·0.08 = 9.6 → a = 153.6; I = 4500; q = 0.975.
    // Total ever saved a/(1 − q) = 6144 > I → finite. S(N) = a·(1 − q^N)/(1 − q) ≥ I ⇔ N ≥ ln(1 − I(1 − q)/a)/ln q
    // = ln(0.267578125)/ln(0.975) = 52.07… → 52 full years, then linear within year 53 (independent closed form).
    const r = economics(600, 3, {
      ...E,
      selfConsumptionPct: 80,
      investmentPerFloor: 1500,
      degradationPct: 2.5,
    });
    const a = 153.6;
    const q = 0.975;
    const S = (n: number): number => (a * (1 - q ** n)) / (1 - q);
    const N = Math.floor(Math.log(1 - (4500 * (1 - q)) / a) / Math.log(q));
    expect(N).toBe(52);
    expect(r.paybackYears).toBeCloseTo(N + (4500 - S(N)) / (a * q ** N), 9);
    expect(r.paybackYears).toBeGreaterThan(25);
    expect(r.lifetimeNet).toBeCloseTo(S(25) - 4500, 9);
  });

  it('edge cases: no investment, no production', () => {
    expect(economics(1000, 2, { ...E, investmentPerFloor: 0 }).paybackYears).toBe(0);
    const zero = economics(0, 2, E);
    expect(zero.annualSavings).toBe(0);
    expect(zero.paybackYears).toBe(Infinity);
    expect(zero.lifetimeNet).toBe(-1800);
    expect(economics(-5, 1, E).annualKwh).toBe(0);
  });
});

describe('economicsFromFlows', () => {
  const e = DEFAULT_CONFIG.economics;

  it('equals economics() for the flows of its self-consumption share', () => {
    const a = economics(1000, 2, e);
    const b = economicsFromFlows(700, 300, 0, 1800, e);
    expect(b.annualSavings).toBeCloseTo(a.annualSavings, 12);
    expect(b.paybackYears).toBeCloseTo(a.paybackYears, 12);
    expect(b.lifetimeNet).toBeCloseTo(a.lifetimeNet, 12);
  });

  it('prices self-consumption, feed-in and grid-drawn standby', () => {
    // 1000 · 0.30 + 500 · 0.08 − 20 · 0.30 = 334
    const r = economicsFromFlows(1000, 500, 20, 3340, { ...e, degradationPct: 0 });
    expect(r.annualSavings).toBeCloseTo(334, 12);
    expect(r.paybackYears).toBeCloseTo(10, 12);
    expect(r.annualKwh).toBe(1500);
  });
});

describe('batteryInvestments', () => {
  const e = DEFAULT_CONFIG.economics;
  const b = DEFAULT_CONFIG.battery;

  it('without: the floors; with: minus what the storage replaces, plus the storage', () => {
    expect(batteryInvestments(e, b, 2)).toEqual({ without: 1800, replaced: 0, with: 1800 + 2998 });
    expect(batteryInvestments(e, { ...b, replacedInvestment: 600 }, 2)).toEqual({
      without: 1800,
      replaced: 600,
      with: 1200 + 2998,
    });
    // Capped at the floors' investment.
    expect(batteryInvestments(e, { ...b, replacedInvestment: 5000 }, 2).with).toBe(2998);
  });
});
