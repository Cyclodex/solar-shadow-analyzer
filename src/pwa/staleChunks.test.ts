import { afterEach, describe, expect, it, vi } from 'vitest';
import { STALE_CHUNK_RELOAD_GUARD_MS, STALE_CHUNK_RELOAD_KEY, initStaleChunkReload } from './staleChunks';

/** The event Vite fires when a lazily loaded chunk fails (cancelable, the error in `payload`). */
function preloadError(): Event {
  return Object.assign(new Event('vite:preloadError', { cancelable: true }), {
    payload: new TypeError('Failed to fetch dynamically imported module: /assets/Scene3D-old.js'),
  });
}

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('initStaleChunkReload', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.restoreAllMocks();
  });

  it('reloads once for a failed chunk and not again within the guard time', () => {
    const reload = vi.fn();
    const storage = memoryStorage();
    let time = 1_000_000;
    stop = initStaleChunkReload(window, { storage, reload, now: () => time });

    const first = preloadError();
    window.dispatchEvent(first);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(STALE_CHUNK_RELOAD_KEY)).toBe('1000000');
    // The error still reaches the error boundary around the view.
    expect(first.defaultPrevented).toBe(false);

    // After the reload the same tab fails again: the reload did not help.
    time += STALE_CHUNK_RELOAD_GUARD_MS - 1;
    window.dispatchEvent(preloadError());
    expect(reload).toHaveBeenCalledTimes(1);

    // A later deploy may leave another chunk stale.
    time += 1;
    window.dispatchEvent(preloadError());
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload while offline or without a usable sessionStorage', () => {
    const reload = vi.fn();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    stop = initStaleChunkReload(window, { storage: memoryStorage(), reload });
    window.dispatchEvent(preloadError());
    stop();
    vi.restoreAllMocks();

    // No guard against a reload loop.
    stop = initStaleChunkReload(window, { storage: null, reload });
    window.dispatchEvent(preloadError());
    stop();
    const denied = (): never => {
      throw new DOMException('denied', 'SecurityError');
    };
    stop = initStaleChunkReload(window, { storage: { getItem: denied, setItem: denied }, reload });
    window.dispatchEvent(preloadError());
    expect(reload).not.toHaveBeenCalled();
  });

  it('stops listening after cleanup', () => {
    const reload = vi.fn();
    initStaleChunkReload(window, { storage: memoryStorage(), reload })();
    window.dispatchEvent(preloadError());
    expect(reload).not.toHaveBeenCalled();
  });
});
