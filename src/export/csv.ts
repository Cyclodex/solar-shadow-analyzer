// ─────────────────────────────────────────────
// CSV (RFC 4180)
// Numbers are written machine-readable (dot decimal, no grouping); format them yourself if a
// localized export is wanted. Download with downloadText(csv, name, CSV_MIME, { bom: true }).
// ─────────────────────────────────────────────

export type CsvCell = string | number | boolean | null | undefined;

export const CSV_MIME = 'text/csv;charset=utf-8';

export interface CsvOptions {
  /** Field separator. Default ','. Use ';' for spreadsheets in locales with decimal commas. */
  separator?: ',' | ';' | '\t';
  /** Line ending. Default '\r\n' (RFC 4180). */
  newline?: '\r\n' | '\n';
}

function cell(value: CsvCell, separator: string): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'number') s = Number.isFinite(value) ? String(value) : '';
  else s = String(value);
  // Quote if the field contains the separator, quotes, line breaks or leading/trailing spaces.
  if (s.includes(separator) || /["\r\n]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Rows → CSV text (first row usually the header). Non-finite numbers become empty fields. */
export function toCsv(rows: readonly (readonly CsvCell[])[], opts: CsvOptions = {}): string {
  const separator = opts.separator ?? ',';
  const newline = opts.newline ?? '\r\n';
  return rows.map((r) => r.map((v) => cell(v, separator)).join(separator)).join(newline) + newline;
}
