import { describe, expect, it } from 'vitest';
import { chartLegendX, type ChartLegendItem } from './legend';

const item = (label: string): ChartLegendItem => ({ key: label, label, swatch: 'line', color: 'red' });

describe('chartLegendX', () => {
  // jsdom has no canvas: labels are estimated at 12 px × 0.56 per character, plus 22 px of swatch and gap.
  const long = [item('1. OG'), item('Verschattung durch oberes Stockwerk')]; // 22 + 236 = 258 px

  it('keeps the preferred position where the widest item fits', () => {
    expect(chartLegendX(long, 472, 48)).toBe(48);
    expect(chartLegendX(long, 306, 48)).toBe(48);
  });

  it('moves left just enough for the widest item to end inside the SVG, but not past 0', () => {
    expect(chartLegendX(long, 262, 48)).toBe(4);
    expect(chartLegendX(long, 240, 48)).toBe(0);
  });
});
