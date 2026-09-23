// ─────────────────────────────────────────────
// UNIT HELPERS
// ─────────────────────────────────────────────

export const DEG = Math.PI / 180;

export const toRad = (deg: number): number => deg * DEG;
export const toDeg = (rad: number): number => rad / DEG;

export const cmToM = (cm: number): number => cm / 100;
export const mToCm = (m: number): number => m * 100;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Normalizes an angle to [0, 360). */
export function normalizeDeg(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed difference a − b normalized to (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = normalizeDeg(a - b);
  return d > 180 ? d - 360 : d;
}

/** Rounds to a multiple of `step` without floating point noise (e.g. 0.1 steps). */
export function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1);
  return Number((Math.round(value / step) * step).toFixed(decimals));
}
