import type { LoadProfileKind } from './types';
import { MS_PER_DAY, MS_PER_MINUTE, dayOffsetsForYear, daysInYear } from './time';
import { H0_QUARTER_HOURS } from './loadProfileData';

// ─────────────────────────────────────────────
// HOUSEHOLD LOAD PROFILE
// BDEW/VDEW standard load profile H0 (households, Germany; no Swiss standard profile is published):
// quarter-hour values for 3 seasons × 3 day types (loadProfileData.ts, from the BDEW file "Repräsentative
// Profile VDEW.xls"), multiplied by the daily dynamisation factor
//   F(t) = −3.92e-10·t⁴ + 3.2e-7·t³ − 7.02e-5·t² + 2.1e-3·t + 1.24   (t = day of year, rounded to 4 decimals)
// Seasons: winter 1.11.–20.3., summer 15.5.–14.9., transition otherwise; day types Mon–Fri, Sat, Sun.
// Source: BDEW, "Anwendung der Repräsentativen VDEW-Lastprofile step-by-step" (2000), p. 4 and 19,
// https://www.bdew.de/media/documents/2000131_Anwendung-repraesentativen_Lastprofile-Step-by-step.pdf,
// retrieved 2026-09-24. Public holidays (Sunday profile in BDEW practice) are not modelled: they differ by
// canton. The series is rescaled to the annual consumption (the dynamised profile of 2026 sums to 997.1 kWh
// per 1000 kWh/a).
// ─────────────────────────────────────────────

/** Dynamisation factor F(t) of H0 for day of year t (1 = 1 January), rounded to 4 decimals like BDEW. */
export function h0Dynamisation(t: number): number {
  const f = -3.92e-10 * t ** 4 + 3.2e-7 * t ** 3 - 7.02e-5 * t ** 2 + 2.1e-3 * t + 1.24;
  return Math.round(f * 1e4) / 1e4;
}

type Season = keyof typeof H0_QUARTER_HOURS;

/** H0 season of a calendar date (month 0…11, day 1…31). */
export function h0Season(month: number, day: number): Season {
  const md = (month + 1) * 100 + day;
  if (md >= 1101 || md <= 320) return 'winter';
  if (md >= 515 && md <= 914) return 'summer';
  return 'transition';
}

/**
 * Static H0 value (W per 1000 kWh/a, without dynamisation) of quarter hour `q` (0…95) on a day with weekday
 * `weekday` (0 = Sunday … 6 = Saturday) in `season`.
 */
export function h0Quarter(season: Season, weekday: number, q: number): number {
  const s = H0_QUARTER_HOURS[season];
  const values = weekday === 0 ? s.sunday : weekday === 6 ? s.saturday : s.workday;
  return values[q];
}

/** Quarter-hour samples per weather step (steps are hours: 4). */
function samplesPerStep(stepMinutes: number): number {
  return Math.max(1, Math.round(stepMinutes / 15));
}

/**
 * Mean household load (W) of every weather step: the H0 profile at the step's local clock time in `timeZone`
 * (steps longer than 15 min average their quarter hours), or constant for 'flat'; scaled so that the
 * steps sum to `annualKwh`. `timesUtc` are interval midpoints (WeatherSeries).
 */
export function householdLoadW(
  timesUtc: readonly number[],
  stepMinutes: number,
  year: number,
  timeZone: string,
  annualKwh: number,
  kind: LoadProfileKind,
): Float64Array {
  const n = timesUtc.length;
  const out = new Float64Array(n);
  const hours = stepMinutes / 60;
  if (n === 0 || !(annualKwh > 0) || !(hours > 0)) return out;
  if (kind === 'flat') {
    out.fill((annualKwh * 1000) / (n * hours));
    return out;
  }
  const offsets = dayOffsetsForYear(year, timeZone);
  const nDays = daysInYear(year);
  const start = Date.UTC(year, 0, 1);
  const k = samplesPerStep(stepMinutes);
  const subMs = (stepMinutes * MS_PER_MINUTE) / k;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const t = timesUtc[i];
    const dUtc = Math.min(nDays - 1, Math.max(0, Math.floor((t - start) / MS_PER_DAY)));
    const offsetMs = offsets[dUtc] * MS_PER_MINUTE;
    let acc = 0;
    for (let s = 0; s < k; s++) {
      // Midpoint of the s-th sub-interval, in local wall-clock time.
      const local = new Date(t - (stepMinutes * MS_PER_MINUTE) / 2 + (s + 0.5) * subMs + offsetMs);
      const y = local.getUTCFullYear();
      const month = local.getUTCMonth();
      const day = local.getUTCDate();
      const doy = Math.round((Date.UTC(y, month, day) - Date.UTC(y, 0, 1)) / MS_PER_DAY) + 1;
      const q = Math.floor((local.getUTCHours() * 60 + local.getUTCMinutes()) / 15);
      acc += h0Quarter(h0Season(month, day), local.getUTCDay(), q) * h0Dynamisation(doy);
    }
    out[i] = acc / k;
    sum += out[i] * hours;
  }
  const scale = sum > 0 ? (annualKwh * 1000) / sum : 0;
  for (let i = 0; i < n; i++) out[i] *= scale;
  return out;
}
