import type { HeatmapStats } from '../../model/analysis';
import type { SimulationResult } from '../../model/types';
import { toCsv, type CsvCell, type CsvOptions } from '../../export/csv';
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

/** Rounds for the CSV export like the export menu's CSVs: no float noise, −0 → 0, non-finite → empty. */
function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return NaN;
  const r = Number(value.toFixed(digits));
  return r === 0 ? 0 : r;
}

const kwh = (v: number): number => round(v, 2);

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

/**
 * CSV text (RFC 4180, dot decimals; kWh and % to 2 decimals, hours to 1) of the monthly table incl. the
 * year row. Pass the user's spreadsheet dialect (userCsvFormat from export/resultsCsv), as the export menu does.
 */
export function monthlyCsv(
  rows: { months: MonthlyRow[]; year: MonthlyRow },
  labels: MonthlyCsvLabels,
  format: Pick<CsvOptions, 'separator' | 'decimal'> = {},
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
    ...r.floorsKwh.map(kwh),
    ...(withTotal ? [kwh(r.totalKwh)] : []),
    ...(labels.lossKwh && labels.lossPct ? [kwh(r.lossKwh), round(r.lossPct, 2)] : []),
    ...(labels.shadedHours ? [round(r.shadedHours ?? 0, 1)] : []),
  ];
  return toCsv([header, ...rows.months.map(line), line(rows.year)], format);
}
