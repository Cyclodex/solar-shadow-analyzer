import { horizonFromPoints, parseHorizonCsv } from '../../model/horizon';
import { isPvgisHorizon, parsePvgisHorizon } from '../../model/pvgis';
import { MAX_HORIZON_POINTS } from '../../model/share';
import type { Messages } from '../../i18n';
import type { HorizonPoint, HorizonProfile, Lang, Obstacle } from '../../model/types';

// ─────────────────────────────────────────────
// HORIZON HELPERS OF THE HORIZON SECTION
// Summaries of profiles/points and the manual horizon import (format detection → model parsers).
// ─────────────────────────────────────────────

const fallbackNames: Messages<(n: number) => string> = {
  de: (n) => `Hindernis ${n}`,
  en: (n) => `Obstacle ${n}`,
};

/** Display name of an obstacle: its own name or "Hindernis n" (n = index + 1). */
export function obstacleName(obstacle: Obstacle, index: number, lang: Lang): string {
  return obstacle.name || fallbackNames[lang](index + 1);
}

export interface HorizonPeak {
  /** Highest elevation, degrees. */
  elevation: number;
  /** Azimuth of the highest elevation (first one on ties), degrees from north. */
  azimuth: number;
}

/** Highest sample of a profile; null when the profile is empty. */
export function profilePeak(profile: HorizonProfile): HorizonPeak | null {
  const e = profile.elevations;
  if (e.length === 0) return null;
  let best = 0;
  for (let i = 1; i < e.length; i++) if (e[i] > e[best]) best = i;
  return { elevation: e[best], azimuth: best * profile.stepDeg };
}

/** Highest of a list of horizon points; null when empty. */
export function pointsPeak(points: readonly HorizonPoint[]): HorizonPeak | null {
  let peak: HorizonPeak | null = null;
  for (const p of points) {
    if (!peak || p.elevation > peak.elevation) peak = { elevation: p.elevation, azimuth: p.azimuth };
  }
  return peak;
}

/** Imports larger than this are rejected before reading (a 0.1° CSV is ≈ 50 kB). */
export const MAX_IMPORT_BYTES = 1_000_000;

export type HorizonFormat = 'pvgis' | 'csv';

export interface HorizonImport {
  format: HorizonFormat;
  points: HorizonPoint[];
  /** True when the input had more than MAX_HORIZON_POINTS points and was resampled on a regular grid. */
  resampled: boolean;
}

/**
 * Parses pasted or uploaded horizon data: PVGIS printhorizon output (JSON, CSV or basic, detected with
 * isPvgisHorizon) or "azimuth,elevation" lines (parseHorizonCsv). More than MAX_HORIZON_POINTS points are
 * resampled on a regular grid (horizonFromPoints), because the config keeps at most that many.
 * Null when no valid point was found.
 */
export function importHorizonText(text: string): HorizonImport | null {
  const format: HorizonFormat = isPvgisHorizon(text) ? 'pvgis' : 'csv';
  const parsed = format === 'pvgis' ? parsePvgisHorizon(text) : parseHorizonCsv(text);
  const points = parsed.filter((p) => Number.isFinite(p.azimuth) && Number.isFinite(p.elevation));
  if (points.length === 0) return null;
  if (points.length <= MAX_HORIZON_POINTS) return { format, points, resampled: false };
  const grid = horizonFromPoints(points, 360 / MAX_HORIZON_POINTS);
  return {
    format,
    points: grid.elevations.map((elevation, i) => ({ azimuth: i * grid.stepDeg, elevation })),
    resampled: true,
  };
}

/** Text content of a file (File.text() where available, FileReader otherwise). */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}
