import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UI_STORAGE_KEY, useUiStore } from './uiStore';
import { resetStores } from '../test/utils';

describe('useUiStore', () => {
  beforeEach(resetStores);

  it('toggles language, theme, views and sections', () => {
    const s = useUiStore.getState();
    s.toggleLang();
    s.toggleTheme();
    s.toggleView('scene3d');
    s.toggleSection('location');
    const after = useUiStore.getState();
    expect(after.lang).toBe('en');
    expect(after.theme).toBe('light');
    expect(after.views.scene3d).toBe(false);
    expect(after.openSections.location).toBe(true);
  });

  it('rejects invalid focus floors', () => {
    useUiStore.getState().setFocusFloor(2);
    useUiStore.getState().setFocusFloor(-1);
    useUiStore.getState().setFocusFloor(1.5);
    expect(useUiStore.getState().focusFloor).toBe(2);
  });

  it('persists and validates stored state', async () => {
    localStorage.setItem(
      UI_STORAGE_KEY,
      JSON.stringify({
        state: {
          lang: 'en',
          theme: 'purple',
          views: { frontal: false, bogus: 1 },
          openSections: { weather: true, x: 'y' },
          focusFloor: -3,
        },
        version: 1,
      }),
    );
    vi.resetModules();
    const { useUiStore: fresh } = await import('./uiStore');
    const s = fresh.getState();
    expect(s.lang).toBe('en');
    expect(s.theme === 'dark' || s.theme === 'light').toBe(true);
    expect(s.views.frontal).toBe(false);
    expect(s.views.scene3d).toBe(true);
    expect(s.openSections).toEqual({ weather: true });
    expect(s.focusFloor).toBe(0);
  });
});
