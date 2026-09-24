import {
  LEGEND_FONT_SIZE,
  LEGEND_ITEM_GAP,
  LEGEND_ROW_HEIGHT,
  LEGEND_SWATCH_GAP,
  LEGEND_SWATCH_W,
} from '../../components/svg/legend';
import { estimateTextWidth, flowLayout, measureTextWidth, type FlowLayout } from '../../components/svg/text';

// ─────────────────────────────────────────────
// LEGEND LAYOUT (SVG legends of the charts, see ChartLegend.tsx)
// Named Chart… so they are not mixed up with the legend of the 2D views (views/svg), which has another API
// but the same style (components/svg/legend.ts).
// ─────────────────────────────────────────────

export type ChartLegendSwatch = 'line' | 'rect' | 'band';

export interface ChartLegendItem {
  key: string;
  label: string;
  swatch: ChartLegendSwatch;
  /** Stroke/fill colour (usually a var(--…) token). */
  color: string;
  /** Fill override, e.g. url(#hatch) for a hatched rect. */
  fill?: string;
  /** Fill opacity of 'band' swatches (default 0.35). */
  opacity?: number;
}

/** Space above an SVG legend (keeps exported PNGs from starting flush with the text). */
export const LEGEND_TOP = 4;

export interface ChartLegendLayout extends FlowLayout {
  items: readonly ChartLegendItem[];
  /** Total height in px (0 without items). */
  height: number;
}

/** Wraps legend items into rows of at most `width` px (label widths estimated). */
export function layoutChartLegend(items: readonly ChartLegendItem[], width: number): ChartLegendLayout {
  const widths = items.map(
    (it) => LEGEND_SWATCH_W + LEGEND_SWATCH_GAP + estimateTextWidth(it.label, LEGEND_FONT_SIZE),
  );
  const flow = flowLayout(widths, Math.max(1, width), LEGEND_ITEM_GAP);
  return { ...flow, items, height: flow.rows * LEGEND_ROW_HEIGHT };
}

/**
 * Left edge of a chart legend: `preferred` (e.g. the plot's left edge), moved left just as far as needed for
 * the widest item (label measured) to end inside the SVG of `width` px, but not below 0. On a narrow phone
 * a long label (e.g. "Verschattung durch oberes Stockwerk") would otherwise run past the SVG's right edge.
 */
export function chartLegendX(items: readonly ChartLegendItem[], width: number, preferred: number): number {
  const widest = items.reduce(
    (m, it) =>
      Math.max(m, LEGEND_SWATCH_W + LEGEND_SWATCH_GAP + measureTextWidth(it.label, LEGEND_FONT_SIZE)),
    0,
  );
  return Math.max(0, Math.min(preferred, width - widest));
}
