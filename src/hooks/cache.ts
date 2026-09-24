// ─────────────────────────────────────────────
// SHARED MEMO CACHE
// Like useMemo, but shared by all components: several components calling useSimulation() compute
// the year only once. Dependencies are compared with Object.is (config sections keep their identity
// when unchanged, see state/configStore.ts). A few entries are kept so that components rendering with
// a deferred (old) and a current value both hit the cache.
// ─────────────────────────────────────────────

export interface SharedCache<T> {
  /** Cached value for `deps`, computing it with `compute` on a miss. */
  get: (deps: readonly unknown[], compute: () => T) => T;
  /** Cached value for `deps` without computing (undefined on a miss). */
  peek: (deps: readonly unknown[]) => T | undefined;
  /** Drops all entries (tests). */
  clear: () => void;
}

/** Same length and Object.is-equal entries. */
export const sameDeps = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/** Most-recently-used cache with `size` entries. */
export function createCache<T>(size = 3): SharedCache<T> {
  let entries: { deps: readonly unknown[]; value: T }[] = [];
  return {
    get(deps, compute) {
      const i = entries.findIndex((e) => sameDeps(e.deps, deps));
      if (i >= 0) {
        const hit = entries[i];
        if (i > 0) entries = [hit, ...entries.slice(0, i), ...entries.slice(i + 1)];
        return hit.value;
      }
      const value = compute();
      entries = [{ deps: [...deps], value }, ...entries].slice(0, size);
      return value;
    },
    peek(deps) {
      return entries.find((e) => sameDeps(e.deps, deps))?.value;
    },
    clear() {
      entries = [];
    },
  };
}
