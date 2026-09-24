import { useCallback, useSyncExternalStore } from 'react';

function mediaQueryList(query: string): MediaQueryList | null {
  try {
    return globalThis.matchMedia?.(query) ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether the CSS media query matches, updated on change. Read synchronously on the first render (no
 * layout flash at start-up); false where matchMedia is unavailable.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = mediaQueryList(query);
      mql?.addEventListener?.('change', onChange);
      return () => mql?.removeEventListener?.('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => mediaQueryList(query)?.matches ?? false,
    () => false,
  );
}
