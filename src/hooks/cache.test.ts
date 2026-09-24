import { describe, expect, it, vi } from 'vitest';
import { createCache } from './cache';

describe('createCache', () => {
  it('returns cached values for identical deps and evicts the least recently used', () => {
    const cache = createCache<number>(2);
    const a = {};
    const b = {};
    const compute = vi.fn(() => Math.random());
    const va = cache.get([a, 1], compute);
    expect(cache.get([a, 1], compute)).toBe(va);
    expect(compute).toHaveBeenCalledTimes(1);
    cache.get([b, 1], compute); // 2 entries
    cache.get([a, 1], compute); // hit, a becomes most recent
    cache.get([a, 2], compute); // evicts b
    expect(compute).toHaveBeenCalledTimes(3);
    cache.get([a, 1], compute);
    expect(compute).toHaveBeenCalledTimes(3);
    cache.get([b, 1], compute);
    expect(compute).toHaveBeenCalledTimes(4);
    cache.clear();
    cache.get([a, 1], compute);
    expect(compute).toHaveBeenCalledTimes(5);
  });

  it('compares with Object.is (NaN equal, different objects not)', () => {
    const cache = createCache<string>(3);
    const compute = vi.fn(() => 'x');
    cache.get([NaN], compute);
    cache.get([NaN], compute);
    cache.get([{}], compute);
    cache.get([{}], compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it('peek reads without computing', () => {
    const cache = createCache<string>(2);
    expect(cache.peek([1])).toBeUndefined();
    cache.get([1], () => 'one');
    expect(cache.peek([1])).toBe('one');
    expect(cache.peek([2])).toBeUndefined();
  });
});
