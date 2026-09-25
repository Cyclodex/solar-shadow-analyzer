import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Lang, Theme } from '../model/types';
import { useConfigStore } from './configStore';
import { safeJsonStorage } from './storage';

// ─────────────────────────────────────────────
// UI STORE (persisted: localStorage 'ssa.ui', version 1)
// Language, theme, visible views, open sidebar sections, analysed ("focus") floor.
// A focus floor that no longer fits a smaller floor count is capped (see capFocusFloor below).
// ─────────────────────────────────────────────

export type ViewKey = 'scene3d' | 'frontal' | 'profile' | 'sunpath' | 'panelShadow';
export const VIEW_KEYS: readonly ViewKey[] = ['scene3d', 'frontal', 'profile', 'sunpath', 'panelShadow'];

/** Ids of the collapsible sidebar sections (keys of `openSections`). */
const SECTION_IDS = [
  'location',
  'building',
  'panels',
  'system',
  'battery',
  'horizon',
  'weather',
  'economics',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

const isSectionId = (id: string): id is SectionId => (SECTION_IDS as readonly string[]).includes(id);

export interface UiState {
  lang: Lang;
  theme: Theme;
  views: Record<ViewKey, boolean>;
  /** Open state per collapsible section id; missing = closed. */
  openSections: Partial<Record<SectionId, boolean>>;
  /**
   * Floor index (0 = lowest panel floor) chosen in the floor selectors. Not clamped here — read it through
   * useFocusFloor() (hooks/useModel.ts, clamped to 0…numFloors−1: Panel-Schatten, sun path, horizon) or
   * useShadedFloor() (capped at numFloors−2, the top floor has no panels above it: "shade now" KPI,
   * heatmap, shaded hours).
   */
  focusFloor: number;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setView: (key: ViewKey, visible: boolean) => void;
  toggleView: (key: ViewKey) => void;
  setSectionOpen: (id: SectionId, open: boolean) => void;
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
  const openSections: Partial<Record<SectionId, boolean>> = {};
  if (isRecord(p.openSections)) {
    for (const [k, v] of Object.entries(p.openSections)) {
      if (isSectionId(k) && typeof v === 'boolean') openSections[k] = v;
    }
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
      setFocusFloor: (floor) =>
        set((s) => (Number.isInteger(floor) && floor >= 0 ? { focusFloor: floor } : s)),
    }),
    {
      name: UI_STORAGE_KEY,
      version: 1,
      storage: safeJsonStorage<PersistedUi>(),
      // Older/unknown versions: keep what is there; mergeUi validates every field.
      migrate: (persisted) => persisted as PersistedUi,
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

/**
 * Keeps the focus floor meaningful when the floor count shrinks: a focus that pointed at a floor below the
 * old top floor is capped at the floor below the new top floor (the floor the "shade now" KPI and the
 * heatmap analyse). An explicit pick of the old top floor stays on the (new) top floor (useFocusFloor
 * clamps it). Also caps a stored focus beyond the stored floor count at start-up.
 */
function capFocusFloor(numFloors: number, previousNumFloors?: number): void {
  const { focusFloor, setFocusFloor } = useUiStore.getState();
  const cap = Math.max(0, numFloors - 2);
  if (previousNumFloors === undefined) {
    if (focusFloor > numFloors - 1) setFocusFloor(cap);
  } else if (numFloors < previousNumFloors && focusFloor > cap && focusFloor !== previousNumFloors - 1) {
    setFocusFloor(cap);
  }
}

capFocusFloor(useConfigStore.getState().config.building.numFloors);
useConfigStore.subscribe((s, prev) => {
  const n = s.config.building.numFloors;
  const pn = prev.config.building.numFloors;
  if (n !== pn) capFocusFloor(n, pn);
});
