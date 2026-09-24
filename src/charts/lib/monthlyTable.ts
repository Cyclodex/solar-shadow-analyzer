import type { HeatmapStats } from '../../model/analysis';
import type { SimulationResult } from '../../model/types';
import { toCsv, type CsvCell } from '../../export/csv';

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
  /** Unshaded − shaded energy of all floors, kWh. */
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
    const loss = Math.max(0, unshaded - total);
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

/** Rounds for the CSV export (machine-readable numbers, no grouping). */
const r1 = (v: number): number => Math.round(v * 10) / 10;

export interface MonthlyCsvLabels {
  month: string;
  /** Column header per floor (index = floor). */
  floors: readonly string[];
  total: string;
  /** Headers of the loss columns (both omitted when null, e.g. a single floor). */
  lossKwh: string | null;
  lossPct: string | null;
  /** Header of the shaded-hours column (omitted when null). */
  shadedHours: string | null;
  /** Row label per month (12) and of the year row. */
  monthNames: readonly string[];
  year: string;
}

/** CSV text (RFC 4180, dot decimals, 1 decimal) of the monthly table incl. the year row. */
export function monthlyCsv(
  rows: { months: MonthlyRow[]; year: MonthlyRow },
  labels: MonthlyCsvLabels,
): string {
  const withTotal = labels.floors.length > 1;
  const header: CsvCell[] = [
    labels.month,
    ...labels.floors,
    ...(withTotal ? [labels.total] : []),
    ...(labels.lossKwh && labels.lossPct ? [labels.lossKwh, labels.lossPct] : []),
    ...(labels.shadedHours ? [labels.shadedHours] : []),
  ];
  const line = (r: MonthlyRow): CsvCell[] => [
    r.month === null ? labels.year : labels.monthNames[r.month],
    ...r.floorsKwh.map(r1),
    ...(withTotal ? [r1(r.totalKwh)] : []),
    ...(labels.lossKwh && labels.lossPct ? [r1(r.lossKwh), r1(r.lossPct)] : []),
    ...(labels.shadedHours ? [r1(r.shadedHours ?? 0)] : []),
  ];
  return toCsv([header, ...rows.months.map(line), line(rows.year)]);
}
