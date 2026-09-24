import type { SimulationResult } from '../../model/types';

// ─────────────────────────────────────────────
// SHADING TOTALS
// Shading loss of all floors, one definition for the KPI bar, the monthly chart and the monthly table:
// the sum over the floors of (yield without shading by the floor above − yield), never negative per floor.
// ─────────────────────────────────────────────

export interface ShadingTotals {
  /** Yield of all floors without shading by the floor above, kWh. */
  unshadedKwh: number;
  /** Shading loss of all floors, kWh. */
  lossKwh: number;
  /** lossKwh / unshadedKwh, % (0 without any unshaded yield). */
  lossPct: number;
}

/** Shading totals of the year, or of `month` (0…11). The year's loss equals sim.totalShadingLossKwh. */
export function shadingTotals(sim: SimulationResult, month?: number): ShadingTotals {
  let unshadedKwh = 0;
  let lossKwh = 0;
  for (const fl of sim.floors) {
    const unshaded = month === undefined ? fl.annualUnshadedKwh : fl.monthlyUnshadedKwh[month];
    const kwh = month === undefined ? fl.annualKwh : fl.monthlyKwh[month];
    unshadedKwh += unshaded;
    lossKwh += Math.max(0, unshaded - kwh);
  }
  return { unshadedKwh, lossKwh, lossPct: unshadedKwh > 0 ? (lossKwh / unshadedKwh) * 100 : 0 };
}
