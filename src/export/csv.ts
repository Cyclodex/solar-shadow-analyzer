// ─────────────────────────────────────────────
// CSV (RFC 4180)
// Numbers are written without grouping, with a dot or (option `decimal`) a comma as decimal mark.
// Spreadsheet software opens a CSV file with the list separator and decimal mark of the user's
// regional settings, not those of the app language: csvFormatForLocale() gives the matching dialect
// for a locale. Download with downloadText(csv, name, CSV_MIME, { bom: true }).
// ─────────────────────────────────────────────

export type CsvCell = string | number | boolean | null | undefined;

export const CSV_MIME = 'text/csv;charset=utf-8';

/** Spreadsheet CSV dialect: field separator and decimal mark of numbers. */
export interface CsvFormat {
  separator: ',' | ';' | '\t';
  decimal: '.' | ',';
}

export interface CsvOptions extends Partial<CsvFormat> {
  /** Line ending. Default '\r\n' (RFC 4180). */
  newline?: '\r\n' | '\n';
}

/** Languages whose spreadsheet list separator is ';' even with a decimal point (de-CH, fr-CH, it-CH …). */
const SEMICOLON_LANGUAGES = new Set(['de', 'fr', 'it']);

function localeParts(locale: string): { language: string; region: string | undefined } | null {
  try {
    const l = new Intl.Locale(locale);
    return { language: l.language, region: l.region };
  } catch {
    return null; // not a valid language tag
  }
}

/**
 * CSV dialect that spreadsheet software (Excel) opens directly with the regional settings of
 * `locale`: decimal comma → ';' separator and ',' decimals (de-DE, de-AT, fr-CH …); decimal point →
 * ';' for German/French/Italian (de-CH, it-CH), otherwise ',' (en-US, en-GB …).
 */
export function csvFormatForLocale(locale: string): CsvFormat {
  let decimal = '.';
  try {
    decimal =
      new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
  } catch {
    // invalid tag: international format
  }
  if (decimal === ',') return { separator: ';', decimal: ',' };
  const language = localeParts(locale)?.language;
  return { separator: language && SEMICOLON_LANGUAGES.has(language) ? ';' : ',', decimal: '.' };
}

/**
 * Best guess of the user's regional settings from the browser's preferred languages (first entry).
 * A bare language ("de") takes its region from a later entry of the same language ("de-CH"), else
 * from `fallback` if that has the same language (the app's locale for its UI language), since the
 * decimal mark differs between regions. Empty list: `fallback`.
 */
export function spreadsheetLocale(languages: readonly string[], fallback: string): string {
  const first = languages.find((l) => localeParts(l) !== null);
  const parts = first ? localeParts(first) : null;
  if (!first || !parts) return fallback;
  if (parts.region) return first;
  const sameLanguage = (tag: string): boolean => localeParts(tag)?.language === parts.language;
  const regional = languages.find((l) => sameLanguage(l) && localeParts(l)?.region);
  if (regional) return regional;
  return sameLanguage(fallback) ? fallback : first;
}

function cell(value: CsvCell, separator: string, decimal: string): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'number') {
    s = Number.isFinite(value) ? String(value) : '';
    if (decimal !== '.') s = s.replace('.', decimal);
  } else s = String(value);
  // Quote if the field contains the separator, quotes, line breaks or leading/trailing spaces.
  if (s.includes(separator) || /["\r\n]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Rows → CSV text (first row usually the header). Non-finite numbers become empty fields.
 * Defaults: separator ',', decimal '.', newline '\r\n'. Never use ',' as both separator and decimal.
 */
export function toCsv(rows: readonly (readonly CsvCell[])[], opts: CsvOptions = {}): string {
  const separator = opts.separator ?? ',';
  const decimal = opts.decimal ?? '.';
  const newline = opts.newline ?? '\r\n';
  return rows.map((r) => r.map((v) => cell(v, separator, decimal)).join(separator)).join(newline) + newline;
}
