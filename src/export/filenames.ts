import type { Lang, WeatherSource } from '../model/types';
import { formatMinutes } from '../model/time';
import { safeFilename } from './download';

// ─────────────────────────────────────────────
// EXPORT FILE NAMES
// "<app>-<kind>-<parts…>.<ext>", localised and safe on every platform, e.g.
// "verschattung-monatsertrag-Bern-2025.csv" / "shading-monthly-yield-Bern-2025.csv".
// ─────────────────────────────────────────────

export type ExportKind =
  | 'config'
  | 'monthly'
  | 'monthlyTable'
  | 'tiltSweep'
  | 'heatmap'
  | 'economics'
  | 'batteryMonthly'
  | 'batteryDay'
  | 'batteryHourly'
  | 'daily'
  | 'scene3d'
  | 'frontal'
  | 'profile'
  | 'sunPath'
  | 'panelShadow';

const NAMES: Record<Lang, { app: string; clearSky: string } & Record<ExportKind, string>> = {
  de: {
    app: 'verschattung',
    clearSky: 'klarer-himmel',
    config: 'konfiguration',
    monthly: 'monatsertrag',
    monthlyTable: 'monatstabelle',
    tiltSweep: 'neigungsvergleich',
    heatmap: 'schatten-heatmap',
    economics: 'wirtschaftlichkeit',
    batteryMonthly: 'batterie-energiefluss',
    batteryDay: 'batterie-tagesverlauf',
    batteryHourly: 'batterie-stundenwerte',
    daily: 'tagesverlauf',
    scene3d: '3d-ansicht',
    frontal: 'frontalansicht',
    profile: 'seitenansicht',
    sunPath: 'sonnenbahn',
    panelShadow: 'panel-schatten',
  },
  en: {
    app: 'shading',
    clearSky: 'clear-sky',
    config: 'configuration',
    monthly: 'monthly-yield',
    monthlyTable: 'monthly-table',
    tiltSweep: 'tilt-comparison',
    heatmap: 'shade-heatmap',
    economics: 'economics',
    batteryMonthly: 'battery-energy-flow',
    batteryDay: 'battery-daily-profile',
    batteryHourly: 'battery-hourly',
    daily: 'daily-profile',
    scene3d: '3d-view',
    frontal: 'front-view',
    profile: 'side-view',
    sunPath: 'sun-path',
    panelShadow: 'panel-shadow',
  },
};

/** File name for an export of `kind`; `parts` (location, year, floor …) are appended in order. */
export function exportFilename(
  kind: ExportKind,
  lang: Lang,
  parts: readonly (string | number)[],
  extension: 'json' | 'csv' | 'png',
): string {
  const n = NAMES[lang];
  const base = safeFilename([n.app, n[kind], ...parts.map(String)].join('-'), `${n.app}-${n[kind]}`);
  return `${base}.${extension}`;
}

/** File name parts of an instant (local date and clock time), e.g. ["2025-06-21", "1230"]. */
export function instantParts(date: string, minutes: number): [string, string] {
  return [date, formatMinutes(minutes).replace(':', '')];
}

/** File name part that marks results of the clear-sky fallback (no weather data); none for weather data. */
export function clearSkyParts(source: WeatherSource, lang: Lang): string[] {
  return source === 'clear-sky' ? [NAMES[lang].clearSky] : [];
}
