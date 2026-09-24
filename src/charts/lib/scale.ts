// ─────────────────────────────────────────────
// SCALES & TICKS
// Minimal linear/band scales for the hand-rolled SVG/canvas charts (no chart library).
// ─────────────────────────────────────────────

/** Linear map of a numeric domain onto a pixel range (either may be reversed). */
export interface LinearScale {
  (value: number): number;
  /** Pixel → domain value. */
  invert: (px: number) => number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
}

export function scaleLinear(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 !== d0 ? (r1 - r0) / (d1 - d0) : 0;
  const map = (value: number): number => r0 + (value - d0) * k;
  return Object.assign(map, {
    invert: (px: number): number => (k !== 0 ? d0 + (px - r0) / k : d0),
    domain: [d0, d1] as const,
    range: [r0, r1] as const,
  });
}

/** Evenly spaced bands (months, categories) over a pixel range with inner padding between bands. */
export interface BandScale {
  /** Left edge of band `i`. */
  (index: number): number;
  /** Width of one band (without the padding). */
  readonly bandwidth: number;
  /** Distance between the left edges of two neighbouring bands. */
  readonly step: number;
  readonly count: number;
  /** Band index under pixel `px` (padding counts to the nearest band), or null outside the range. */
  indexAt: (px: number) => number | null;
}

export function scaleBand(count: number, range: readonly [number, number], padding = 0.2): BandScale {
  const [r0, r1] = range;
  const n = Math.max(1, count);
  const step = (r1 - r0) / n;
  const bandwidth = step * (1 - padding);
  const offset = (step - bandwidth) / 2;
  const map = (index: number): number => r0 + index * step + offset;
  return Object.assign(map, {
    bandwidth,
    step,
    count: n,
    indexAt: (px: number): number | null => {
      if (!(step > 0) || px < r0 || px > r1) return null;
      return Math.min(n - 1, Math.max(0, Math.floor((px - r0) / step)));
    },
  });
}

/** A "nice" tick step (1, 2, 2.5 or 5 × 10ⁿ) giving at most about `maxTicks` intervals over `span`. */
export function niceStep(span: number, maxTicks = 5): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, maxTicks);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const factor = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return factor * magnitude;
}

/** Removes floating point noise from tick values (0.30000000000000004 → 0.3). */
const clean = (v: number): number => {
  const r = Number(v.toPrecision(12));
  return r === 0 ? 0 : r;
};

export interface NiceTicks {
  /** Tick values from `min` to `max` (inclusive). */
  ticks: number[];
  /** Domain extended outwards to whole steps. */
  min: number;
  max: number;
  step: number;
}

/**
 * Nice ticks covering [min, max]: the domain is extended outwards to whole multiples of a nice step.
 * An empty or invalid range becomes [min, min + 1].
 */
export function niceTicks(min: number, max: number, maxTicks = 5): NiceTicks {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : lo + 1;
  if (!(hi > lo)) hi = lo + 1;
  const step = niceStep(hi - lo, maxTicks);
  lo = Math.floor(clean(lo / step)) * step;
  hi = Math.ceil(clean(hi / step)) * step;
  const ticks: number[] = [];
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++) ticks.push(clean(lo + i * step));
  return { ticks, min: clean(lo), max: clean(hi), step };
}

/** Multiples of `step` inside [min, max] (inclusive), e.g. hour ticks inside a time window. */
export function ticksInRange(min: number, max: number, step: number): number[] {
  if (!(step > 0) || !(max >= min)) return [];
  const out: number[] = [];
  for (let v = Math.ceil(clean(min / step)) * step; v <= max + step * 1e-9; v += step) out.push(clean(v));
  return out;
}

/** Decimals needed to print every multiple of `step` exactly (1 → 0, 2.5 → 1, 0.25 → 2), at most 6. */
export function stepDigits(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  for (let d = 0; d <= 6; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return d;
  }
  return 6;
}

/** Index of the value in the ascending array `xs` closest to `x` (−1 for an empty array). */
export function nearestIndex(xs: readonly number[], x: number): number {
  if (xs.length === 0) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[hi] - x) < Math.abs(xs[lo] - x) ? hi : lo;
}
