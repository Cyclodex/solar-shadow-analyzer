import { describe, expect, it } from 'vitest';
import { nearestIndex, niceStep, niceTicks, scaleBand, scaleLinear, stepDigits, ticksInRange } from './scale';
import { estimateTextWidth, flowLayout } from './text';
import { linePath, roundedTopBar } from './paths';

describe('scaleLinear', () => {
  it('maps and inverts, also with a reversed range', () => {
    const y = scaleLinear([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(25)).toBe(150);
    expect(y.invert(50)).toBe(75);
  });

  it('degenerate domains map to the range start', () => {
    const x = scaleLinear([5, 5], [10, 20]);
    expect(x(5)).toBe(10);
    expect(x.invert(15)).toBe(5);
  });
});

describe('scaleBand', () => {
  it('places bands with padding and finds the band under a pixel', () => {
    const x = scaleBand(12, [0, 120], 0.2);
    expect(x.step).toBe(10);
    expect(x.bandwidth).toBe(8);
    expect(x(0)).toBe(1);
    expect(x(11)).toBe(111);
    expect(x.indexAt(0)).toBe(0);
    expect(x.indexAt(59.9)).toBe(5);
    expect(x.indexAt(120)).toBe(11);
    expect(x.indexAt(-1)).toBeNull();
    expect(x.indexAt(121)).toBeNull();
  });
});

describe('nice ticks', () => {
  it('picks 1/2/2.5/5 steps', () => {
    expect(niceStep(100, 5)).toBe(20);
    expect(niceStep(12, 5)).toBe(2.5);
    expect(niceStep(0.9, 4)).toBe(0.25);
    expect(niceStep(0, 5)).toBe(1);
  });

  it('extends the domain to whole steps without float noise', () => {
    const t = niceTicks(0, 643, 4);
    expect(t.ticks).toEqual([0, 200, 400, 600, 800]);
    expect(t.max).toBe(800);
    expect(niceTicks(0, 0.7, 3).ticks).toEqual([0, 0.25, 0.5, 0.75]);
    expect(niceTicks(0, 0).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it('knows how many decimals a step needs', () => {
    expect(stepDigits(200)).toBe(0);
    expect(stepDigits(2.5)).toBe(1);
    expect(stepDigits(0.25)).toBe(2);
    expect(stepDigits(0)).toBe(0);
  });

  it('lists multiples of a step inside a range', () => {
    expect(ticksInRange(240, 1380, 180)).toEqual([360, 540, 720, 900, 1080, 1260]);
    expect(ticksInRange(0, 90, 15)).toEqual([0, 15, 30, 45, 60, 75, 90]);
    expect(ticksInRange(10, 5, 1)).toEqual([]);
  });
});

describe('nearestIndex', () => {
  it('finds the closest value in a sorted array', () => {
    const xs = [0, 10, 20, 30];
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 14)).toBe(1);
    expect(nearestIndex(xs, 16)).toBe(2);
    expect(nearestIndex(xs, 99)).toBe(3);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

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

describe('paths', () => {
  it('builds polylines', () => {
    expect(linePath([])).toBe('');
    expect(
      linePath([
        [0, 1],
        [2.345, 3],
      ]),
    ).toBe('M0 1L2.3 3');
    expect(
      linePath(
        [
          [0, 1],
          [2, 3],
          [2, 1],
        ],
        true,
      ),
    ).toBe('M0 1L2 3L2 1Z');
    expect(linePath([], true)).toBe('');
  });

  it('rounds only the top corners and skips empty bars', () => {
    expect(roundedTopBar(0, 0, 10, 0)).toBe('');
    expect(roundedTopBar(0, 10, 10, 20, 0)).toBe('M0 30V10H10V30Z');
    const d = roundedTopBar(0, 10, 10, 20, 4);
    expect(d.startsWith('M0 30V14Q0 10 4 10')).toBe(true);
    expect(d.endsWith('V30Z')).toBe(true);
  });
});
