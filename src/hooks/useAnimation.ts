import { useEffect } from 'react';
import type { SunTimes } from '../model/sun';
import { clamp } from '../model/units';
import { useTimeStore } from '../state/timeStore';
import { useSunTimes } from './useModel';

// ─────────────────────────────────────────────
// DAY ANIMATION
// While timeStore.playing: advances timeStore.minutes by speed (simulated min per real second) · dt
// in a requestAnimationFrame loop, looping between sunrise − 30 min and sunset + 30 min of the selected
// date (whole day on polar days/nights). With prefers-reduced-motion the time advances in coarse
// steps every REDUCED_MOTION_STEP_MS instead of every frame.
// ─────────────────────────────────────────────

/** Margin before sunrise / after sunset, minutes. */
export const ANIMATION_MARGIN_MIN = 30;
/** Update interval with prefers-reduced-motion. */
export const REDUCED_MOTION_STEP_MS = 1000;
/** Longest frame gap that is still integrated (tab switches, debugger pauses). */
const MAX_FRAME_S = 0.25;

export interface AnimationWindow {
  start: number;
  end: number;
}

/** Local clock minutes the animation loops through for the given sun times. */
export function animationWindow(times: SunTimes): AnimationWindow {
  const { sunrise, sunset } = times;
  if (times.polar !== null || sunrise === null || sunset === null) return { start: 0, end: 1440 };
  const start = clamp(sunrise - ANIMATION_MARGIN_MIN, 0, 1440);
  const end = clamp(sunset + ANIMATION_MARGIN_MIN, 0, 1440);
  return end > start ? { start, end } : { start: 0, end: 1440 };
}

/** Next minutes value: advance by `delta`, wrap to the window start when leaving the window. */
export function nextAnimationMinutes(minutes: number, delta: number, w: AnimationWindow): number {
  const next = minutes + delta;
  return next < w.start || next > w.end ? w.start : next;
}

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/** Runs the animation loop while playing. Mount once (TimeControls). */
export function useAnimation(): void {
  const playing = useTimeStore((s) => s.playing);
  const { start, end } = animationWindow(useSunTimes());

  useEffect(() => {
    if (!playing) return;
    const w = { start, end };
    const reduced = prefersReducedMotion();
    const minStepS = reduced ? REDUCED_MOTION_STEP_MS / 1000 : 0;
    let raf = 0;
    let last: number | null = null;
    let pending = 0;
    const tick = (now: number): void => {
      if (last !== null) pending += Math.min(MAX_FRAME_S, (now - last) / 1000);
      last = now;
      if (pending > 0 && pending >= minStepS) {
        const { minutes, speed, setMinutes } = useTimeStore.getState();
        setMinutes(nextAnimationMinutes(minutes, speed * pending, w));
        pending = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, start, end]);
}
