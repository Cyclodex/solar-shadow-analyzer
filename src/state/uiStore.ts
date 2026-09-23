import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Lang, Theme } from '../model/types';
import { safeJsonStorage } from './storage';

// ─────────────────────────────────────────────
// UI STORE (persisted: localStorage 'ssa.ui', version 1)
// Language, theme, visible views, open sidebar sections, analysed ("focus") floor.
// ─────────────────────────────────────────────

export type ViewKey = 'scene3d' | 'frontal' | 'profile' | 'sunpath' | 'panelShadow';
export const VIEW_KEYS: readonly ViewKey[] = ['scene3d', 'frontal', 'profile', 'sunpath', 'panelShadow'];

/** Ids of the collapsible sidebar sections (keys of `openSections`). */
export type SectionId = 'location' | 'building' | 'panels' | 'system' | 'horizon' | 'weather' | 'economics';

export interface UiState {
  lang: Lang;
  theme: Theme;
  views: Record<ViewKey, boolean>;
  /** Open state per collapsible section id; missing = closed. */
  openSections: Partial<Record<string, boolean>>;
  /**
   * Floor index (0 = lowest panel floor) analysed by the PanelShadowView, the heatmap and the "shade now" KPI.
   * Not clamped here — read it through useFocusFloor() (hooks/useModel.ts), which clamps to the floor count.
   */
  focusFloor: number;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setView: (key: ViewKey, visible: boolean) => void;
  toggleView: (key: ViewKey) => void;
  setSectionOpen: (id: string, open: boolean) => void;
  toggleSection: (id: string) => void;
  setFocusFloor: (floor: number) => void;
}

type PersistedUi = Pick<UiState, 'lang' | 'theme' | 'views' | 'openSections' | 'focusFloor'>;

export const UI_STORAGE_KEY = 'ssa.ui';

export const DEFAULT_VIEWS: Record<ViewKey, boolean> = {
  scene3d: true,
  frontal: true,
  profile: true,
  sunpath: true,
  panelShadow: true,
};

/** Theme from the OS preference (dark if unknown). */
export function preferredTheme(): Theme {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates persisted UI state; invalid fields keep the current values. */
function mergeUi(persisted: unknown, current: UiState): UiState {
  if (!isRecord(persisted)) return current;
  const p = persisted;
  const views = { ...current.views };
  if (isRecord(p.views)) {
    for (const k of VIEW_KEYS) if (typeof p.views[k] === 'boolean') views[k] = p.views[k];
  }
  const openSections: Record<string, boolean> = {};
  if (isRecord(p.openSections)) {
    for (const [k, v] of Object.entries(p.openSections)) if (typeof v === 'boolean') openSections[k] = v;
  }
  return {
    ...current,
    lang: p.lang === 'de' || p.lang === 'en' ? p.lang : current.lang,
    theme: p.theme === 'dark' || p.theme === 'light' ? p.theme : current.theme,
    views,
    openSections,
    focusFloor:
      typeof p.focusFloor === 'number' && Number.isInteger(p.focusFloor) && p.focusFloor >= 0
        ? p.focusFloor
        : current.focusFloor,
  };
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      lang: 'de',
      theme: preferredTheme(),
      views: DEFAULT_VIEWS,
      openSections: {},
      focusFloor: 0,
      setLang: (lang) => set({ lang }),
      toggleLang: () => set((s) => ({ lang: s.lang === 'de' ? 'en' : 'de' })),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setView: (key, visible) => set((s) => ({ views: { ...s.views, [key]: visible } })),
      toggleView: (key) => set((s) => ({ views: { ...s.views, [key]: !s.views[key] } })),
      setSectionOpen: (id, open) => set((s) => ({ openSections: { ...s.openSections, [id]: open } })),
      toggleSection: (id) => set((s) => ({ openSections: { ...s.openSections, [id]: !s.openSections[id] } })),
      setFocusFloor: (floor) =>
        set((s) => (Number.isInteger(floor) && floor >= 0 ? { focusFloor: floor } : s)),
    }),
    {
      name: UI_STORAGE_KEY,
      version: 1,
      storage: safeJsonStorage<PersistedUi>(),
      partialize: (s): PersistedUi => ({
        lang: s.lang,
        theme: s.theme,
        views: s.views,
        openSections: s.openSections,
        focusFloor: s.focusFloor,
      }),
      merge: mergeUi,
    },
  ),
);
