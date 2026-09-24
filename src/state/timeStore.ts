import { create } from 'zustand';
import { isValidDate, todayInTimeZone } from '../model/time';
import { clamp } from '../model/units';
import { useConfigStore } from './configStore';

// ─────────────────────────────────────────────
// TIME STORE (not persisted)
// Selected local date + local clock minutes of the site's time zone, and the animation state.
// Initial date: today at the site (moves with a changed time zone while still "today", see below).
// ─────────────────────────────────────────────

/** Animation speeds: simulated minutes per real second. */
export const SPEED_OPTIONS = [15, 30, 60, 120] as const;
export type Speed = (typeof SPEED_OPTIONS)[number];

export const DEFAULT_MINUTES = 720;
export const DEFAULT_SPEED: Speed = 60;

export interface TimeState {
  /** Local calendar date "YYYY-MM-DD" at the site. */
  date: string;
  /** Local clock minutes since midnight, 0…1440 (may be fractional while animating). */
  minutes: number;
  playing: boolean;
  speed: Speed;
  /** Ignores invalid dates (e.g. an empty date input). */
  setDate: (date: string) => void;
  /** Clamped to 0…1440; non-finite values are ignored. */
  setMinutes: (minutes: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setSpeed: (speed: Speed) => void;
}

/** Today in the time zone of the current config. */
export function todayAtSite(nowMs: number = Date.now()): string {
  return todayInTimeZone(useConfigStore.getState().config.location.timezone, nowMs);
}

export const useTimeStore = create<TimeState>()((set) => ({
  date: todayAtSite(),
  minutes: DEFAULT_MINUTES,
  playing: false,
  speed: DEFAULT_SPEED,
  setDate: (date) => set((s) => (isValidDate(date) && date !== s.date ? { date } : s)),
  setMinutes: (minutes) => set((s) => (Number.isFinite(minutes) ? { minutes: clamp(minutes, 0, 1440) } : s)),
  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  setSpeed: (speed) => set({ speed }),
}));

// "Today" follows the site: when the time zone changes (share link at start-up, place search, own
// location) while today is selected, the date moves to today in the new zone — e.g. a link to Auckland
// opened in Europe in the evening shows tomorrow's date. A date picked on purpose is kept.
useConfigStore.subscribe((s, prev) => {
  const tz = s.config.location.timezone;
  const prevTz = prev.config.location.timezone;
  if (tz === prevTz) return;
  const now = Date.now();
  if (useTimeStore.getState().date === todayInTimeZone(prevTz, now)) {
    useTimeStore.setState({ date: todayInTimeZone(tz, now) });
  }
});
