import { useDataStore } from './dataStore';

// ─────────────────────────────────────────────
// TERRAIN DOWNLOAD GATE
// The terrain horizon needs ~2 MB of DEM tiles (6 parallel requests). On a slow mobile link they would
// delay the requests the first results depend on: the weather year (annual yield) and the lazily loaded
// 3D view. So a terrain download (not a cached result) starts only once the weather request has settled
// and every download held with holdTerrainDownload() is done — at most TERRAIN_GATE_MAX_MS later.
// ─────────────────────────────────────────────

/** Longest wait of a terrain download for the more urgent downloads, ms. */
export const TERRAIN_GATE_MAX_MS = 5000;

/** Pending holds: each resolves when released. */
const held = new Set<Promise<void>>();

/**
 * Holds terrain downloads back until release() is called (idempotent), or until `until` settles, e.g. for
 * the lazily loaded 3D view: register when it is known that its chunk will be requested, release when the
 * import has settled or is not needed after all. A terrain download waits at most TERRAIN_GATE_MAX_MS.
 */
export function holdTerrainDownload(until?: Promise<unknown>): () => void {
  let release = (): void => {};
  const hold = new Promise<void>((resolve) => {
    release = () => {
      held.delete(hold);
      resolve();
    };
  });
  held.add(hold);
  until?.then(release, release);
  return release;
}

const weatherLoading = (): boolean => useDataStore.getState().weather.status === 'loading';

/**
 * Resolves when a terrain download may start: no weather request is running (ready, error or none) and
 * no download is held (holdTerrainDownload) — or after TERRAIN_GATE_MAX_MS. Rejects with the signal's
 * reason when it aborts first.
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
      void Promise.all([...held]).then(finish);
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
