import { create } from 'zustand';
import type { Config } from '../model/types';
import { useConfigStore } from './configStore';

// ─────────────────────────────────────────────
// SHARE LINK NOTICES (runtime only, not persisted)
// Written by urlSync when a '#c=' link is opened, shown by WarningsBar:
// - a valid link replaced a configuration of the visitor's own → offer to restore it;
// - the link could not be decoded (e.g. truncated by a messenger) → say so instead of silently
//   showing the stored configuration as if it were the shared one.
// ─────────────────────────────────────────────

export interface ShareLinkState {
  /** The visitor's own configuration that an opened share link replaced (null = nothing to restore). */
  replaced: Config | null;
  /** True after `restore()`, until dismissed or the next link. */
  restored: boolean;
  /** An opened '#c=' link was invalid; which configuration is shown instead. Null = no invalid link. */
  invalid: 'saved' | 'default' | null;
  /** A valid link was applied; `previous` = the config it replaced if worth restoring, else null. */
  linkApplied: (previous: Config | null) => void;
  /** An invalid link was opened. */
  linkInvalid: (showing: 'saved' | 'default') => void;
  /** Puts the replaced configuration back into the config store. */
  restore: () => void;
  /** Hides a notice: 'link' = replaced / restored, 'invalid' = invalid link. */
  dismiss: (notice: 'link' | 'invalid') => void;
}

export const INITIAL_SHARE_LINK = { replaced: null, restored: false, invalid: null } as const;

export const useShareLinkStore = create<ShareLinkState>()((set, get) => ({
  ...INITIAL_SHARE_LINK,
  // A notice still pending keeps the configuration from before the first link (the visitor's own).
  linkApplied: (previous) =>
    set((s) => ({ replaced: s.replaced ?? previous, restored: false, invalid: null })),
  linkInvalid: (showing) => set({ invalid: showing, restored: false }),
  restore: () => {
    const { replaced } = get();
    if (!replaced) return;
    useConfigStore.getState().replace(replaced);
    set({ replaced: null, restored: true });
  },
  dismiss: (notice) => set(notice === 'invalid' ? { invalid: null } : { replaced: null, restored: false }),
}));
