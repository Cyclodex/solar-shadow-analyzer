import type * as Geocode from './geocode';
import type { GeoResult } from './geocode';

// ─────────────────────────────────────────────
// ADDRESS SEARCH, LOADED ON FIRST USE (docs/ARCHITECTURE.md "Laden und Rechenlast")
// geocode.ts (swisstopo search, building register, height service, nearest address; with fetchRetry.ts about
// 12 kB) is not needed to open the app: the first search, an address pick or «Nächste Adresse übernehmen»
// loads it, in parallel with the 300 ms debounce of the search. A module that cannot load (offline right
// after a new deployment) comes back as a network error, like a failed request.
// ─────────────────────────────────────────────

let loading: Promise<typeof Geocode> | null = null;

/** The geocode module (loaded once; a failed load is tried again next time). */
export function loadGeocode(): Promise<typeof Geocode> {
  loading ??= import('./geocode').catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Runs `call` with the geocode module; never rejects (a failed module load is a 'network' error). */
export async function withGeocode<T>(
  call: (m: typeof Geocode) => Promise<GeoResult<T>>,
): Promise<GeoResult<T>> {
  let m: typeof Geocode;
  try {
    m = await loadGeocode();
  } catch (e) {
    return { ok: false, error: { kind: 'network', message: e instanceof Error ? e.message : String(e) } };
  }
  return call(m);
}
