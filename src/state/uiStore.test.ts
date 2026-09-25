import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfigStore } from './configStore';
import { UI_STORAGE_KEY, useUiStore } from './uiStore';
import { resetStores } from '../test/utils';

describe('useUiStore', () => {
  beforeEach(resetStores);

  it('toggles language, theme, views and sections', () => {
    const s = useUiStore.getState();
    s.toggleLang();
    s.toggleTheme();
    s.toggleView('scene3d');
    s.setSectionOpen('location', true);
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

  it('caps the focus floor when the floor count shrinks', () => {
    const floors = (n: number): void => useConfigStore.getState().patch('building', { numFloors: n });
    floors(4);
    useUiStore.getState().setFocusFloor(2); // 3. OG, below the top floor
    floors(2);
    expect(useUiStore.getState().focusFloor).toBe(0); // the floor below the new top floor
    // An explicit pick of the top floor stays on the top floor (useFocusFloor clamps it).
    floors(4);
    useUiStore.getState().setFocusFloor(3);
    floors(3);
    expect(useUiStore.getState().focusFloor).toBe(3);
    // A growing floor count never moves the focus.
    useUiStore.getState().setFocusFloor(1);
    floors(8);
    expect(useUiStore.getState().focusFloor).toBe(1);
  });

  it('caps a stored focus floor beyond the stored floor count at start-up', async () => {
    localStorage.setItem(
      'ssa.config',
      JSON.stringify({ state: { config: { building: { numFloors: 3 } } }, version: 2 }),
    );
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ state: { focusFloor: 6 }, version: 1 }));
    vi.resetModules();
    const { useUiStore: fresh } = await import('./uiStore');
    expect(fresh.getState().focusFloor).toBe(1);
  });

  it('hands a surroundings import request over once (not persisted)', () => {
    const s = useUiStore.getState();
    expect(s.surroundingsImport).toBeNull();
    s.requestSurroundingsImport(46.947849, 7.449978);
    const first = useUiStore.getState().surroundingsImport;
    expect(first).toMatchObject({ latitude: 46.947849, longitude: 7.449978 });
    s.requestSurroundingsImport(NaN, 7);
    expect(useUiStore.getState().surroundingsImport).toBe(first);
    expect(useUiStore.getState().consumeSurroundingsImport()).toBe(first);
    expect(useUiStore.getState().surroundingsImport).toBeNull();
    expect(useUiStore.getState().consumeSurroundingsImport()).toBeNull();
    // The same address again is a new request.
    s.requestSurroundingsImport(46.947849, 7.449978);
    expect(useUiStore.getState().surroundingsImport!.id).toBeGreaterThan(first!.id);
    expect(localStorage.getItem(UI_STORAGE_KEY) ?? '').not.toContain('surroundingsImport');
  });

  it('persists and validates stored state', async () => {
    localStorage.setItem(
      UI_STORAGE_KEY,
      JSON.stringify({
        state: {
          lang: 'en',
          theme: 'purple',
          views: { frontal: false, bogus: 1 },
          openSections: { weather: true, x: 'y', bogus: true },
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
