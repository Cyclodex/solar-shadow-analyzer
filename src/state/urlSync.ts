import type { Config } from '../model/types';
import { DEFAULT_CONFIG } from '../model/defaults';
import { buildShareUrl, encodeConfig, readConfigFromHash } from '../model/share';
import { useConfigStore } from './configStore';
import { useShareLinkStore } from './shareLinkStore';

// ─────────────────────────────────────────────
// URL ⇄ CONFIG
// Start-up: a '#c=…' share hash overrides the persisted config (the replaced own config can be
// restored, see shareLinkStore); an undecodable '#c=' is reported instead of being ignored silently.
// Then the address bar is normalised and kept a share link: every config change rewrites the hash
// (history.replaceState, throttled: the first change at once, then at most every HASH_THROTTLE_MS
// with a trailing write of the final value); the default config clears the hash. A pasted link in the
// same tab (hashchange) is applied too, any other fragment (e.g. Back to an entry without hash) is
// replaced by the current config's hash. A write still pending when the page is left (reload within
// the throttle window) is handed to the next load through sessionStorage, so the stale hash of the
// reloaded URL does not override the newer config.
// ─────────────────────────────────────────────

export const HASH_THROTTLE_MS = 400;

/** sessionStorage key of the hash handoff on pagehide (see initUrlSync). */
export const PENDING_HASH_KEY = 'ssa.pendingHash';

const DEFAULT_ENCODED = encodeConfig(DEFAULT_CONFIG);

/** What a location hash holds: no share config, an undecodable one, or a valid config. */
export type HashConfig = { status: 'absent' } | { status: 'invalid' } | { status: 'ok'; config: Config };

/** Reads the '#c=' part of a hash ('&'-separated parts; the first 'c=' part counts). */
export function readHashConfig(hash: string): HashConfig {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const part = body.split('&').find((p) => p.startsWith('c='));
  if (part === undefined) return { status: 'absent' };
  const config = readConfigFromHash(`#${part}`);
  return config ? { status: 'ok', config } : { status: 'invalid' };
}

/**
 * Applies the config of a '#c=…' hash to the store and records the link notices (shareLinkStore).
 * Returns true if the hash held a valid config.
 */
export function applyHashConfig(hash: string = globalThis.location?.hash ?? ''): boolean {
  const read = readHashConfig(hash);
  const links = useShareLinkStore.getState();
  if (read.status === 'absent') return false;
  const store = useConfigStore.getState();
  const previous = store.config;
  const previousEncoded = encodeConfig(previous);
  if (read.status === 'invalid') {
    links.linkInvalid(previousEncoded === DEFAULT_ENCODED ? 'default' : 'saved');
    return false;
  }
  store.replace(read.config);
  const next = useConfigStore.getState().config;
  // Nothing to offer back for a first visit (default config) or a link to the config already shown
  // (reload of the own tab, Back/Forward between own entries).
  const replacedOwn = previousEncoded !== DEFAULT_ENCODED && previousEncoded !== encodeConfig(next);
  links.linkApplied(replacedOwn ? previous : null);
  return true;
}

/** Absolute share link for `config` (default: the current config), based on the current page URL. */
export function shareUrl(config: Config = useConfigStore.getState().config): string {
  return buildShareUrl(globalThis.location?.href ?? '', config);
}

/** Hash that represents `config`: '' for the default config, else '#c=…'. */
function hashFor(config: Config): string {
  const encoded = encodeConfig(config);
  return encoded === DEFAULT_ENCODED ? '' : `#c=${encoded}`;
}

function writeUrl(config: Config): void {
  try {
    const { pathname, search, hash } = location;
    const next = hashFor(config);
    if (hash !== next) history.replaceState(history.state, '', `${pathname}${search}${next}`);
  } catch {
    // e.g. sandboxed iframes may forbid history access: the share button still works
  }
}

function sessionStorageOrNull(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Takes the hash handed over by the previous page of this tab (pagehide during a pending write): if the
 * URL still carries the stale hash of that page, it is replaced by the newer one before it is applied.
 */
function takePendingHash(): void {
  const storage = sessionStorageOrNull();
  let raw: string | null;
  try {
    raw = storage?.getItem(PENDING_HASH_KEY) ?? null;
    storage?.removeItem(PENDING_HASH_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const pending = JSON.parse(raw) as { stale?: unknown; fresh?: unknown };
    if (typeof pending.stale !== 'string' || typeof pending.fresh !== 'string') return;
    if (pending.stale !== location.hash) return; // a different link was opened: it wins
    history.replaceState(history.state, '', `${location.pathname}${location.search}${pending.fresh}`);
  } catch {
    // corrupt entry or no history access: keep the URL as it is
  }
}

export interface UrlSyncOptions {
  /** Minimum time between two hash updates. Default HASH_THROTTLE_MS. */
  throttleMs?: number;
}

/**
 * Call once at start-up (before the first render): applies a '#c=' hash, then keeps the hash in sync.
 * Returns a cleanup function (tests, HMR).
 */
export function initUrlSync(opts: UrlSyncOptions = {}): () => void {
  const throttleMs = opts.throttleMs ?? HASH_THROTTLE_MS;
  const current = (): Config => useConfigStore.getState().config;
  takePendingHash();
  applyHashConfig();
  // The address bar is a share link from the start: an invalid hash is replaced, a stored non-default
  // config without hash gets its hash.
  writeUrl(current());

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastWrite = -Infinity;
  const flush = (): void => {
    timer = undefined;
    lastWrite = Date.now();
    writeUrl(current());
  };
  const unsubscribe = useConfigStore.subscribe((state, prev) => {
    if (state.config === prev.config || timer !== undefined) return;
    const wait = lastWrite + throttleMs - Date.now();
    if (wait <= 0) flush();
    else timer = setTimeout(flush, wait);
  });

  const onHashChange = (): void => {
    applyHashConfig();
    writeUrl(current());
  };
  // A reload keeps the URL it had when it started, before pagehide runs: hand the newer hash over.
  const onPageHide = (): void => {
    if (timer === undefined) return;
    try {
      sessionStorageOrNull()?.setItem(
        PENDING_HASH_KEY,
        JSON.stringify({ stale: location.hash, fresh: hashFor(current()) }),
      );
    } catch {
      // storage unavailable: the reload may show the previous hash's config
    }
    clearTimeout(timer);
    flush();
  };
  const onPageShow = (e: PageTransitionEvent): void => {
    // Restored from the back/forward cache: this page kept running, the handoff is not needed.
    if (!e.persisted) return;
    try {
      sessionStorageOrNull()?.removeItem(PENDING_HASH_KEY);
    } catch {
      // ignore
    }
  };
  globalThis.addEventListener?.('hashchange', onHashChange);
  globalThis.addEventListener?.('pagehide', onPageHide);
  globalThis.addEventListener?.('pageshow', onPageShow);

  return () => {
    clearTimeout(timer);
    unsubscribe();
    globalThis.removeEventListener?.('hashchange', onHashChange);
    globalThis.removeEventListener?.('pagehide', onPageHide);
    globalThis.removeEventListener?.('pageshow', onPageShow);
  };
}
