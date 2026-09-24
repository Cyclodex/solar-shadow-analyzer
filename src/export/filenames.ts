import type { Lang } from '../model/types';
import { safeFilename } from './download';

// ─────────────────────────────────────────────
// EXPORT FILE NAMES
// "<app>-<kind>-<parts…>.<ext>", localised and safe on every platform, e.g.
// "verschattung-monatsertrag-Bern-2025.csv" / "shading-monthly-yield-Bern-2025.csv".
// ─────────────────────────────────────────────

export type ExportKind = 'config' | 'monthly' | 'tiltSweep' | 'heatmap' | 'economics';

const NAMES: Record<Lang, { app: string } & Record<ExportKind, string>> = {
  de: {
    app: 'verschattung',
    config: 'konfiguration',
    monthly: 'monatsertrag',
    tiltSweep: 'neigungsvergleich',
    heatmap: 'schatten-heatmap',
    economics: 'wirtschaftlichkeit',
  },
  en: {
    app: 'shading',
    config: 'configuration',
    monthly: 'monthly-yield',
    tiltSweep: 'tilt-comparison',
    heatmap: 'shade-heatmap',
    economics: 'economics',
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
