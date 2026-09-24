import { cssVar } from '../../styles/tokens';

// ─────────────────────────────────────────────
// TEXT LAYOUT HELPERS
// SVG charts are laid out in JS before render (no DOM measuring pass), so label widths are estimated, or
// measured with a canvas (measureTextWidth) where a collision check needs the real width.
// ─────────────────────────────────────────────

/** Width of a text in px, measured or estimated. */
export type MeasureText = (text: string) => number;

/** Average advance of system UI fonts ≈ 0.56 em per character (generous, so estimates rarely undershoot). */
const EM_PER_CHAR = 0.56;

/** Estimated rendered width of `text` at `fontSize` px in the system sans-serif stack. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return Math.ceil(text.length * fontSize * EM_PER_CHAR);
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/**
 * Rendered width of `text` in the UI font (--font-sans) at `fontSize` px and font `weight`, measured with
 * canvas measureText; estimated (estimateTextWidth) without a canvas, e.g. in jsdom.
 */
export function measureTextWidth(text: string, fontSize: number, weight = 400): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (!measureCtx) return estimateTextWidth(text, fontSize);
  const family = cssVar(document.documentElement, '--font-sans') || 'sans-serif';
  measureCtx.font = `${weight} ${fontSize}px ${family}`;
  return Math.ceil(measureCtx.measureText(text).width);
}

export interface FlowPosition {
  x: number;
  row: number;
}

export interface FlowLayout {
  positions: FlowPosition[];
  /** Number of rows (0 for no items). */
  rows: number;
}

/**
 * Places items of the given widths left to right with `gap` between them, starting a new row when the
 * next item would exceed `maxWidth` (an item wider than maxWidth gets a row of its own).
 */
export function flowLayout(widths: readonly number[], maxWidth: number, gap: number): FlowLayout {
  const positions: FlowPosition[] = [];
  let x = 0;
  let row = 0;
  for (const w of widths) {
    if (x > 0 && x + w > maxWidth) {
      row++;
      x = 0;
    }
    positions.push({ x, row });
    x += w + gap;
  }
  return { positions, rows: widths.length === 0 ? 0 : row + 1 };
}
