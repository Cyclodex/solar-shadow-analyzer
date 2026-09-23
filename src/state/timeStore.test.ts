import { beforeEach, describe, expect, it } from 'vitest';
import { useTimeStore } from './timeStore';
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
});
