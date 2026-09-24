import { describe, expect, it } from 'vitest';
import { isIos, isStandaloneNavigator, promptInstall } from './install';

describe('isIos', () => {
  const nav = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints });

  it('recognises iPhone, iPad and iPod, in Safari and other iOS browsers', () => {
    expect(isIos(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) … Safari/604.1', 5))).toBe(true);
    expect(isIos(nav('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) … CriOS/140.0 Mobile/15E148', 5))).toBe(
      true,
    );
    expect(isIos(nav('Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)', 5))).toBe(true);
  });

  it('tells iPadOS (desktop user agent, touch) from a Mac', () => {
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15';
    expect(isIos(nav(mac, 5))).toBe(true);
    expect(isIos(nav(mac, 0))).toBe(false);
  });

  it('is false for Android and desktop browsers', () => {
    expect(
      isIos(nav('Mozilla/5.0 (Linux; Android 15; Pixel 9) … Chrome/140.0 Mobile Safari/537.36', 5)),
    ).toBe(false);
    expect(isIos(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/140.0 Safari/537.36'))).toBe(false);
  });
});

describe('isStandaloneNavigator', () => {
  it('reads the iOS navigator.standalone flag', () => {
    expect(isStandaloneNavigator({ standalone: true } as unknown as Navigator)).toBe(true);
    expect(isStandaloneNavigator({ standalone: false } as unknown as Navigator)).toBe(false);
    expect(isStandaloneNavigator({} as Navigator)).toBe(false);
  });
});

describe('promptInstall', () => {
  it('reports "unavailable" without a kept install event', async () => {
    await expect(promptInstall()).resolves.toBe('unavailable');
  });
});
