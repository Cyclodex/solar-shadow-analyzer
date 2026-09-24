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

export const LEGEND_FONT = 11;
export const LEGEND_ROW = 18;
export const LEGEND_SWATCH = 18;
const LABEL_GAP = 6;
const ITEM_GAP = 16;

/** Flow layout of legend items into rows between x0 and x1, starting at `top`. */
export function layoutLegend(
  items: readonly LegendItem[],
  x0: number,
  x1: number,
  top: number,
): LegendLayout {
  const placed: PlacedLegendItem[] = [];
  let x = x0;
  let row = 0;
  for (const item of items) {
    const w = LEGEND_SWATCH + LABEL_GAP + textWidth(item.label, LEGEND_FONT);
    if (x > x0 && x + w > x1) {
      row += 1;
      x = x0;
    }
    placed.push({ item, x, y: top + row * LEGEND_ROW + LEGEND_ROW / 2 });
    x += w + ITEM_GAP;
  }
  return { items: placed, height: items.length === 0 ? 0 : (row + 1) * LEGEND_ROW };
}
