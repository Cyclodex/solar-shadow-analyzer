import { describe, expect, it } from 'vitest';
import { linePath, roundedTopBar } from './paths';

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
