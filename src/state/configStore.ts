import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Config } from '../model/types';
import { DEFAULT_CONFIG } from '../model/defaults';
import { sanitizeConfig } from '../model/share';
import { safeJsonStorage } from './storage';

// ─────────────────────────────────────────────
// CONFIG STORE (persisted: localStorage 'ssa.config', version 2)
// Every write goes through sanitizeConfig (clamped to LIMITS, rounded, valid time zone), then is
// structurally shared with the previous config: sections whose content did not change keep their
// object identity. Hooks memoise per section reference (e.g. a tilt change leaves `location`,
// `building`, `weather` … untouched), and a write that changes nothing does not notify subscribers.
// ─────────────────────────────────────────────

/** Config sections (everything except the `version` tag). */
export type SectionKey = Exclude<keyof Config, 'version'>;

export const SECTION_KEYS: readonly SectionKey[] = [
  'location',
  'building',
  'panels',
  'system',
  'horizon',
  'weather',
  'economics',
];

export interface ConfigState {
  config: Config;
  /** Merges `partial` into one section, e.g. patch('panels', { tiltFromVertical: 30 }). */
  patch: <K extends SectionKey>(section: K, partial: Partial<Config[K]>) => void;
  /** Functional update of the whole config. */
  setConfig: (updater: (config: Config) => Config) => void;
  /** Replaces the whole config (e.g. imported JSON, share link). */
  replace: (config: Config) => void;
  /** Back to DEFAULT_CONFIG. */
  reset: () => void;
}

/** Persisted part of the state. */
interface PersistedConfig {
  config: Config;
}

export const CONFIG_STORAGE_KEY = 'ssa.config';
export const CONFIG_STORAGE_VERSION = 2;

const sameJson = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Sanitizes `next` and keeps the section objects of `prev` whose content is unchanged.
 * Returns `prev` itself if nothing changed.
 */
export function shareConfig(prev: Config, next: unknown): Config {
  const clean = sanitizeConfig(next);
  const out: Config = { ...clean };
  let changed = false;
  for (const key of SECTION_KEYS) {
    if (sameJson(prev[key], clean[key])) {
      // Both sides hold the same section type for the same key.
      (out as unknown as Record<SectionKey, unknown>)[key] = prev[key];
    } else {
      changed = true;
    }
  }
  return changed ? out : prev;
}

/** The config inside a persisted value: `{ config }` (v2) or a bare (v1 flat) config object. */
function persistedConfig(persisted: unknown): unknown {
  if (typeof persisted === 'object' && persisted !== null && 'config' in persisted) {
    return (persisted as { config: unknown }).config;
  }
  return persisted;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      config: DEFAULT_CONFIG,
      patch: (section, partial) =>
        set((s) => {
          const config = shareConfig(s.config, {
            ...s.config,
            [section]: { ...s.config[section], ...partial },
          });
          return config === s.config ? s : { config };
        }),
      setConfig: (updater) =>
        set((s) => {
          const config = shareConfig(s.config, updater(s.config));
          return config === s.config ? s : { config };
        }),
      replace: (next) =>
        set((s) => {
          const config = shareConfig(s.config, next);
          return config === s.config ? s : { config };
        }),
      reset: () =>
        set((s) => {
          const config = shareConfig(s.config, DEFAULT_CONFIG);
          return config === s.config ? s : { config };
        }),
    }),
    {
      name: CONFIG_STORAGE_KEY,
      version: CONFIG_STORAGE_VERSION,
      storage: safeJsonStorage<PersistedConfig>(),
      partialize: (s): PersistedConfig => ({ config: s.config }),
      // Older stored versions (v1 flat config, or `{ config: v1 }`) → sanitizeConfig migrates them.
      migrate: (persisted): PersistedConfig => ({ config: sanitizeConfig(persistedConfig(persisted)) }),
      merge: (persisted, current) => {
        if (persisted === undefined || persisted === null) return current;
        return { ...current, config: shareConfig(current.config, persistedConfig(persisted)) };
      },
    },
  ),
);

/** The current config (re-renders on any config change). */
export function useConfig(): Config {
  return useConfigStore((s) => s.config);
}

/** One config section (re-renders only when that section changes). */
export function useConfigSection<K extends SectionKey>(key: K): Config[K] {
  return useConfigStore((s) => s.config[key]);
}

/** The stable `patch` action (never changes identity). */
export function usePatch(): ConfigState['patch'] {
  return useConfigStore((s) => s.patch);
}
