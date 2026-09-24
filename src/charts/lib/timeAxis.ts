import type { DailyProfilePoint } from '../../model/types';
import type { SunTimes } from '../../model/sun';
import { SHADED_THRESHOLD } from '../../model/analysis';
import { shadeStep } from './colors';

// ─────────────────────────────────────────────
// TIME-OF-DAY HELPERS (daily profile)
// ─────────────────────────────────────────────

export interface TimeWindow {
  /** Local clock minutes. */
  start: number;
  end: number;
}

const DAY: TimeWindow = { start: 0, end: 1440 };

/**
 * Visible part of the day: one hour before sunrise to one hour after sunset, widened to whole hours and
 * clamped to 00:00–24:00. The whole day at polar day/night or when an event is missing.
 */
export function daylightWindow(times: SunTimes): TimeWindow {
  if (times.polar !== null || times.sunrise === null || times.sunset === null) return DAY;
  const start = Math.max(0, Math.floor((times.sunrise - 60) / 60) * 60);
  const end = Math.min(1440, Math.ceil((times.sunset + 60) / 60) * 60);
  return end - start >= 120 ? { start, end } : DAY;
}

/** Smallest hour step (1, 2, 3, 4, 6, 12 h) whose ticks are at least `minPx` apart. Returns minutes. */
export function hourTickStep(pxPerMinute: number, minPx = 44): number {
  for (const h of [1, 2, 3, 4, 6, 12]) if (h * 60 * pxPerMinute >= minPx) return h * 60;
  return 720;
}

/** Largest shaded fraction of any floor at each profile point. */
export function maxShadePerPoint(points: readonly DailyProfilePoint[]): number[] {
  return points.map((p) => p.floorsShade.reduce((m, v) => (v > m ? v : m), 0));
}

export interface ShadeRun {
  /** Minutes of the first and last point of the run. */
  from: number;
  to: number;
  /** Shade step (colors.ts) shared by all points of the run. */
  step: number;
}

/**
 * Consecutive points with the same shade step (> SHADED_THRESHOLD), for drawing shaded periods.
 * `values` holds a shaded fraction per point.
 */
export function shadeRuns(points: readonly DailyProfilePoint[], values: readonly number[]): ShadeRun[] {
  const runs: ShadeRun[] = [];
  let current: ShadeRun | null = null;
  for (let i = 0; i < points.length; i++) {
    const minutes = points[i].minutes;
    const step = shadeStep(values[i] ?? 0);
    if (step < 0) current = null;
    else if (current && current.step === step) current.to = minutes;
    else {
      current = { from: minutes, to: minutes, step };
      runs.push(current);
    }
  }
  return runs;
}

/** Shaded periods of one floor: [first, last] minutes of each run of points with shade > SHADED_THRESHOLD. */
export function shadedPeriods(points: readonly DailyProfilePoint[], floor: number): [number, number][] {
  const out: [number, number][] = [];
  let open: [number, number] | null = null;
  for (const p of points) {
    if ((p.floorsShade[floor] ?? 0) > SHADED_THRESHOLD) {
      if (open) open[1] = p.minutes;
      else {
        open = [p.minutes, p.minutes];
        out.push(open);
      }
    } else open = null;
  }
  return out;
}

/** Index of the point with the highest power of `floor` (first on ties), −1 if all are ≤ 0. */
export function peakIndex(points: readonly DailyProfilePoint[], floor: number): number {
  let best = -1;
  let max = 0;
  points.forEach((p, i) => {
    const w = p.floorsW[floor] ?? 0;
    if (w > max) {
      max = w;
      best = i;
    }
  });
  return best;
}
