import { reloadPage } from './updates';

// ─────────────────────────────────────────────
// STALE CHUNKS AFTER A DEPLOY
// The 3D view is a lazily loaded chunk with a content hash in its file name. A page that loaded an older
// version before a deploy asks for a chunk the server no longer has, unless a service worker serves it
// from its precache (blocked or missing workers, e.g. private windows or storage cleared by the browser).
// Vite then fires the cancelable window event `vite:preloadError`: the page reloads once to pick up the
// current version. The failed import still reaches the error boundary around the view, which shows a
// notice until the reload, or instead of it (offline, or a reload that did not help).
// ─────────────────────────────────────────────

/** sessionStorage key: time of the last reload for a failed chunk (per tab). */
export const STALE_CHUNK_RELOAD_KEY = 'ssa.chunkReload';

/** No second automatic reload within this time: the first one did not help. */
export const STALE_CHUNK_RELOAD_GUARD_MS = 60_000;

interface StaleChunkOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload?: () => void;
  now?: () => number;
}

function sessionStore(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reloads the page once when a lazily loaded chunk fails to load (`vite:preloadError`). Not while
 * offline (the reload would end on the browser's error page), not again within
 * STALE_CHUNK_RELOAD_GUARD_MS, and not without sessionStorage (no guard against a loop). Returns a
 * cleanup function (tests).
 */
export function initStaleChunkReload(target: Window = window, options: StaleChunkOptions = {}): () => void {
  const { storage = sessionStore(), reload = reloadPage, now = Date.now } = options;
  const onPreloadError = (): void => {
    if (!storage || globalThis.navigator?.onLine === false) return;
    try {
      const last = Number(storage.getItem(STALE_CHUNK_RELOAD_KEY));
      if (Number.isFinite(last) && now() - last < STALE_CHUNK_RELOAD_GUARD_MS) return;
      storage.setItem(STALE_CHUNK_RELOAD_KEY, String(now()));
    } catch {
      return;
    }
    reload();
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => target.removeEventListener('vite:preloadError', onPreloadError);
}
