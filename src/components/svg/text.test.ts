import { describe, expect, it } from 'vitest';
import { estimateTextWidth, flowLayout } from './text';

describe('text layout', () => {
  it('wraps items into rows', () => {
    const flow = flowLayout([50, 50, 50], 120, 10);
    expect(flow.rows).toBe(2);
    expect(flow.positions).toEqual([
      { x: 0, row: 0 },
      { x: 60, row: 0 },
      { x: 0, row: 1 },
    ]);
    expect(flowLayout([], 100, 10).rows).toBe(0);
  });

  it('estimates text width from the character count', () => {
    expect(estimateTextWidth('1. OG', 12)).toBeGreaterThan(20);
    expect(estimateTextWidth('', 12)).toBe(0);
  });
});
