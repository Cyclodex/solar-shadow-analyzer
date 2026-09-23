import type { Config } from '../model/types';
import { DEFAULT_CONFIG } from '../model/defaults';
import { buildShareUrl, encodeConfig, readConfigFromHash } from '../model/share';
import { useConfigStore } from './configStore';

// ─────────────────────────────────────────────
// URL ⇄ CONFIG
// Start-up: a '#c=…' share hash overrides the persisted config. Afterwards every config change
// rewrites the hash (history.replaceState, debounced) so the address bar is always a share link;
// the default config clears the hash. A pasted link in the same tab (hashchange) is applied too.
// ─────────────────────────────────────────────

export const HASH_DEBOUNCE_MS = 400;

const DEFAULT_ENCODED = encodeConfig(DEFAULT_CONFIG);

/** Applies the config of a '#c=…' hash to the store. Returns true if the hash held a valid config. */
export function applyHashConfig(hash: string = globalThis.location?.hash ?? ''): boolean {
  const config = readConfigFromHash(hash);
  if (!config) return false;
  useConfigStore.getState().replace(config);
  return true;
}

/** Absolute share link for `config` (default: the current config), based on the current page URL. */
export function shareUrl(config: Config = useConfigStore.getState().config): string {
  return buildShareUrl(globalThis.location?.href ?? '', config);
}

/** Page URL that represents `config`: without hash for the default config, else the share link. */
function urlFor(config: Config): string {
  const { location } = globalThis;
  if (encodeConfig(config) === DEFAULT_ENCODED) return `${location.pathname}${location.search}`;
  return buildShareUrl(location.href, config);
}

function writeUrl(config: Config): void {
  try {
    const url = urlFor(config);
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (url !== location.href && url !== current) history.replaceState(history.state, '', url);
  } catch {
    // e.g. sandboxed iframes may forbid history access: the share button still works
  }
}

export interface UrlSyncOptions {
  /** Delay between the last config change and the hash update. Default HASH_DEBOUNCE_MS. */
  debounceMs?: number;
}

/**
 * Call once at start-up (before the first render): applies a '#c=' hash, then keeps the hash in sync.
 * Returns a cleanup function (tests, HMR).
 */
export function initUrlSync(opts: UrlSyncOptions = {}): () => void {
  const debounceMs = opts.debounceMs ?? HASH_DEBOUNCE_MS;
  applyHashConfig();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = useConfigStore.subscribe((state, prev) => {
    if (state.config === prev.config) return;
    clearTimeout(timer);
    timer = setTimeout(() => writeUrl(useConfigStore.getState().config), debounceMs);
  });

  const onHashChange = (): void => {
    applyHashConfig();
  };
  globalThis.addEventListener?.('hashchange', onHashChange);

  return () => {
    clearTimeout(timer);
    unsubscribe();
    globalThis.removeEventListener?.('hashchange', onHashChange);
  };
}
