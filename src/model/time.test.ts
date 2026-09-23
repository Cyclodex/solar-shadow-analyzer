import { describe, it, expect } from 'vitest';
import {
  MS_PER_MINUTE,
  addDays,
  dateFromDayOfYear,
  dayOffsetsForYear,
  dayOfYear,
  daysInYear,
  formatMinutes,
  isValidDate,
  isValidTimeZone,
  localClockMinutes,
  localToUtc,
  todayInTimeZone,
  tzOffsetMinutes,
  utcToLocal,
} from './time';

// Transition instants follow the published rules (tz database), checked against the 2025 calendar:
// EU: last Sunday of March/October at 01:00 UTC → 2025-03-30, 2025-10-26.
// US: 2nd Sunday of March / 1st Sunday of November at 02:00 local → 2025-03-09 07:00Z, 2025-11-02 06:00Z.
// Australia/Sydney: DST ends 1st Sunday of April 03:00 AEDT (2025-04-06 = 04-05 16:00Z),
//   starts 1st Sunday of October 02:00 AEST (2025-10-05 = 10-04 16:00Z).
const utc = (iso: string): number => Date.parse(iso);

describe('tzOffsetMinutes', () => {
  it('follows the Europe/Zurich DST transitions (2025)', () => {
    expect(tzOffsetMinutes('Europe/Zurich', utc('2025-01-15T12:00:00Z'))).toBe(60);
    expect(tzOffsetMinutes('Europe/Zurich', utc('2025-03-30T00:59:59Z'))).toBe(60);
    expect(tzOffsetMinutes('Europe/Zurich', utc('2025-03-30T01:00:00Z'))).toBe(120);
    expect(tzOffsetMinutes('Europe/Zurich', utc('2025-10-26T00:59:59Z'))).toBe(120);
    expect(tzOffsetMinutes('Europe/Zurich', utc('2025-10-26T01:00:00Z'))).toBe(60);
  });

  it('follows Australia/Sydney (southern hemisphere DST)', () => {
    expect(tzOffsetMinutes('Australia/Sydney', utc('2025-01-15T00:00:00Z'))).toBe(660);
    expect(tzOffsetMinutes('Australia/Sydney', utc('2025-04-05T15:59:59Z'))).toBe(660);
    expect(tzOffsetMinutes('Australia/Sydney', utc('2025-04-05T16:00:00Z'))).toBe(600);
    expect(tzOffsetMinutes('Australia/Sydney', utc('2025-10-04T15:59:59Z'))).toBe(600);
    expect(tzOffsetMinutes('Australia/Sydney', utc('2025-10-04T16:00:00Z'))).toBe(660);
  });

  it('follows America/New_York', () => {
    expect(tzOffsetMinutes('America/New_York', utc('2025-03-09T06:59:59Z'))).toBe(-300);
    expect(tzOffsetMinutes('America/New_York', utc('2025-03-09T07:00:00Z'))).toBe(-240);
    expect(tzOffsetMinutes('America/New_York', utc('2025-11-02T05:59:59Z'))).toBe(-240);
    expect(tzOffsetMinutes('America/New_York', utc('2025-11-02T06:00:00Z'))).toBe(-300);
  });

  it('handles fixed offsets: Asia/Kolkata (+05:30, no DST) and UTC', () => {
    for (const iso of ['2025-01-01T00:00:00Z', '2025-07-01T12:34:56Z']) {
      expect(tzOffsetMinutes('Asia/Kolkata', utc(iso))).toBe(330);
      expect(tzOffsetMinutes('UTC', utc(iso))).toBe(0);
    }
  });

  it('ignores sub-second parts and works before 1970', () => {
    expect(tzOffsetMinutes('Europe/Zurich', utc('2025-03-30T00:59:59.999Z'))).toBe(60);
    // Zurich had no DST in 1960 (CET all year).
    expect(tzOffsetMinutes('Europe/Zurich', utc('1960-07-01T12:00:00Z'))).toBe(60);
  });

  it('treats unknown zones as UTC', () => {
    expect(tzOffsetMinutes('Mars/Olympus_Mons', utc('2025-07-01T12:00:00Z'))).toBe(0);
  });

  it('throws on non-finite instants', () => {
    expect(() => tzOffsetMinutes('UTC', NaN)).toThrow(RangeError);
  });
});

describe('isValidTimeZone / isValidDate', () => {
  it('accepts IANA zones and rejects garbage', () => {
    for (const tz of ['Europe/Zurich', 'Australia/Sydney', 'Asia/Kolkata', 'America/New_York', 'UTC'])
      expect(isValidTimeZone(tz)).toBe(true);
    for (const tz of ['', 'Europe/Zurichh', 'Mars/Olympus_Mons', 'not a zone']) expect(isValidTimeZone(tz)).toBe(false);
  });

  it('validates calendar dates', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2025-02-29')).toBe(false);
    expect(isValidDate('2025-13-01')).toBe(false);
    expect(isValidDate('2025-1-01')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });
});

describe('localToUtc', () => {
  it('converts regular times', () => {
    expect(localToUtc('2025-01-15', 12 * 60, 'Europe/Zurich')).toBe(utc('2025-01-15T11:00:00Z'));
    expect(localToUtc('2025-07-15', 12 * 60, 'Europe/Zurich')).toBe(utc('2025-07-15T10:00:00Z'));
    expect(localToUtc('2025-06-01', 12 * 60, 'Asia/Kolkata')).toBe(utc('2025-06-01T06:30:00Z'));
    expect(localToUtc('2025-06-01', 12 * 60, 'UTC')).toBe(utc('2025-06-01T12:00:00Z'));
    expect(localToUtc('2025-01-15', 12 * 60 + 0.5, 'UTC')).toBe(utc('2025-01-15T12:00:30Z'));
  });

  it('rolls minutes over into adjacent days', () => {
    expect(localToUtc('2025-12-31', 1440, 'Europe/Zurich')).toBe(utc('2025-12-31T23:00:00Z'));
    expect(localToUtc('2025-01-01', -60, 'UTC')).toBe(utc('2024-12-31T23:00:00Z'));
  });

  it('shifts non-existent times (spring forward) forward by the gap', () => {
    // Zurich 2025-03-30: 02:00–02:59 do not exist.
    expect(localToUtc('2025-03-30', 119, 'Europe/Zurich')).toBe(utc('2025-03-30T00:59:00Z')); // 01:59 CET
    expect(localToUtc('2025-03-30', 120, 'Europe/Zurich')).toBe(utc('2025-03-30T01:00:00Z')); // → 03:00 CEST
    expect(localToUtc('2025-03-30', 150, 'Europe/Zurich')).toBe(utc('2025-03-30T01:30:00Z')); // → 03:30 CEST
    expect(localToUtc('2025-03-30', 180, 'Europe/Zurich')).toBe(utc('2025-03-30T01:00:00Z')); // 03:00 CEST
    expect(localToUtc('2025-03-09', 150, 'America/New_York')).toBe(utc('2025-03-09T07:30:00Z')); // → 03:30 EDT
    expect(localToUtc('2025-10-05', 150, 'Australia/Sydney')).toBe(utc('2025-10-04T16:30:00Z')); // → 03:30 AEDT
  });

  it('resolves ambiguous times (fall back) to the earlier instant', () => {
    // Zurich 2025-10-26: 02:00–02:59 occur twice (CEST, then CET).
    expect(localToUtc('2025-10-26', 120, 'Europe/Zurich')).toBe(utc('2025-10-26T00:00:00Z'));
    expect(localToUtc('2025-10-26', 150, 'Europe/Zurich')).toBe(utc('2025-10-26T00:30:00Z'));
    expect(localToUtc('2025-10-26', 180, 'Europe/Zurich')).toBe(utc('2025-10-26T02:00:00Z')); // 03:00 CET
    expect(localToUtc('2025-10-26', 119, 'Europe/Zurich')).toBe(utc('2025-10-25T23:59:00Z'));
    expect(localToUtc('2025-11-02', 90, 'America/New_York')).toBe(utc('2025-11-02T05:30:00Z')); // 01:30 EDT
    expect(localToUtc('2025-04-06', 150, 'Australia/Sydney')).toBe(utc('2025-04-05T15:30:00Z')); // 02:30 AEDT
  });

  it('treats unknown zones as UTC and rejects invalid dates', () => {
    expect(localToUtc('2025-06-01', 600, 'Nowhere/Void')).toBe(utc('2025-06-01T10:00:00Z'));
    expect(() => localToUtc('2025-02-30', 0, 'UTC')).toThrow(RangeError);
    expect(() => localToUtc('01.06.2025', 0, 'UTC')).toThrow(RangeError);
  });

  /** Number of instants in [from, to) (step in minutes) whose local time does not map back to themselves. */
  function roundTripMisses(tz: string, from: string, to: string, step: number): number {
    let misses = 0;
    for (let t = utc(from); t < utc(to); t += step * MS_PER_MINUTE) {
      const { date, minutes } = utcToLocal(t, tz);
      const back = localToUtc(date, minutes, tz);
      if (back !== t) {
        // Second occurrence of a repeated local time maps to the first one, 60 min earlier.
        expect(back).toBe(t - 60 * MS_PER_MINUTE);
        misses++;
      }
    }
    return misses;
  }

  it('round-trips with utcToLocal minute by minute around DST changes', () => {
    // ±1 day around each transition; exactly the 60 minutes of the repeated hour map to their first occurrence.
    const windows: [string, string, string, number][] = [
      ['Europe/Zurich', '2025-03-29T00:00:00Z', '2025-03-31T00:00:00Z', 0],
      ['Europe/Zurich', '2025-10-25T00:00:00Z', '2025-10-27T00:00:00Z', 60],
      ['Australia/Sydney', '2025-04-04T12:00:00Z', '2025-04-06T12:00:00Z', 60],
      ['Australia/Sydney', '2025-10-03T12:00:00Z', '2025-10-05T12:00:00Z', 0],
      ['America/New_York', '2025-03-08T12:00:00Z', '2025-03-10T12:00:00Z', 0],
      ['America/New_York', '2025-11-01T12:00:00Z', '2025-11-03T12:00:00Z', 60],
    ];
    for (const [tz, from, to, expected] of windows) expect(roundTripMisses(tz, from, to, 1)).toBe(expected);
  });

  it('handles 30/60 min DST, :45 offsets and a gap at midnight (Lord Howe, Chatham, Santiago)', () => {
    // References: Python 3.11 zoneinfo (system tzdata 2025b), wall time with fold=0 (= earlier / pre-transition offset).
    // Lord Howe: +10:30 ↔ +11 (30 min); Chatham: +12:45 ↔ +13:45; Santiago: gap 2025-09-07 00:00 → 01:00.
    expect(localToUtc('2025-10-05', 135, 'Australia/Lord_Howe')).toBe(utc('2025-10-04T15:45:00Z')); // gap 02:00–02:30
    expect(localToUtc('2025-10-05', 150, 'Australia/Lord_Howe')).toBe(utc('2025-10-04T15:30:00Z'));
    expect(localToUtc('2025-04-06', 105, 'Australia/Lord_Howe')).toBe(utc('2025-04-05T14:45:00Z')); // 01:30–02:00 twice
    expect(localToUtc('2025-04-06', 120, 'Australia/Lord_Howe')).toBe(utc('2025-04-05T15:30:00Z'));
    expect(localToUtc('2025-09-28', 180, 'Pacific/Chatham')).toBe(utc('2025-09-27T14:15:00Z')); // gap 02:45–03:45
    expect(localToUtc('2025-04-06', 180, 'Pacific/Chatham')).toBe(utc('2025-04-05T13:15:00Z')); // 02:45–03:45 twice
    expect(localToUtc('2025-09-07', 0, 'America/Santiago')).toBe(utc('2025-09-07T04:00:00Z'));
    expect(utcToLocal(utc('2025-09-07T04:00:00Z'), 'America/Santiago')).toEqual({ date: '2025-09-07', minutes: 60 });
    expect(localToUtc('2025-04-05', 1410, 'America/Santiago')).toBe(utc('2025-04-06T02:30:00Z')); // 23:00–24:00 twice
    expect(localToUtc('2025-04-06', 0, 'America/Santiago')).toBe(utc('2025-04-06T04:00:00Z'));
    // Minute by minute ±1 day around each transition: exactly the repeated minutes map to their first occurrence.
    const windows: [string, string, string, number][] = [
      ['Australia/Lord_Howe', '2025-04-04T15:00:00Z', '2025-04-06T15:00:00Z', 30],
      ['Australia/Lord_Howe', '2025-10-03T15:30:00Z', '2025-10-05T15:30:00Z', 0],
      ['Pacific/Chatham', '2025-04-04T14:00:00Z', '2025-04-06T14:00:00Z', 60],
      ['Pacific/Chatham', '2025-09-26T14:00:00Z', '2025-09-28T14:00:00Z', 0],
      ['America/Santiago', '2025-04-05T03:00:00Z', '2025-04-07T03:00:00Z', 60],
      ['America/Santiago', '2025-09-06T04:00:00Z', '2025-09-08T04:00:00Z', 0],
    ];
    for (const [tz, from, to, expected] of windows) {
      let misses = 0;
      for (let t = utc(from); t < utc(to); t += MS_PER_MINUTE) {
        const { date, minutes } = utcToLocal(t, tz);
        const back = localToUtc(date, minutes, tz);
        if (back !== t) {
          expect(back).toBe(t - expected * MS_PER_MINUTE);
          misses++;
        }
      }
      expect(misses).toBe(expected);
    }
  });

  it('round-trips with utcToLocal across the whole year', () => {
    // 97 min is co-prime to 60, so the samples cover every minute-of-hour phase. Kolkata/UTC have no repeated
    // hour; elsewhere a 97 min step can land at most once in the single repeated hour.
    for (const tz of ['Asia/Kolkata', 'UTC']) expect(roundTripMisses(tz, '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 97)).toBe(0);
    for (const tz of ['Europe/Zurich', 'Australia/Sydney', 'America/New_York'])
      expect(roundTripMisses(tz, '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 97)).toBeLessThanOrEqual(1);
  });
});

describe('utcToLocal / localClockMinutes / todayInTimeZone', () => {
  it('returns local date and clock minutes', () => {
    expect(utcToLocal(utc('2025-03-30T01:00:00Z'), 'Europe/Zurich')).toEqual({ date: '2025-03-30', minutes: 180 });
    expect(utcToLocal(utc('2025-12-31T23:30:00Z'), 'Europe/Zurich')).toEqual({ date: '2026-01-01', minutes: 30 });
    expect(utcToLocal(utc('2025-06-01T20:00:00Z'), 'Asia/Kolkata')).toEqual({ date: '2025-06-02', minutes: 90 });
    expect(utcToLocal(utc('2025-01-01T03:00:00Z'), 'America/New_York')).toEqual({ date: '2024-12-31', minutes: 1320 });
    expect(utcToLocal(utc('2025-01-01T00:00:30Z'), 'UTC')).toEqual({ date: '2025-01-01', minutes: 0.5 });
  });

  it('counts clock minutes relative to a given local date', () => {
    expect(localClockMinutes(utc('2025-06-21T22:30:00Z'), '2025-06-21', 'Europe/Zurich')).toBe(1470); // 00:30 next day
    expect(localClockMinutes(utc('2025-06-20T21:30:00Z'), '2025-06-21', 'Europe/Zurich')).toBe(-30);
  });

  it('gives the current local date', () => {
    const now = utc('2025-01-01T11:30:00Z');
    expect(todayInTimeZone('Pacific/Auckland', now)).toBe('2025-01-02'); // NZDT +13 → 00:30
    expect(todayInTimeZone('Pacific/Honolulu', now)).toBe('2025-01-01'); // −10 → 01:30
  });
});

describe('calendar helpers', () => {
  it('computes day of year', () => {
    expect(dayOfYear('2025-01-01')).toBe(1);
    expect(dayOfYear('2025-03-30')).toBe(89); // 31 + 28 + 30
    expect(dayOfYear('2024-03-01')).toBe(61); // 31 + 29 + 1
    expect(dayOfYear('2025-12-31')).toBe(365);
    expect(dayOfYear('2024-12-31')).toBe(366);
  });

  it('converts day of year back to a date (rolling over)', () => {
    expect(dateFromDayOfYear(2024, 60)).toBe('2024-02-29');
    expect(dateFromDayOfYear(2025, 60)).toBe('2025-03-01');
    expect(dateFromDayOfYear(2025, 366)).toBe('2026-01-01');
    expect(dateFromDayOfYear(2025, 0)).toBe('2024-12-31');
    for (let d = 1; d <= 366; d++) expect(dayOfYear(dateFromDayOfYear(2024, d))).toBe(d);
  });

  it('knows leap years', () => {
    expect(daysInYear(2024)).toBe(366);
    expect(daysInYear(2025)).toBe(365);
    expect(daysInYear(1900)).toBe(365);
    expect(daysInYear(2000)).toBe(366);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2025-06-15', 0)).toBe('2025-06-15');
  });
});

describe('formatMinutes', () => {
  it('formats and rounds to the nearest minute', () => {
    expect(formatMinutes(0)).toBe('00:00');
    expect(formatMinutes(335.36)).toBe('05:35');
    expect(formatMinutes(59.5)).toBe('01:00');
    expect(formatMinutes(1439.4)).toBe('23:59');
  });

  it('shows 24:00 for the end of the day and wraps other values', () => {
    expect(formatMinutes(1440)).toBe('24:00');
    expect(formatMinutes(1439.6)).toBe('24:00');
    expect(formatMinutes(1470)).toBe('00:30');
    expect(formatMinutes(-30)).toBe('23:30');
    expect(formatMinutes(NaN)).toBe('--:--');
  });
});

describe('dayOffsetsForYear', () => {
  it('gives the noon offset of every day (Europe/Zurich 2025)', () => {
    const o = dayOffsetsForYear(2025, 'Europe/Zurich');
    expect(o).toHaveLength(365);
    // Index = doy − 1. CEST from 2025-03-30 (doy 89) through 2025-10-25 (doy 298).
    o.forEach((v, i) => expect(v).toBe(i >= 88 && i <= 297 ? 120 : 60));
  });

  it('handles southern hemisphere DST (Australia/Sydney 2025)', () => {
    const o = dayOffsetsForYear(2025, 'Australia/Sydney');
    // AEST (+600) from 2025-04-06 (doy 96) through 2025-10-04 (doy 277).
    o.forEach((v, i) => expect(v).toBe(i >= 95 && i <= 276 ? 600 : 660));
  });

  it('handles 30 min DST, :45 offsets and midnight transitions (2025)', () => {
    // Index runs from Python zoneinfo (tzdata 2025b), offset at local noon with fold=0.
    const runs: [string, [number, number, number][]][] = [
      ['Australia/Lord_Howe', [[0, 94, 660], [95, 276, 630], [277, 364, 660]]],
      ['Pacific/Chatham', [[0, 94, 825], [95, 269, 765], [270, 364, 825]]],
      ['America/Santiago', [[0, 94, -180], [95, 248, -240], [249, 364, -180]]],
    ];
    for (const [tz, r] of runs) {
      const o = dayOffsetsForYear(2025, tz);
      expect(o).toHaveLength(365);
      for (const [from, to, v] of r) for (let i = from; i <= to; i++) expect(o[i]).toBe(v);
    }
  });

  it('matches tzOffsetMinutes at local noon and handles leap years / fixed zones', () => {
    const o = dayOffsetsForYear(2024, 'America/New_York');
    expect(o).toHaveLength(366);
    for (let d = 1; d <= 366; d += 13) {
      const t = localToUtc(dateFromDayOfYear(2024, d), 720, 'America/New_York');
      expect(o[d - 1]).toBe(tzOffsetMinutes('America/New_York', t));
    }
    expect(new Set(dayOffsetsForYear(2025, 'Asia/Kolkata'))).toEqual(new Set([330]));
  });

  it('returns a copy (cache is not mutable from outside)', () => {
    const a = dayOffsetsForYear(2025, 'UTC');
    a[0] = 999;
    expect(dayOffsetsForYear(2025, 'UTC')[0]).toBe(0);
  });
});
