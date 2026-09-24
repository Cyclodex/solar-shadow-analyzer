// ─────────────────────────────────────────────
// TIME ZONES & CALENDAR
// Instants are UTC ms. Local dates are "YYYY-MM-DD", local times are clock
// minutes since local midnight. IANA zones are resolved via Intl (cached).
// Unknown zones behave like UTC — validate user input with isValidTimeZone.
// ─────────────────────────────────────────────

export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;

const MAX_CACHED_ZONES = 64;
const formatters = new Map<string, Intl.DateTimeFormat | null>();

/** Cached formatter for `timeZone`, null if Intl rejects the zone. */
function formatter(timeZone: string): Intl.DateTimeFormat | null {
  let f = formatters.get(timeZone);
  if (f !== undefined) return f;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    f = null;
  }
  if (formatters.size >= MAX_CACHED_ZONES) formatters.clear();
  formatters.set(timeZone, f);
  return f;
}

/** UTC ms of the given calendar fields (years 0–99 are not mapped to 19xx). */
function fieldsToMs(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  if (y >= 100) return Date.UTC(y, mo - 1, d, h, mi, s);
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(h, mi, s, 0);
  return dt.getTime();
}

/** Local − UTC in ms (whole seconds) at instant `utcMs`. */
function offsetMs(fmt: Intl.DateTimeFormat | null, utcMs: number): number {
  if (!Number.isFinite(utcMs)) throw new RangeError(`Invalid instant: ${utcMs}`);
  if (!fmt) return 0;
  // Intl resolves whole seconds; compare against the floored second.
  const sec = Math.floor(utcMs / 1000) * 1000;
  let y = 1970;
  let mo = 1;
  let d = 1;
  let h = 0;
  let mi = 0;
  let s = 0;
  for (const p of fmt.formatToParts(sec)) {
    switch (p.type) {
      case 'year':
        y = Number(p.value);
        break;
      case 'month':
        mo = Number(p.value);
        break;
      case 'day':
        d = Number(p.value);
        break;
      case 'hour':
        h = Number(p.value) % 24; // some engines emit "24" for midnight
        break;
      case 'minute':
        mi = Number(p.value);
        break;
      case 'second':
        s = Number(p.value);
        break;
    }
  }
  return fieldsToMs(y, mo, d, h, mi, s) - sec;
}

/**
 * Wall clock (local fields encoded as UTC ms) → instant.
 * Candidates use the offsets one day before/after; a candidate is valid if it maps back to the wall time.
 * Two valid → ambiguous (fall back) → earlier. None → gap (spring forward) → pre-transition offset,
 * i.e. the wall time shifted forward by the gap length (Temporal 'compatible').
 */
function wallToUtc(fmt: Intl.DateTimeFormat | null, wall: number): number {
  if (!fmt) return wall;
  const before = offsetMs(fmt, wall - MS_PER_DAY);
  const after = offsetMs(fmt, wall + MS_PER_DAY);
  const t1 = wall - before;
  const ok1 = offsetMs(fmt, t1) === before;
  if (before === after) return ok1 ? t1 : wall - offsetMs(fmt, t1);
  const t2 = wall - after;
  const ok2 = offsetMs(fmt, t2) === after;
  if (ok1 && ok2) return Math.min(t1, t2);
  if (ok2) return t2;
  return t1;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "YYYY-MM-DD" of the UTC calendar day containing `ms`. */
function msToDate(ms: number): string {
  const dt = new Date(ms);
  return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" to midnight of that calendar day encoded as UTC ms. Throws RangeError if invalid. */
function dateToMs(date: string): number {
  const m = DATE_RE.exec(date);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)) return fieldsToMs(y, mo, d);
  }
  throw new RangeError(`Invalid date (expected YYYY-MM-DD): ${date}`);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return month === 2
    ? isLeapYear(year)
      ? 29
      : 28
    : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** True if Intl accepts `tz` as a time zone (IANA names, case-insensitive; "UTC"). */
export function isValidTimeZone(tz: string): boolean {
  return typeof tz === 'string' && tz.length > 0 && formatter(tz) !== null;
}

/** True if `date` is a valid calendar date in the form "YYYY-MM-DD". */
export function isValidDate(date: string): boolean {
  try {
    dateToMs(date);
    return true;
  } catch {
    return false;
  }
}

/** Local − UTC offset in minutes at `utcMs` (CET +60, CEST +120, Asia/Kolkata +330). Unknown zone → 0. */
export function tzOffsetMinutes(timeZone: string, utcMs: number): number {
  return offsetMs(formatter(timeZone), utcMs) / MS_PER_MINUTE;
}

/**
 * Local date + clock minutes → UTC ms. `minutes` may be fractional or outside [0, 1440) (rolls over days).
 * Non-existent times (DST gap) are shifted forward by the gap length; ambiguous times (DST end) resolve to
 * the earlier instant. Throws RangeError for an invalid date.
 */
export function localToUtc(date: string, minutes: number, timeZone: string): number {
  return wallToUtc(formatter(timeZone), dateToMs(date) + minutes * MS_PER_MINUTE);
}

/** UTC ms → local date and clock minutes since local midnight (fractional, [0, 1440)). */
export function utcToLocal(utcMs: number, timeZone: string): { date: string; minutes: number } {
  const local = utcMs + offsetMs(formatter(timeZone), utcMs);
  const dayStart = Math.floor(local / MS_PER_DAY) * MS_PER_DAY;
  return { date: msToDate(dayStart), minutes: (local - dayStart) / MS_PER_MINUTE };
}

/**
 * Local clock minutes of `utcMs` counted from local midnight of `date` (may be < 0 or ≥ 1440 if the
 * instant falls on another local day).
 */
export function localClockMinutes(utcMs: number, date: string, timeZone: string): number {
  return (utcMs + offsetMs(formatter(timeZone), utcMs) - dateToMs(date)) / MS_PER_MINUTE;
}

/** 1-based day of the year of "YYYY-MM-DD". */
export function dayOfYear(date: string): number {
  const ms = dateToMs(date);
  return Math.round((ms - fieldsToMs(Number(date.slice(0, 4)), 1, 1)) / MS_PER_DAY) + 1;
}

/** "YYYY-MM-DD" of the 1-based day `doy` in `year`; out-of-range values roll over into adjacent years. */
export function dateFromDayOfYear(year: number, doy: number): string {
  return msToDate(fieldsToMs(year, 1, 1) + (Math.round(doy) - 1) * MS_PER_DAY);
}

/** Calendar date `days` days after `date` (negative = before). */
export function addDays(date: string, days: number): string {
  return msToDate(dateToMs(date) + Math.round(days) * MS_PER_DAY);
}

/** 365 or 366 (Gregorian rules). */
export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/** Clock minutes → "HH:MM", rounded to the nearest minute. Exactly 1440 → "24:00", other values wrap. */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return '--:--';
  const r = Math.round(minutes);
  if (r === 1440) return '24:00';
  const m = ((r % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** Current local date "YYYY-MM-DD" in `timeZone` at instant `nowMs`. */
export function todayInTimeZone(timeZone: string, nowMs: number): string {
  return utcToLocal(nowMs, timeZone).date;
}

const MAX_CACHED_YEARS = 16;
const yearOffsets = new Map<string, number[]>();

/**
 * UTC offset (minutes) at local noon for every day of `year` (index = doy − 1). Lets yearly loops convert
 * local ↔ UTC without Intl calls per step. Cached; returns a fresh copy.
 */
export function dayOffsetsForYear(year: number, timeZone: string): number[] {
  const key = `${timeZone}|${year}`;
  let offsets = yearOffsets.get(key);
  if (!offsets) {
    const fmt = formatter(timeZone);
    const n = daysInYear(year);
    const noon0 = fieldsToMs(year, 1, 1, 12);
    offsets = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const t = wallToUtc(fmt, noon0 + i * MS_PER_DAY);
      offsets[i] = offsetMs(fmt, t) / MS_PER_MINUTE;
    }
    if (yearOffsets.size >= MAX_CACHED_YEARS) yearOffsets.clear();
    yearOffsets.set(key, offsets);
  }
  return offsets.slice();
}
