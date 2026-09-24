import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../model/types';
import { DEFAULT_CONFIG } from '../model/defaults';
import { encodeConfig, readConfigFromHash } from '../model/share';
import { CONFIG_STORAGE_KEY, useConfigStore } from './configStore';
import { useShareLinkStore } from './shareLinkStore';
import { PENDING_HASH_KEY, applyHashConfig, initUrlSync, readHashConfig, shareUrl } from './urlSync';
import { resetStores } from '../test/utils';

const withTilt = (tiltFromVertical: number): Config => ({
  ...DEFAULT_CONFIG,
  panels: { ...DEFAULT_CONFIG.panels, tiltFromVertical },
});

const tilt = (): number => useConfigStore.getState().config.panels.tiltFromVertical;
const hashTilt = (): number | undefined => readConfigFromHash(location.hash)?.panels.tiltFromVertical;

describe('urlSync', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    resetStores();
    history.replaceState(null, '', '/');
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('reads the share part of a hash: absent, invalid or a config', () => {
    expect(readHashConfig('')).toEqual({ status: 'absent' });
    expect(readHashConfig('#results')).toEqual({ status: 'absent' });
    expect(readHashConfig('#c=%%%')).toEqual({ status: 'invalid' });
    expect(readHashConfig('#c=eyJwIjp7InQiOjYw')).toEqual({ status: 'invalid' }); // truncated
    const ok = readHashConfig(`#x=1&c=${encodeConfig(withTilt(20))}`);
    expect(ok.status === 'ok' && ok.config.panels.tiltFromVertical).toBe(20);
  });

  it('applies a #c= hash to the store', () => {
    expect(applyHashConfig(`#c=${encodeConfig(withTilt(20))}`)).toBe(true);
    expect(tilt()).toBe(20);
    expect(applyHashConfig('#c=%%%')).toBe(false);
    expect(applyHashConfig('')).toBe(false);
    expect(tilt()).toBe(20);
  });

  it('overrides the stored config on start-up and writes the hash on changes (throttled)', () => {
    vi.useFakeTimers();
    history.replaceState(null, '', `/#c=${encodeConfig(withTilt(10))}`);
    cleanup = initUrlSync({ throttleMs: 400 });
    expect(tilt()).toBe(10);

    // First change: written at once (a reload right after the edit keeps it).
    useConfigStore.getState().patch('panels', { tiltFromVertical: 60 });
    expect(hashTilt()).toBe(60);
    // Changes within the window: the final value is written when the window ends.
    useConfigStore.getState().patch('panels', { tiltFromVertical: 61 });
    useConfigStore.getState().patch('panels', { tiltFromVertical: 62 });
    vi.advanceTimersByTime(399);
    expect(hashTilt()).toBe(60);
    vi.advanceTimersByTime(1);
    expect(hashTilt()).toBe(62);

    vi.advanceTimersByTime(400);
    useConfigStore.getState().reset();
    expect(location.hash).toBe('');
  });

  it('builds share URLs', () => {
    const url = shareUrl(withTilt(33));
    expect(url.startsWith(`${location.origin}/#c=`)).toBe(true);
    expect(readConfigFromHash(new URL(url).hash)?.panels.tiltFromVertical).toBe(33);
  });

  it('puts a stored non-default config into the address bar at start-up', () => {
    useConfigStore.getState().patch('panels', { tiltFromVertical: 20 });
    cleanup = initUrlSync();
    expect(hashTilt()).toBe(20);
  });

  it('reports an invalid link, keeps the stored config and replaces the broken hash', () => {
    useConfigStore.getState().patch('panels', { tiltFromVertical: 20 });
    history.replaceState(null, '', '/#c=%%%garbage');
    cleanup = initUrlSync();
    expect(tilt()).toBe(20);
    expect(hashTilt()).toBe(20);
    expect(useShareLinkStore.getState().invalid).toBe('saved');

    // A valid link later clears the notice.
    history.replaceState(null, '', `/#c=${encodeConfig(withTilt(30))}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(tilt()).toBe(30);
    expect(useShareLinkStore.getState().invalid).toBeNull();
  });

  it('says so when an invalid link falls back to the default config', () => {
    history.replaceState(null, '', '/#c=eyJwIjp7InQiOjYw');
    cleanup = initUrlSync();
    expect(useConfigStore.getState().config).toEqual(DEFAULT_CONFIG);
    expect(location.hash).toBe('');
    expect(useShareLinkStore.getState().invalid).toBe('default');
  });

  it('rewrites other fragments (Back to an entry without hash, skip links) to the current config', () => {
    cleanup = initUrlSync();
    useConfigStore.getState().patch('panels', { tiltFromVertical: 25 });
    history.replaceState(null, '', '/#results');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(hashTilt()).toBe(25);
    history.replaceState(null, '', '/');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(hashTilt()).toBe(25);
    expect(tilt()).toBe(25);
  });

  it('offers to restore the own config a share link replaced', () => {
    useConfigStore.getState().patch('building', { numFloors: 5 });
    const own = useConfigStore.getState().config;
    history.replaceState(null, '', `/#c=${encodeConfig(withTilt(60))}`);
    cleanup = initUrlSync();
    expect(tilt()).toBe(60);
    expect(useShareLinkStore.getState().replaced).toBe(own);

    useShareLinkStore.getState().restore();
    expect(useConfigStore.getState().config).toEqual(own);
    expect(JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) ?? '{}').state.config.building.numFloors).toBe(
      5,
    );
    expect(useShareLinkStore.getState()).toMatchObject({ replaced: null, restored: true });
    useShareLinkStore.getState().dismiss('link');
    expect(useShareLinkStore.getState().restored).toBe(false);
  });

  it('has nothing to restore on a first visit or for a link to the config already shown', () => {
    history.replaceState(null, '', `/#c=${encodeConfig(withTilt(60))}`);
    cleanup = initUrlSync();
    expect(useShareLinkStore.getState().replaced).toBeNull(); // previous = default config
    cleanup();
    // Reload of the own tab: the hash equals the stored config.
    cleanup = initUrlSync();
    expect(useShareLinkStore.getState().replaced).toBeNull();
  });

  it('hands a pending write over to a reload through sessionStorage', () => {
    vi.useFakeTimers();
    history.replaceState(null, '', `/#c=${encodeConfig(withTilt(30))}`);
    cleanup = initUrlSync({ throttleMs: 400 });
    useConfigStore.getState().patch('panels', { tiltFromVertical: 40 }); // written at once
    useConfigStore.getState().patch('panels', { tiltFromVertical: 50 }); // pending
    const staleHash = location.hash;
    expect(hashTilt()).toBe(40);
    window.dispatchEvent(new Event('pagehide'));
    expect(hashTilt()).toBe(50);
    expect(JSON.parse(sessionStorage.getItem(PENDING_HASH_KEY) ?? '{}')).toEqual({
      stale: staleHash,
      fresh: `#c=${encodeConfig(withTilt(50))}`,
    });
    cleanup();

    // The reload starts with the URL of the time before pagehide.
    history.replaceState(null, '', `/${staleHash}`);
    cleanup = initUrlSync();
    expect(tilt()).toBe(50);
    expect(hashTilt()).toBe(50);
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBeNull();
  });

  it('a different link opened after the handoff still wins', () => {
    sessionStorage.setItem(
      PENDING_HASH_KEY,
      JSON.stringify({
        stale: `#c=${encodeConfig(withTilt(30))}`,
        fresh: `#c=${encodeConfig(withTilt(50))}`,
      }),
    );
    history.replaceState(null, '', `/#c=${encodeConfig(withTilt(20))}`);
    cleanup = initUrlSync();
    expect(tilt()).toBe(20);
    expect(sessionStorage.getItem(PENDING_HASH_KEY)).toBeNull();
  });
});
