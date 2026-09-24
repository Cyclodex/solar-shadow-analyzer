import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfigStore } from './configStore';
import { todayAtSite, useTimeStore } from './timeStore';
import { resetStores, TEST_DATE } from '../test/utils';

describe('useTimeStore', () => {
  beforeEach(resetStores);

  it('starts at 12:00', () => {
    expect(useTimeStore.getState().minutes).toBe(720);
    expect(useTimeStore.getState().date).toBe(TEST_DATE);
  });

  it('ignores invalid dates', () => {
    useTimeStore.getState().setDate('');
    useTimeStore.getState().setDate('2025-02-30');
    expect(useTimeStore.getState().date).toBe(TEST_DATE);
    useTimeStore.getState().setDate('2024-12-21');
    expect(useTimeStore.getState().date).toBe('2024-12-21');
  });

  it('clamps minutes and ignores non-finite values', () => {
    useTimeStore.getState().setMinutes(-10);
    expect(useTimeStore.getState().minutes).toBe(0);
    useTimeStore.getState().setMinutes(2000);
    expect(useTimeStore.getState().minutes).toBe(1440);
    useTimeStore.getState().setMinutes(NaN);
    expect(useTimeStore.getState().minutes).toBe(1440);
  });

  it('toggles playing and sets the speed', () => {
    useTimeStore.getState().togglePlaying();
    expect(useTimeStore.getState().playing).toBe(true);
    useTimeStore.getState().setSpeed(120);
    expect(useTimeStore.getState().speed).toBe(120);
  });

  it('keeps "today" at the site when the time zone changes (e.g. a share link to Auckland)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T20:00:00Z')); // 22:00 in Zurich, 08:00 next day in Auckland
    useTimeStore.getState().setDate(todayAtSite());
    expect(useTimeStore.getState().date).toBe('2026-09-24');
    const setTz = (timezone: string): void => useConfigStore.getState().patch('location', { timezone });
    setTz('Pacific/Auckland');
    expect(useTimeStore.getState().date).toBe('2026-09-25');
    setTz('Pacific/Honolulu');
    expect(useTimeStore.getState().date).toBe('2026-09-24');
  });

  it('keeps a date picked on purpose when the time zone changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T20:00:00Z'));
    useTimeStore.getState().setDate('2025-06-21');
    useConfigStore.getState().patch('location', { timezone: 'Pacific/Auckland' });
    expect(useTimeStore.getState().date).toBe('2025-06-21');
  });
});
