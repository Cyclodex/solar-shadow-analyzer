import type { Lang } from '../model/types';
import { formatMinutes } from '../model/time';
import { normalizeDeg } from '../model/units';
import { useUiStore } from '../state/uiStore';

// ─────────────────────────────────────────────
// I18N
// Texts live next to the component:
//   const de = { title: 'Heatmap', floors: (n: number) => `${n} Stockwerke` };
//   const messages: Messages<typeof de> = { de, en: { title: 'Heatmap', floors: (n) => `${n} floors` } };
//   const t = useMessages(messages);   // t.title, t.floors(3)
// Shared texts: ./common.ts. Numbers and dates only via useFormat() (Intl, de-CH / en-GB).
// German texts use Swiss orthography (ss, never ß).
// ─────────────────────────────────────────────

export type { Lang };

/** A message table: the same shape (strings and interpolation functions) per language. */
export interface Messages<T> {
  de: T;
  en: T;
}

export const LOCALES: Record<Lang, 'de-CH' | 'en-GB'> = { de: 'de-CH', en: 'en-GB' };

/** Current UI language. */
export function useLang(): Lang {
  return useUiStore((s) => s.lang);
}

/** The message set of the current language. */
export function useMessages<T>(messages: Messages<T>): T {
  return messages[useLang()];
}

/** Locale-aware formatters. All return '–' for NaN; `num` & co. return '∞' / '−∞' for infinities. */
export interface Format {
  lang: Lang;
  locale: 'de-CH' | 'en-GB';
  /** Number with exactly `digits` decimals (default 0) and grouping: de "1’234.5", en "1,234.5". */
  num: (value: number, digits?: number) => string;
  /** Rounded integer with grouping. */
  int: (value: number) => string;
  /** Energy: "1’234 kWh" (non-breaking space). */
  kwh: (value: number, digits?: number) => string;
  /** Value given IN PERCENT (12.3 → de "12.3 %", en "12.3%"). Multiply 0…1 fractions by 100 first. */
  pct: (percent: number, digits?: number) => string;
  /** Angle: "45°". */
  deg: (value: number, digits?: number) => string;
  /** Number + unit with a non-breaking space: unit(280, 'cm') → "280 cm". */
  unit: (value: number, unit: string, digits?: number) => string;
  /** Local clock minutes → "HH:MM" (1440 → "24:00"). */
  time: (minutes: number) => string;
  /** "YYYY-MM-DD" → de "21. Juni 2025", en "21 June 2025". Invalid input is returned unchanged. */
  date: (isoDate: string) => string;
  /** "YYYY-MM-DD" → de "21. Dez.", en "21 Dec" (short month, no year). */
  dateShort: (isoDate: string) => string;
  /**
   * Money: ISO 4217 codes via Intl (de "CHF 1’234.50", en "CHF 1,234.50"); any other label is appended
   * ("1’234.50 Fr."). Default 2 decimals.
   */
  currency: (value: number, code: string, digits?: number) => string;
  /** UTC offset in minutes → "UTC+2", "UTC+5:30", "UTC−3". */
  utcOffset: (offsetMinutes: number) => string;
  /** Short zone name at an instant, e.g. de "MESZ", en "CEST" (falls back to the IANA id). */
  tzName: (timeZone: string, utcMs: number) => string;
}

const NBSP = '\u00a0';
const MINUS = '\u2212';
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function nonFinite(value: number): string | null {
  if (Number.isNaN(value)) return '–';
  if (value === Infinity) return '∞';
  if (value === -Infinity) return `${MINUS}∞`;
  return null;
}

/** Avoids "-0" after rounding. */
function roundedForDisplay(value: number, digits: number): number {
  const r = Number(value.toFixed(Math.min(20, Math.max(0, digits))));
  return r === 0 ? 0 : value;
}

function isoToUtcDate(iso: string): Date | null {
  const m = DATE_RE.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function createFormat(lang: Lang): Format {
  const locale = LOCALES[lang];
  const numberFormats = new Map<number, Intl.NumberFormat>();
  const nf = (digits: number): Intl.NumberFormat => {
    let f = numberFormats.get(digits);
    if (!f) {
      f = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
      numberFormats.set(digits, f);
    }
    return f;
  };
  const num = (value: number, digits = 0): string =>
    nonFinite(value) ?? nf(digits).format(roundedForDisplay(value, digits)).replace('-', MINUS);
  const dateLong = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const dateNoYear = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const tzFormats = new Map<string, Intl.DateTimeFormat | null>();
  const currencyFormats = new Map<string, Intl.NumberFormat | null>();

  return {
    lang,
    locale,
    num,
    int: (value) => num(value, 0),
    kwh: (value, digits = 0) => `${num(value, digits)}${NBSP}kWh`,
    pct: (percent, digits = 0) => `${num(percent, digits)}${lang === 'de' ? `${NBSP}%` : '%'}`,
    deg: (value, digits = 0) => `${num(value, digits)}°`,
    unit: (value, unit, digits = 0) => `${num(value, digits)}${NBSP}${unit}`,
    time: (minutes) => formatMinutes(minutes),
    date: (iso) => {
      const d = isoToUtcDate(iso);
      return d ? dateLong.format(d) : iso;
    },
    dateShort: (iso) => {
      const d = isoToUtcDate(iso);
      return d ? dateNoYear.format(d) : iso;
    },
    currency: (value, code, digits = 2) => {
      const nf0 = nonFinite(value);
      if (nf0) return `${nf0}${NBSP}${code}`;
      const key = `${code}|${digits}`;
      let f = currencyFormats.get(key);
      if (f === undefined) {
        f = null;
        if (/^[A-Z]{3}$/.test(code)) {
          try {
            f = new Intl.NumberFormat(locale, {
              style: 'currency',
              currency: code,
              currencyDisplay: 'code',
              minimumFractionDigits: digits,
              maximumFractionDigits: digits,
            });
          } catch {
            f = null;
          }
        }
        currencyFormats.set(key, f);
      }
      const v = roundedForDisplay(value, digits);
      return f ? f.format(v).replace('-', MINUS) : `${num(v, digits)}${NBSP}${code}`.trim();
    },
    utcOffset: (offsetMinutes) => {
      if (!Number.isFinite(offsetMinutes)) return 'UTC';
      const sign = offsetMinutes < 0 ? MINUS : '+';
      const abs = Math.abs(Math.round(offsetMinutes));
      const h = Math.floor(abs / 60);
      const m = abs % 60;
      return abs === 0 ? 'UTC' : `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
    },
    tzName: (timeZone, utcMs) => {
      let f = tzFormats.get(timeZone);
      if (f === undefined) {
        try {
          f = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' });
        } catch {
          f = null;
        }
        tzFormats.set(timeZone, f);
      }
      const part = f?.formatToParts(utcMs).find((p) => p.type === 'timeZoneName')?.value;
      return part ?? timeZone;
    },
  };
}

const formats: Partial<Record<Lang, Format>> = {};

/** Formatter set for `lang` (cached; usable outside React, e.g. CSV export). */
export function getFormat(lang: Lang): Format {
  return (formats[lang] ??= createFormat(lang));
}

/** Formatter set of the current UI language (stable object per language). */
export function useFormat(): Format {
  return getFormat(useLang());
}

/**
 * Storey label from the storey number (FloorPlacement.storey = building.lowestFloor + floor index):
 * de "EG", "1. OG", "2. OG" … / en "Ground floor", "Floor 1" …
 */
export function floorLabel(storey: number, lang: Lang): string {
  if (lang === 'de') {
    if (storey === 0) return 'EG';
    return storey > 0 ? `${storey}. OG` : `${-storey}. UG`;
  }
  if (storey === 0) return 'Ground floor';
  return storey > 0 ? `Floor ${storey}` : `Basement ${-storey}`;
}

const MONTHS = {
  de: {
    short: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
    long: [
      'Januar',
      'Februar',
      'März',
      'April',
      'Mai',
      'Juni',
      'Juli',
      'August',
      'September',
      'Oktober',
      'November',
      'Dezember',
    ],
  },
  en: {
    short: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    long: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
  },
} as const satisfies Record<Lang, Record<'short' | 'long', readonly string[]>>;

/** Month names, index 0 = January. */
export function monthNames(lang: Lang, style: 'short' | 'long' = 'short'): readonly string[] {
  return MONTHS[lang][style];
}

const COMPASS = {
  de: ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
  en: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
} as const satisfies Record<Lang, readonly string[]>;

/** 16-point compass abbreviation of an azimuth (0° = N, clockwise): 202° → "SSW"; de uses O for east. */
export function compassPoint(azimuth: number, lang: Lang): string {
  if (!Number.isFinite(azimuth)) return '–';
  return COMPASS[lang][Math.round(normalizeDeg(azimuth) / 22.5) % 16];
}
