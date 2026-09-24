/** How often an open app looks for a new version (service worker update check). */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Looks for a new service worker every `intervalMs`, and when the app returns to the foreground after at
 * least that long (installed apps on phones stay open for days; timers of hidden pages are throttled).
 * A found update waits until the user reloads (PwaToast). Returns a cleanup function.
 */
export function scheduleUpdateChecks(
  registration: ServiceWorkerRegistration,
  intervalMs: number = UPDATE_CHECK_MS,
): () => void {
  let lastCheck = Date.now();
  const check = (): void => {
    if (registration.installing || globalThis.navigator?.onLine === false) return;
    lastCheck = Date.now();
    // Offline or a server error: the next check tries again.
    registration.update().catch(() => undefined);
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck >= intervalMs) check();
  };
  const timer = setInterval(check, intervalMs);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

/** How long "Neu laden" waits for the new version to take control before it reloads the page anyway. */
export const RELOAD_FALLBACK_MS = 3000;

/** Reloads the page (separate, so that tests can replace it). */
export function reloadPage(): void {
  window.location.reload();
}
