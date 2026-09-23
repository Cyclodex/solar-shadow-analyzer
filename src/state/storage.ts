import type { PersistStorage, StorageValue } from 'zustand/middleware';

// ─────────────────────────────────────────────
// SAFE STORAGE
// localStorage can be missing (SSR, some webviews), disabled (privacy mode) or throw on access /
// quota. Persisted stores must keep working in memory in all these cases, and corrupt JSON must not
// break start-up (it is treated as "nothing stored").
// ─────────────────────────────────────────────

function localStorageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Reads a raw string from localStorage; null if missing or storage is unavailable. Never throws. */
export function readStorage(key: string): string | null {
  try {
    return localStorageOrNull()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Writes a raw string to localStorage; silently ignored when storage is unavailable or full. */
export function writeStorage(key: string, value: string): void {
  try {
    localStorageOrNull()?.setItem(key, value);
  } catch {
    // quota exceeded / storage disabled: persistence is optional
  }
}

/** Removes a key from localStorage; never throws. */
export function removeStorage(key: string): void {
  try {
    localStorageOrNull()?.removeItem(key);
  } catch {
    // ignore
  }
}

/** JSON persist storage for zustand `persist` that never throws (corrupt JSON → null). */
export function safeJsonStorage<S>(): PersistStorage<S> {
  return {
    getItem(name) {
      const raw = readStorage(name);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as StorageValue<S>;
      } catch {
        return null;
      }
    },
    setItem(name, value) {
      writeStorage(name, JSON.stringify(value));
    },
    removeItem(name) {
      removeStorage(name);
    },
  };
}
