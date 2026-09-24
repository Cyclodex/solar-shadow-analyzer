import { describe, expect, it } from 'vitest';
import {
  LEGEND_FONT_SIZE,
  LEGEND_ITEM_GAP,
  LEGEND_ROW_HEIGHT,
  LEGEND_SWATCH_GAP,
  LEGEND_SWATCH_W,
} from '../../components/svg/legend';
import { textWidth } from './geometry2d';
import { layoutLegend, type LegendItem } from './legend';

describe('layoutLegend', () => {
  it('flows the items into rows with the metrics shared with the charts', () => {
    const labels = ['Sonne', 'Schatten', 'Hinter der Fassade'];
    const items: LegendItem[] = labels.map((label) => ({ key: label, label, kind: 'area' }));
    const width = (label: string): number =>
      LEGEND_SWATCH_W + LEGEND_SWATCH_GAP + textWidth(label, LEGEND_FONT_SIZE);
    const second = 10 + width('Sonne') + LEGEND_ITEM_GAP;
    // Room for the first two items only: the third one starts a new row.
    const layout = layoutLegend(items, 10, second + width('Schatten') + 1, 100);
    const row0 = 100 + LEGEND_ROW_HEIGHT / 2;
    expect(layout.items.map(({ x, y }) => [x, y])).toEqual([
      [10, row0],
      [second, row0],
      [10, row0 + LEGEND_ROW_HEIGHT],
    ]);
    expect(layout.height).toBe(2 * LEGEND_ROW_HEIGHT);
    expect(layoutLegend([], 0, 100, 0)).toEqual({ items: [], height: 0 });
  });
});
