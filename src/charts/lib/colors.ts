import { HEATMAP_BEHIND, HEATMAP_HORIZON, HEATMAP_NIGHT, SHADED_THRESHOLD } from '../../model/analysis';

// ─────────────────────────────────────────────
// CHART COLOURS
// Only references to the theme tokens of src/styles/global.css — never literal colours.
// Floors: categorical --floor-k by floor index, see floorColor() in src/styles/tokens.ts.
// Shaded fraction: 5 steps of the sequential ramp (--seq-3 … --seq-7); --seq-1/2 are skipped so that the
// lightest shade step stays clearly apart from the neutral "night" / "behind the facade" fills.
// ─────────────────────────────────────────────

/** Upper bounds of the shaded-fraction steps; a fraction ≤ SHADED_THRESHOLD counts as unshaded. */
export const SHADE_STEP_UPPER: readonly number[] = [0.2, 0.4, 0.6, 0.8, 1];

/** Token per shade step (same order as SHADE_STEP_UPPER). */
export const SHADE_STEP_TOKENS = ['--seq-3', '--seq-4', '--seq-5', '--seq-6', '--seq-7'] as const;

/** Boundaries of the shade steps for legends, in %: 1 (threshold), 20, 40, 60, 80, 100. */
export const SHADE_STEP_BOUNDS_PCT: readonly number[] = [SHADED_THRESHOLD * 100, 20, 40, 60, 80, 100];

/**
 * Shade step of a shaded fraction 0…1: −1 = unshaded (≤ SHADED_THRESHOLD, the threshold heatmapStats uses),
 * else 0 … 4 (index into SHADE_STEP_TOKENS).
 */
export function shadeStep(fraction: number): number {
  if (!(fraction > SHADED_THRESHOLD)) return -1;
  const i = SHADE_STEP_UPPER.findIndex((upper) => fraction <= upper + 1e-9);
  return i < 0 ? SHADE_STEP_UPPER.length - 1 : i;
}

/** Heatmap cell classes (index into the heatmap palette). */
export const CELL = {
  night: 0,
  behind: 1,
  horizon: 2,
  sun: 3,
  /** First shade step; step i → CELL.shade + i. */
  shade: 4,
} as const;

export const CELL_CLASS_COUNT = CELL.shade + SHADE_STEP_UPPER.length;

/** Cell class of a heatmap value (HEATMAP_* codes or shaded fraction). */
export function cellClass(value: number): number {
  if (value === HEATMAP_NIGHT) return CELL.night;
  if (value === HEATMAP_BEHIND) return CELL.behind;
  if (value === HEATMAP_HORIZON) return CELL.horizon;
  const step = shadeStep(value);
  return step < 0 ? CELL.sun : CELL.shade + step;
}

/** Theme token of every heatmap cell class (index = class). */
export const CELL_TOKENS: readonly string[] = [
  '--surface-2',
  '--wall',
  '--ground',
  '--sun',
  ...SHADE_STEP_TOKENS,
];

/**
 * Share of --sun in the "sun, unshaded" heatmap fill, mixed over --surface: a calm colour for the largest area,
 * so the shaded cells carry the emphasis.
 */
export const SUN_FILL_STRENGTH = 0.7;

/** CSS colour of a heatmap cell class (tooltips and HTML keys; the canvas mixes the same way). */
export function cellCssColor(cls: number): string {
  if (cls === CELL.sun) {
    return `color-mix(in srgb, var(--sun) ${SUN_FILL_STRENGTH * 100}%, var(--surface))`;
  }
  return `var(${CELL_TOKENS[cls] ?? CELL_TOKENS[CELL.night]})`;
}
