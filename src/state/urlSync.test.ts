import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { encodeConfig, readConfigFromHash } from '../model/share';
import { useConfigStore } from './configStore';
import { applyHashConfig, initUrlSync, shareUrl } from './urlSync';
import { resetStores } from '../test/utils';

const withTilt = (tiltFromVertical: number) => ({
  ...DEFAULT_CONFIG,
  panels: { ...DEFAULT_CONFIG.panels, tiltFromVertical },
});

describe('urlSync', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    resetStores();
    history.replaceState(null, '', '/');
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('applies a #c= hash to the store', () => {
    expect(applyHashConfig(`#c=${encodeConfig(withTilt(20))}`)).toBe(true);
    expect(useConfigStore.getState().config.panels.tiltFromVertical).toBe(20);
    expect(applyHashConfig('#c=%%%')).toBe(false);
    expect(applyHashConfig('')).toBe(false);
  });

  it('overrides the stored config on start-up and writes the hash on changes (debounced)', () => {
    vi.useFakeTimers();
    history.replaceState(null, '', `/#c=${encodeConfig(withTilt(10))}`);
    cleanup = initUrlSync({ debounceMs: 400 });
    expect(useConfigStore.getState().config.panels.tiltFromVertical).toBe(10);

    useConfigStore.getState().patch('panels', { tiltFromVertical: 60 });
    vi.advanceTimersByTime(399);
    expect(readConfigFromHash(location.hash)?.panels.tiltFromVertical).toBe(10);
    vi.advanceTimersByTime(1);
    expect(readConfigFromHash(location.hash)?.panels.tiltFromVertical).toBe(60);

    useConfigStore.getState().reset();
    vi.advanceTimersByTime(400);
    expect(location.hash).toBe('');
  });

  it('builds share URLs', () => {
    const url = shareUrl(withTilt(33));
    expect(url.startsWith(`${location.origin}/#c=`)).toBe(true);
    expect(readConfigFromHash(new URL(url).hash)?.panels.tiltFromVertical).toBe(33);
  });
});
