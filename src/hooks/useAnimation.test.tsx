import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimeStore } from '../state/timeStore';
import { resetStores } from '../test/utils';
import { animationWindow, nextAnimationMinutes, useAnimation } from './useAnimation';

describe('animation helpers', () => {
  it('loops between sunrise − 30 and sunset + 30', () => {
    const w = animationWindow({ sunrise: 330, solarNoon: 810, sunset: 1290, polar: null });
    expect(w).toEqual({ start: 300, end: 1320 });
    expect(nextAnimationMinutes(600, 60, w)).toBe(660);
    expect(nextAnimationMinutes(1300, 60, w)).toBe(300);
    expect(nextAnimationMinutes(100, 10, w)).toBe(300);
  });

  it('uses the whole day on polar days/nights', () => {
    expect(animationWindow({ sunrise: null, solarNoon: 700, sunset: null, polar: 'day' })).toEqual({
      start: 0,
      end: 1440,
    });
  });
});

describe('useAnimation', () => {
  beforeEach(resetStores);

  it('advances the minutes by speed · dt while playing', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    useTimeStore.setState({ minutes: 600, speed: 60, playing: true });
    renderHook(() => useAnimation());
    const step = (t: number): void => {
      const cb = frames.shift();
      act(() => cb?.(t));
    };
    step(1000); // first frame only records the timestamp
    expect(useTimeStore.getState().minutes).toBe(600);
    step(1100); // 0.1 s · 60 min/s = 6 min
    expect(useTimeStore.getState().minutes).toBeCloseTo(606, 6);
    step(1200);
    expect(useTimeStore.getState().minutes).toBeCloseTo(612, 6);
  });

  it('does nothing while paused', () => {
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    renderHook(() => useAnimation());
    expect(raf).not.toHaveBeenCalled();
  });
});
