// Parsing/formatting helpers of NumberField (separate module: components files export components only).

/** Decimals of a step value: 0.005 → 3, 0.1 → 1, 5 → 0. */
export function digitsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** Parses user input: decimal comma or point, spaces/apostrophes as grouping, "−" minus. Null if invalid. */
export function parseNumberInput(text: string): number | null {
  const t = text
    .trim()
    .replace(/[\s\u00a0\u202f'\u2019]/g, '')
    .replace(/\u2212/g, '-')
    .replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
