import type { EconomicsConfig, EconomicsResult } from './types';

// ─────────────────────────────────────────────
// ECONOMICS
// Year n (1-based) produces annualKwh·(1 − d)^(n−1); savings accrue evenly within a year.
// No discounting, constant prices.
// ─────────────────────────────────────────────

/** Payback searches stop after this many years (→ Infinity). */
const MAX_PAYBACK_YEARS = 1000;

/**
 * Savings and payback for `annualKwh` (year 1) produced by `floors` floor systems.
 * Self-consumed energy saves the electricity price, the rest earns the feed-in tariff.
 * paybackYears: first time the cumulative savings (with degradation, linear within a year) reach the
 * investment — 0 without investment; may exceed lifetimeYears (the search is not cut at the lifetime);
 * Infinity only if never reached within MAX_PAYBACK_YEARS. lifetimeNet = savings over lifetimeYears − investment.
 */
export function economics(annualKwh: number, floors: number, e: EconomicsConfig): EconomicsResult {
  const kwh = Math.max(0, annualKwh);
  const investment = Math.max(0, e.investmentPerFloor * floors);
  const share = Math.min(100, Math.max(0, e.selfConsumptionPct)) / 100;
  const selfConsumedKwh = kwh * share;
  const exportedKwh = kwh - selfConsumedKwh;
  const annualSavings = selfConsumedKwh * e.electricityPrice + exportedKwh * e.feedInTariff;
  const q = 1 - Math.min(100, Math.max(0, e.degradationPct)) / 100; // yearly output factor

  let paybackYears = Infinity;
  if (investment <= 0) paybackYears = 0;
  else if (annualSavings > 0) {
    let cum = 0;
    let yearSavings = annualSavings;
    for (let n = 0; n < MAX_PAYBACK_YEARS && yearSavings > 0; n++) {
      if (cum + yearSavings >= investment) {
        paybackYears = n + (investment - cum) / yearSavings;
        break;
      }
      cum += yearSavings;
      yearSavings *= q;
    }
  }

  let lifetimeSavings = 0;
  let yearSavings = annualSavings;
  const years = Math.max(0, Math.floor(e.lifetimeYears));
  for (let n = 0; n < years; n++) {
    lifetimeSavings += yearSavings;
    yearSavings *= q;
  }

  return {
    annualKwh: kwh,
    selfConsumedKwh,
    exportedKwh,
    annualSavings,
    paybackYears,
    lifetimeNet: lifetimeSavings - investment,
    investment,
  };
}
