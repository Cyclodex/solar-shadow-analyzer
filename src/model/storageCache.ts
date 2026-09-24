// ─────────────────────────────────────────────
// LOCALSTORAGE LRU CACHE
// Shared by the weather and terrain result caches. Each entry is a JSON object under `prefix + id` whose
// field `t` is its last-use stamp: reads refresh it, writes first evict the least recently used entries of
// the same prefix. Caching is optional, so nothing here ever throws.
// ─────────────────────────────────────────────

/** localStorage, or null where it is missing or access throws (sandboxed iframes, blocked site data). */
export function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

let lastStamp = 0;

/** Last-use stamp: Date.now(), but strictly increasing (equal stamps would leave the eviction order to key order). */
export function cacheStamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

/** Keys with `prefix`, least recently used first (entries without a readable stamp count as oldest). */
function keysByLastUse(storage: Storage, prefix: string): string[] {
  const entries: { k: string; t: number }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k?.startsWith(prefix)) continue;
    let t = 0;
    try {
      t = Number((JSON.parse(storage.getItem(k) ?? '{}') as { t?: unknown }).t) || 0;
    } catch {
      // corrupt entry → evicted first
    }
    entries.push({ k, t });
  }
  return entries.sort((a, b) => a.t - b.t).map((e) => e.k);
}

/** Marks the entry `key`, already read and parsed as `entry`, as just used (rewrites it with a new stamp). */
export function touchCacheEntry(storage: Storage, key: string, entry: object): void {
  try {
    storage.setItem(key, JSON.stringify({ ...entry, t: cacheStamp() }));
  } catch {
    // keeps the old stamp
  }
}

/**
 * Stores `entry` (plus a fresh stamp `t`) under `key`, keeping at most `max` entries with `prefix`: the least
 * recently used ones are removed first. If the write still fails (storage full, e.g. by other data of this
 * origin), all other entries with `prefix` are removed and the write is retried once.
 */
export function writeCacheEntry(
  storage: Storage,
  prefix: string,
  max: number,
  key: string,
  entry: object,
): void {
  try {
    const json = JSON.stringify({ ...entry, t: cacheStamp() });
    const others = keysByLastUse(storage, prefix).filter((k) => k !== key);
    for (const k of others.slice(0, Math.max(0, others.length - (max - 1)))) storage.removeItem(k);
    try {
      storage.setItem(key, json);
    } catch {
      for (const k of others) storage.removeItem(k);
      storage.setItem(key, json);
    }
  } catch {
    // quota exceeded / storage disabled: caching is optional
  }
}
