import {
  LEGEND_FONT_SIZE,
  LEGEND_ITEM_GAP,
  LEGEND_ROW_HEIGHT,
  LEGEND_SWATCH_GAP,
  LEGEND_SWATCH_W,
} from '../../components/svg/legend';
import { flowLayout } from '../../components/svg/text';
import { textWidth } from './geometry2d';

/** How a legend swatch is drawn. */
export type SwatchKind =
  /** Solid line (className sets the stroke, e.g. s.sunPath). */
  | 'line'
  /** Area: a filled square (className sets the fill); `patternId` adds a hatch overlay. */
  | 'area'
  /** Small circle (className sets fill/stroke). */
  | 'dot'
  /** Sun glyph. */
  | 'sun';

export interface LegendItem {
  key: string;
  label: string;
  kind: SwatchKind;
  /** Class for the swatch's colour (from svg.module.css or the view's module). */
  className?: string;
  /** Hatch pattern id layered over an 'area' swatch. */
  patternId?: string;
  /** Class of a fill drawn underneath an 'area' swatch (e.g. the panel colour under the shade). */
  baseClassName?: string;
}

export interface PlacedLegendItem {
  item: LegendItem;
  /** Left edge of the swatch. */
  x: number;
  /** Vertical centre of the row. */
  y: number;
}

export interface LegendLayout {
  items: PlacedLegendItem[];
  /** Total height, px (0 without items). */
  height: number;
}

/**
 * Flow layout of legend items into rows between x0 and x1, starting at `top`, in the legend style the
 * charts use (components/svg/legend.ts).
 */
export function layoutLegend(
  items: readonly LegendItem[],
  x0: number,
  x1: number,
  top: number,
): LegendLayout {
  const widths = items.map(
    (item) => LEGEND_SWATCH_W + LEGEND_SWATCH_GAP + textWidth(item.label, LEGEND_FONT_SIZE),
  );
  const flow = flowLayout(widths, x1 - x0, LEGEND_ITEM_GAP);
  return {
    items: items.map((item, i) => {
      const { x, row } = flow.positions[i];
      return { item, x: x0 + x, y: top + row * LEGEND_ROW_HEIGHT + LEGEND_ROW_HEIGHT / 2 };
    }),
    height: flow.rows * LEGEND_ROW_HEIGHT,
  };
}
