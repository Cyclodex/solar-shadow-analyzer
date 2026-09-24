import type { HeatmapStats } from '../../model/analysis';
import type { SimulationResult } from '../../model/types';

// ─────────────────────────────────────────────
// MONTHLY TABLE DATA
// One row per calendar month (plus the year) from the simulation and the heatmap statistics.
// ─────────────────────────────────────────────

export interface MonthlyRow {
  /** 0…11, or null for the year total. */
  month: number | null;
  /** AC energy per floor (index = floor), kWh. */
  floorsKwh: number[];
  totalKwh: number;
  /** Shading loss of all floors (sum of unshaded − shaded per floor, as in the chart and the CSV export), kWh. */
  lossKwh: number;
  /** lossKwh / unshaded energy, %. */
  lossPct: number;
  /** Shaded hours of the analysed floor (null without heatmap statistics). */
  shadedHours: number | null;
}

const pct = (loss: number, unshaded: number): number => (unshaded > 0 ? (loss / unshaded) * 100 : 0);

/** 12 month rows and the year row. */
export function monthlyRows(
  sim: SimulationResult,
  stats: HeatmapStats | null,
): { months: MonthlyRow[]; year: MonthlyRow } {
  const months = Array.from({ length: 12 }, (_, m): MonthlyRow => {
    const floorsKwh = sim.floors.map((fl) => fl.monthlyKwh[m]);
    const unshaded = sim.floors.reduce((s, fl) => s + fl.monthlyUnshadedKwh[m], 0);
    const total = floorsKwh.reduce((a, b) => a + b, 0);
    const loss = sim.floors.reduce(
      (s, fl) => s + Math.max(0, fl.monthlyUnshadedKwh[m] - fl.monthlyKwh[m]),
      0,
    );
    return {
      month: m,
      floorsKwh,
      totalKwh: total,
      lossKwh: loss,
      lossPct: pct(loss, unshaded),
      shadedHours: stats ? (stats.monthly[m]?.shadedHours ?? 0) : null,
    };
  });
  const unshaded = sim.floors.reduce((s, fl) => s + fl.annualUnshadedKwh, 0);
  const year: MonthlyRow = {
    month: null,
    floorsKwh: sim.floors.map((fl) => fl.annualKwh),
    totalKwh: sim.totalAnnualKwh,
    lossKwh: sim.totalShadingLossKwh,
    lossPct: pct(sim.totalShadingLossKwh, unshaded),
    shadedHours: stats ? stats.shadedHours : null,
  };
  return { months, year };
}
