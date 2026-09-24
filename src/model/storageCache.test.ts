// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cacheStamp, getStorage, touchCacheEntry, writeCacheEntry } from './storageCache';

const P = 'test.cache:';

/** Map-backed Storage that throws QuotaExceededError when keys + values exceed `quota` characters. */
function limitedStorage(quota: number, initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  const size = (): number => [...m].reduce((a, [k, v]) => a + k.length + v.length, 0);
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const prev = m.get(k);
      if (size() - (prev === undefined ? 0 : k.length + prev.length) + k.length + v.length > quota) {
        throw new DOMException('full', 'QuotaExceededError');
      }
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const keys = (s: Storage, prefix = P): string[] =>
  Array.from({ length: s.length }, (_, i) => s.key(i) ?? '')
    .filter((k) => k.startsWith(prefix))
    .sort();

describe('storageCache', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('stamps strictly increase, also within one millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const a = cacheStamp();
    const b = cacheStamp();
    expect(b).toBeGreaterThan(a);
  });

  it('keeps the `max` most recently used entries of its prefix', () => {
    const s = localStorage;
    s.setItem('other:x', 'foreign');
    for (const id of ['a', 'b', 'c']) writeCacheEntry(s, P, 3, P + id, { id });
    expect(keys(s)).toEqual([P + 'a', P + 'b', P + 'c']);
    // Reading 'a' marks it as used: 'b' is now the least recently used entry.
    touchCacheEntry(s, P + 'a', JSON.parse(s.getItem(P + 'a') ?? '{}') as object);
    writeCacheEntry(s, P, 3, P + 'd', { id: 'd' });
    expect(keys(s)).toEqual([P + 'a', P + 'c', P + 'd']);
    // Overwriting an existing key evicts nothing else.
    writeCacheEntry(s, P, 3, P + 'c', { id: 'c2' });
    expect(keys(s)).toEqual([P + 'a', P + 'c', P + 'd']);
    expect(JSON.parse(s.getItem(P + 'c') ?? '{}')).toMatchObject({ id: 'c2' });
    expect(s.getItem('other:x')).toBe('foreign');
  });

  it('evicts corrupt entries first', () => {
    const s = localStorage;
    writeCacheEntry(s, P, 2, P + 'a', { id: 'a' });
    s.setItem(P + 'bad', '{"t":');
    writeCacheEntry(s, P, 2, P + 'b', { id: 'b' });
    expect(keys(s)).toEqual([P + 'a', P + 'b']);
  });

  it('makes room in a full storage by dropping its own entries only', () => {
    const foreign = 'x'.repeat(900);
    const s = limitedStorage(1_000, { 'other:big': foreign });
    writeCacheEntry(s, P, 3, P + 'a', { v: 'a'.repeat(20) });
    expect(keys(s)).toEqual([P + 'a']);
    // Does not fit next to 'a' and the foreign value: 'a' is dropped, 'b' is written.
    writeCacheEntry(s, P, 3, P + 'b', { v: 'b'.repeat(40) });
    expect(keys(s)).toEqual([P + 'b']);
    expect(s.getItem('other:big')).toBe(foreign);
    // Never fits: nothing is written, nothing throws.
    expect(() => writeCacheEntry(s, P, 3, P + 'c', { v: 'c'.repeat(200) })).not.toThrow();
    expect(keys(s)).toEqual([]);
    expect(s.getItem('other:big')).toBe(foreign);
  });

  it('never throws on a failing storage', () => {
    const broken = {
      get length(): number {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    expect(() => writeCacheEntry(broken, P, 3, P + 'a', { id: 'a' })).not.toThrow();
    expect(() => touchCacheEntry(broken, P + 'a', { id: 'a' })).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(getStorage()).toBeNull();
  });
});
