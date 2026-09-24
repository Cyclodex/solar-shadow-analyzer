import type { HeatmapStats } from '../../model/analysis';
import type { SimulationResult } from '../../model/types';
import { shadingTotals } from './shadingTotals';

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
  /** Shading loss of all floors (shadingTotals, as in the chart and the CSV export), kWh. */
  lossKwh: number;
  /** lossKwh / unshaded energy, %. */
  lossPct: number;
  /** Shaded hours of the analysed floor (null without heatmap statistics). */
  shadedHours: number | null;
}

/** 12 month rows and the year row. */
export function monthlyRows(
  sim: SimulationResult,
  stats: HeatmapStats | null,
): { months: MonthlyRow[]; year: MonthlyRow } {
  const months = Array.from({ length: 12 }, (_, m): MonthlyRow => {
    const floorsKwh = sim.floors.map((fl) => fl.monthlyKwh[m]);
    const { lossKwh, lossPct } = shadingTotals(sim, m);
    return {
      month: m,
      floorsKwh,
      totalKwh: floorsKwh.reduce((a, b) => a + b, 0),
      lossKwh,
      lossPct,
      shadedHours: stats ? (stats.monthly[m]?.shadedHours ?? 0) : null,
    };
  });
  const { lossKwh, lossPct } = shadingTotals(sim);
  const year: MonthlyRow = {
    month: null,
    floorsKwh: sim.floors.map((fl) => fl.annualKwh),
    totalKwh: sim.totalAnnualKwh,
    lossKwh,
    lossPct,
    shadedHours: stats ? stats.shadedHours : null,
  };
  return { months, year };
}
