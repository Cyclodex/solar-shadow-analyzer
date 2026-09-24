import { estimateTextWidth, flowLayout, type FlowLayout } from './text';

// ─────────────────────────────────────────────
// LEGEND LAYOUT (SVG legends, see SvgLegend.tsx)
// ─────────────────────────────────────────────

export type LegendSwatch = 'line' | 'rect' | 'band';

export interface LegendItem {
  key: string;
  label: string;
  swatch: LegendSwatch;
  /** Stroke/fill colour (usually a var(--…) token). */
  color: string;
  /** Fill override, e.g. url(#hatch) for a hatched rect. */
  fill?: string;
  /** Fill opacity of 'band' swatches (default 0.35). */
  opacity?: number;
}

export const LEGEND_FONT_SIZE = 12;
export const LEGEND_SWATCH_W = 16;
export const LEGEND_SWATCH_GAP = 6;
export const LEGEND_ITEM_GAP = 16;
export const LEGEND_ROW_HEIGHT = 18;
/** Space above an SVG legend (keeps exported PNGs from starting flush with the text). */
export const LEGEND_TOP = 4;

export interface LegendLayout extends FlowLayout {
  items: readonly LegendItem[];
  /** Total height in px (0 without items). */
  height: number;
}

/** Wraps legend items into rows of at most `width` px (label widths estimated). */
export function layoutLegend(items: readonly LegendItem[], width: number): LegendLayout {
  const widths = items.map(
    (it) => LEGEND_SWATCH_W + LEGEND_SWATCH_GAP + estimateTextWidth(it.label, LEGEND_FONT_SIZE),
  );
  const flow = flowLayout(widths, Math.max(1, width), LEGEND_ITEM_GAP);
  return { ...flow, items, height: flow.rows * LEGEND_ROW_HEIGHT };
}
