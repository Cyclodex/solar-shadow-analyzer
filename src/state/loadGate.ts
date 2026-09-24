import { useDataStore } from './dataStore';

// ─────────────────────────────────────────────
// TERRAIN DOWNLOAD GATE
// The terrain horizon needs ~2 MB of DEM tiles (6 parallel requests). On a slow mobile link they would
// delay the requests the first results depend on: the weather year (annual yield) and the lazily loaded
// 3D view. So a terrain download (not a cached result) starts only once the weather request has settled
// and the downloads registered with holdTerrainDownload() are done — at most TERRAIN_GATE_MAX_MS later.
// ─────────────────────────────────────────────

/** Longest wait of a terrain download for the more urgent downloads, ms. */
export const TERRAIN_GATE_MAX_MS = 5000;

const held = new Set<Promise<unknown>>();

/**
 * Lets a terrain download that starts before `download` has settled wait for it (e.g. the lazily imported
 * 3D view chunk: `lazy(() => holdTerrainDownload(import('./SceneView')))`). Returns `download`.
 */
export function holdTerrainDownload<T>(download: Promise<T>): Promise<T> {
  held.add(download);
  const release = (): void => {
    held.delete(download);
  };
  download.then(release, release);
  return download;
}

const weatherLoading = (): boolean => useDataStore.getState().weather.status === 'loading';

/**
 * Resolves when a terrain download may start: no weather request is running (ready, error or none) and
 * every held download (holdTerrainDownload) has settled — or after TERRAIN_GATE_MAX_MS. Rejects with the
 * signal's reason when it aborts first.
 */
export function terrainDownloadGate(signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe = (): void => {};
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    };
    const afterWeather = (): void => {
      unsubscribe();
      void Promise.allSettled([...held]).then(finish);
    };
    const timer = setTimeout(finish, TERRAIN_GATE_MAX_MS);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (!weatherLoading()) {
      afterWeather();
      return;
    }
    unsubscribe = useDataStore.subscribe(() => {
      if (!weatherLoading()) afterWeather();
    });
  });
}
