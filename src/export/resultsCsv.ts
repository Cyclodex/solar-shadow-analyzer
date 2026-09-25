import type {
  BaselineFlows,
  BatteryFlows,
  BatteryResult,
  HeatmapData,
  Lang,
  SimulationResult,
  TiltSweepPoint,
} from '../model/types';
import { dateFromDayOfYear, formatMinutes, utcToLocal } from '../model/time';
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
  shadedHours: (who: string) => `${who}: verschattete Stunden (h)`,
  tiltFromVertical: 'Neigung ab Senkrechte θ (°)',
  tiltFromHorizontal: 'Neigung ab Horizontal β (°)',
  annualKwh: (who: string) => `${who}: Jahresertrag (kWh)`,
  date: 'Datum',
  battery: {
    pv: 'Solar nach Systemverlusten (kWh)',
    selfDirect: 'Direkt verbraucht (kWh)',
    selfBattery: 'Über Batterie verbraucht (kWh)',
    exported: 'Eingespeist (kWh)',
    imported: 'Netzbezug (kWh)',
    load: 'Verbrauch (kWh)',
    charged: 'Geladen (kWh)',
    discharged: 'Entladen (kWh)',
    curtailed: 'Abgeregelt an der AC-Grenze (kWh)',
    pvInputLimited: 'Über PV-Eingangsgrenze (kWh)',
    chargeLoss: 'Ladeverluste (kWh)',
    dischargeLoss: 'Entladeverluste (kWh)',
    standby: 'Eigenverbrauch Speicher (kWh)',
    storedDelta: 'Änderung Speicherinhalt (kWh)',
    baseOutput: 'Ohne Batterie: Abgabe (kWh)',
    baseSelf: 'Ohne Batterie: selbst verbraucht (kWh)',
    baseExported: 'Ohne Batterie: eingespeist (kWh)',
    baseImported: 'Ohne Batterie: Netzbezug (kWh)',
    baseCurtailed: 'Ohne Batterie: abgeregelt (kWh)',
  },
  hourly: {
    time: 'Ortszeit (Intervallbeginn)',
    pv: 'Solar (W)',
    direct: 'Solar direkt abgegeben (W)',
    charge: 'Laden (W)',
    discharge: 'Entladen (W)',
    load: 'Verbrauch (W)',
    exported: 'Einspeisung (W)',
    imported: 'Netzbezug (W)',
    soc: 'Ladestand (%)',
  },
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
    shadedHours: (who) => `${who}: shaded hours (h)`,
    tiltFromVertical: 'Tilt from vertical θ (°)',
    tiltFromHorizontal: 'Tilt from horizontal β (°)',
    annualKwh: (who) => `${who}: annual yield (kWh)`,
    date: 'Date',
    battery: {
      pv: 'Solar after system losses (kWh)',
      selfDirect: 'Used directly (kWh)',
      selfBattery: 'Used via battery (kWh)',
      exported: 'Fed in (kWh)',
      imported: 'Grid purchase (kWh)',
      load: 'Consumption (kWh)',
      charged: 'Charged (kWh)',
      discharged: 'Discharged (kWh)',
      curtailed: 'Curtailed at the AC limit (kWh)',
      pvInputLimited: 'Above the PV input limit (kWh)',
      chargeLoss: 'Charging losses (kWh)',
      dischargeLoss: 'Discharging losses (kWh)',
      standby: 'Storage own consumption (kWh)',
      storedDelta: 'Change of stored energy (kWh)',
      baseOutput: 'Without battery: output (kWh)',
      baseSelf: 'Without battery: self-consumed (kWh)',
      baseExported: 'Without battery: fed in (kWh)',
      baseImported: 'Without battery: grid purchase (kWh)',
      baseCurtailed: 'Without battery: curtailed (kWh)',
    },
    hourly: {
      time: 'Local time (interval start)',
      pv: 'Solar (W)',
      direct: 'Solar output directly (W)',
      charge: 'Charging (W)',
      discharge: 'Discharging (W)',
      load: 'Consumption (W)',
      exported: 'Feed-in (W)',
      imported: 'Grid purchase (W)',
      soc: 'State of charge (%)',
    },
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

/** Shaded hours of one floor (heatmap statistics), for an extra column of monthlyResultsCsv. */
export interface ShadedHoursColumn {
  /** Floor name for the header, e.g. "1. OG". */
  floor: string;
  /** Shaded hours per month (12). */
  monthly: readonly number[];
  /** Shaded hours of the year. */
  year: number;
}

/**
 * Monthly AC yield per floor (bottom floor first) and in total: yield, yield without shading by the
 * floor above, shading loss; last row = year (model totals). Optionally a last column with the shaded
 * hours of one floor (1 decimal).
 */
export function monthlyResultsCsv(
  sim: SimulationResult,
  lang: Lang,
  format: CsvFormat,
  opts: { shadedHours?: ShadedHoursColumn } = {},
): string {
  const t = messages[lang];
  const months = monthNames(lang, 'long');
  const { shadedHours } = opts;
  const header: CsvCell[] = [t.month];
  for (const fl of sim.floors) {
    const who = floorLabel(fl.storey, lang);
    header.push(t.yieldKwh(who), t.unshadedKwh(who), t.lossKwh(who));
  }
  header.push(t.yieldKwh(t.total), t.unshadedKwh(t.total), t.lossKwh(t.total), t.lossPct(t.total));
  if (shadedHours) header.push(t.shadedHours(shadedHours.floor));

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
    if (shadedHours) row.push(round(shadedHours.monthly[m] ?? NaN, 1));
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
  if (shadedHours) annual.push(round(shadedHours.year, 1));
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

const FLOW_COLUMNS: readonly (keyof BatteryFlows)[] = [
  'pv',
  'selfDirect',
  'selfBattery',
  'exported',
  'imported',
  'load',
  'charged',
  'discharged',
  'curtailed',
  'pvInputLimited',
  'chargeLoss',
  'dischargeLoss',
  'standby',
];
const BASE_COLUMNS: readonly [
  keyof BaselineFlows,
  'baseOutput' | 'baseSelf' | 'baseExported' | 'baseImported' | 'baseCurtailed',
][] = [
  ['output', 'baseOutput'],
  ['selfConsumed', 'baseSelf'],
  ['exported', 'baseExported'],
  ['imported', 'baseImported'],
  ['curtailed', 'baseCurtailed'],
];

/**
 * Monthly energy flows of the storage simulation and of the same system without storage; last row = year
 * (with the change of the stored energy, which closes the annual balance).
 */
export function batteryMonthlyCsv(r: BatteryResult, lang: Lang, format: CsvFormat): string {
  const t = messages[lang];
  const months = monthNames(lang, 'long');
  const header: CsvCell[] = [
    t.month,
    ...FLOW_COLUMNS.map((k) => t.battery[k as keyof typeof t.battery]),
    t.battery.storedDelta,
    ...BASE_COLUMNS.map(([, label]) => t.battery[label]),
  ];
  const row = (label: string, f: BatteryFlows, b: BaselineFlows, stored: number | null): CsvCell[] => [
    label,
    ...FLOW_COLUMNS.map((k) => kwh(f[k])),
    stored === null ? null : kwh(stored),
    ...BASE_COLUMNS.map(([k]) => kwh(b[k])),
  ];
  const rows: CsvCell[][] = [header];
  for (let m = 0; m < 12; m++) rows.push(row(months[m], r.monthly[m], r.baseline.monthly[m], null));
  rows.push(row(t.year, r.annual, r.baseline.annual, r.annual.storedDelta));
  return toCsv(rows, format);
}

/** Hourly (weather step) series of the storage simulation, local time of `timeZone` at the interval start. */
export function batteryHourlyCsv(r: BatteryResult, timeZone: string, lang: Lang, format: CsvFormat): string {
  const t = messages[lang].hourly;
  const s = r.series;
  const half = (s.stepMinutes * 60_000) / 2;
  const rows: CsvCell[][] = [
    [t.time, t.pv, t.direct, t.charge, t.discharge, t.load, t.exported, t.imported, t.soc],
  ];
  const w = (v: number): number => round(v, 1);
  for (let i = 0; i < s.timesUtc.length; i++) {
    const local = utcToLocal(s.timesUtc[i] - half, timeZone);
    rows.push([
      `${local.date} ${formatMinutes(local.minutes)}`,
      w(s.pv[i]),
      w(s.direct[i]),
      w(s.charge[i]),
      w(s.discharge[i]),
      w(s.load[i]),
      w(s.exported[i]),
      w(s.imported[i]),
      round(s.soc[i] * 100, 1),
    ]);
  }
  return toCsv(rows, format);
}

/** Downloads CSV text with a UTF-8 BOM (spreadsheet software then detects the encoding). */
export function downloadCsv(csv: string, filename: string): void {
  downloadText(csv, filename, CSV_MIME, { bom: true });
}
