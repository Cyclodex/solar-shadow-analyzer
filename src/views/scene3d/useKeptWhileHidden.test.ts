import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useKeptWhileHidden } from './useKeptWhileHidden';

describe('useKeptWhileHidden', () => {
  it('follows the value while live, keeps the last live one while hidden and catches up', () => {
    const a = { tilt: 45 };
    const b = { tilt: 30 };
    const c = { tilt: 6 };
    const { result, rerender } = renderHook(({ value, live }) => useKeptWhileHidden(value, live), {
      initialProps: { value: a, live: true },
    });
    expect(result.current).toBe(a);
    rerender({ value: b, live: true });
    expect(result.current).toBe(b);
    // Hidden: tilt steps do not reach the consumer (same object for memoised children).
    rerender({ value: c, live: false });
    expect(result.current).toBe(b);
    rerender({ value: a, live: false });
    expect(result.current).toBe(b);
    // Back on screen: the current value right away, and kept from then on.
    rerender({ value: c, live: true });
    expect(result.current).toBe(c);
    rerender({ value: a, live: false });
    expect(result.current).toBe(c);
  });

  it('keeps the first value when it starts hidden', () => {
    const a = { tilt: 45 };
    const { result, rerender } = renderHook(({ value, live }) => useKeptWhileHidden(value, live), {
      initialProps: { value: a, live: false },
    });
    rerender({ value: { tilt: 10 }, live: false });
    expect(result.current).toBe(a);
  });
});
