import type { HeatmapData, Lang, SimulationResult, TiltSweepPoint } from '../model/types';
import { dateFromDayOfYear, formatMinutes } from '../model/time';
import { floorLabel, LOCALES, monthNames, type Messages } from '../i18n';
import { CSV_MIME, csvFormatForLocale, spreadsheetLocale, toCsv, type CsvCell, type CsvFormat } from './csv';
import { downloadText } from './download';

// ─────────────────────────────────────────────
// RESULT TABLES AS CSV
// Pure builders (model results → CSV text) plus a download helper. Headers follow the UI language;
// numbers are rounded, without grouping. Separator and decimal mark (CsvFormat) follow the user's
// regional settings, which is what spreadsheet software uses to open the file: userCsvFormat().
// ─────────────────────────────────────────────

const de = {
  month: 'Monat',
  year: 'Jahr',
  total: 'Total',
  yieldKwh: (who: string) => `${who}: Ertrag (kWh)`,
  unshadedKwh: (who: string) => `${who}: ohne Verschattung (kWh)`,
  lossKwh: (who: string) => `${who}: Verschattungsverlust (kWh)`,
  lossPct: (who: string) => `${who}: Verschattungsverlust (%)`,
  tiltFromVertical: 'Neigung ab Senkrechte θ (°)',
  tiltFromHorizontal: 'Neigung ab Horizontal β (°)',
  annualKwh: (who: string) => `${who}: Jahresertrag (kWh)`,
  date: 'Datum',
};

const messages: Messages<typeof de> = {
  de,
  en: {
    month: 'Month',
    year: 'Year',
    total: 'Total',
    yieldKwh: (who) => `${who}: yield (kWh)`,
    unshadedKwh: (who) => `${who}: without shading (kWh)`,
    lossKwh: (who) => `${who}: shading loss (kWh)`,
    lossPct: (who) => `${who}: shading loss (%)`,
    tiltFromVertical: 'Tilt from vertical θ (°)',
    tiltFromHorizontal: 'Tilt from horizontal β (°)',
    annualKwh: (who) => `${who}: annual yield (kWh)`,
    date: 'Date',
  },
};

/**
 * CSV dialect for the user's spreadsheet software, from the browser's preferred languages (the best
 * available hint at the regional settings); the app's locale for `lang` when the browser gives none.
 */
export function userCsvFormat(lang: Lang): CsvFormat {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const languages = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  return csvFormatForLocale(spreadsheetLocale(languages, LOCALES[lang]));
}

/** Rounds for export (avoids float noise such as 12.300000000000001; −0 → 0). */
function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return NaN;
  const r = Number(value.toFixed(digits));
  return r === 0 ? 0 : r;
}

const kwh = (v: number): number => round(v, 2);

/**
 * Monthly AC yield per floor (bottom floor first) and in total: yield, yield without shading by the
 * floor above, shading loss; last row = year (model totals).
 */
export function monthlyResultsCsv(sim: SimulationResult, lang: Lang, format: CsvFormat): string {
  const t = messages[lang];
  const months = monthNames(lang, 'long');
  const header: CsvCell[] = [t.month];
  for (const fl of sim.floors) {
    const who = floorLabel(fl.storey, lang);
    header.push(t.yieldKwh(who), t.unshadedKwh(who), t.lossKwh(who));
  }
  header.push(t.yieldKwh(t.total), t.unshadedKwh(t.total), t.lossKwh(t.total), t.lossPct(t.total));

  const rows: CsvCell[][] = [header];
  for (let m = 0; m < 12; m++) {
    const row: CsvCell[] = [months[m]];
    let unshaded = 0;
    let loss = 0;
    for (const fl of sim.floors) {
      const l = Math.max(0, fl.monthlyUnshadedKwh[m] - fl.monthlyKwh[m]);
      row.push(kwh(fl.monthlyKwh[m]), kwh(fl.monthlyUnshadedKwh[m]), kwh(l));
      unshaded += fl.monthlyUnshadedKwh[m];
      loss += l;
    }
    row.push(
      kwh(sim.totalMonthlyKwh[m]),
      kwh(unshaded),
      kwh(loss),
      round(unshaded > 0 ? (loss / unshaded) * 100 : 0, 2),
    );
    rows.push(row);
  }

  const annual: CsvCell[] = [t.year];
  let unshadedYear = 0;
  for (const fl of sim.floors) {
    annual.push(kwh(fl.annualKwh), kwh(fl.annualUnshadedKwh), kwh(fl.shadingLossKwh));
    unshadedYear += fl.annualUnshadedKwh;
  }
  annual.push(
    kwh(sim.totalAnnualKwh),
    kwh(unshadedYear),
    kwh(sim.totalShadingLossKwh),
    round(unshadedYear > 0 ? (sim.totalShadingLossKwh / unshadedYear) * 100 : 0, 2),
  );
  rows.push(annual);
  return toCsv(rows, format);
}

/**
 * Annual yield per tilt: θ from vertical, β = 90° − θ from horizontal, kWh per floor (storeys in
 * floor order, bottom first) and total.
 */
export function tiltSweepCsv(
  points: readonly TiltSweepPoint[],
  storeys: readonly number[],
  lang: Lang,
  format: CsvFormat,
): string {
  const t = messages[lang];
  const header: CsvCell[] = [
    t.tiltFromVertical,
    t.tiltFromHorizontal,
    ...storeys.map((s) => t.annualKwh(floorLabel(s, lang))),
    t.annualKwh(t.total),
  ];
  const rows: CsvCell[][] = [header];
  for (const p of points) {
    rows.push([
      p.tiltFromVertical,
      90 - p.tiltFromVertical,
      ...storeys.map((_, k) => kwh(p.floorsKwh[k] ?? NaN)),
      kwh(p.totalKwh),
    ]);
  }
  return toCsv(rows, format);
}

/**
 * Compact shade heatmap: one row per day, one column per local clock slot (slot start "HH:MM").
 * Cells hold the shaded share of the row in % (1 decimal) while direct sun reaches the panel, and are
 * empty otherwise (night, sun behind the facade or below the horizon). Slots without direct sun on any
 * day of the year are left out.
 */
export function heatmapCsv(h: HeatmapData, lang: Lang, format: CsvFormat): string {
  const t = messages[lang];
  const slots: number[] = [];
  for (let s = 0; s < h.slotsPerDay; s++) {
    for (let d = 0; d < h.days; d++) {
      if (h.values[d * h.slotsPerDay + s] >= 0) {
        slots.push(s);
        break;
      }
    }
  }
  const rows: CsvCell[][] = [[t.date, ...slots.map((s) => formatMinutes(s * h.slotMinutes))]];
  for (let d = 0; d < h.days; d++) {
    const row: CsvCell[] = [dateFromDayOfYear(h.year, d + 1)];
    for (const s of slots) {
      const v = h.values[d * h.slotsPerDay + s];
      row.push(v >= 0 ? round(v * 100, 1) : null);
    }
    rows.push(row);
  }
  return toCsv(rows, format);
}

/** Downloads CSV text with a UTF-8 BOM (spreadsheet software then detects the encoding). */
export function downloadCsv(csv: string, filename: string): void {
  downloadText(csv, filename, CSV_MIME, { bom: true });
}
