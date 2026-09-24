// ─────────────────────────────────────────────
// LOAD ERROR CAUSE
// The loaders store the technical (English) message of a failed weather/terrain load (dataStore `error`).
// The sidebar shows a translated cause instead and keeps the raw message for a "details" disclosure.
// ─────────────────────────────────────────────

export type LoadErrorCause =
  /** The request did not reach the server (offline, blocked, DNS …). */
  | { kind: 'network' }
  /** The server answered with an HTTP error status. */
  | { kind: 'http'; status: number }
  /** The response was malformed, incomplete or in an unexpected format. */
  | { kind: 'data' }
  /** The elevation model has no height at the site. */
  | { kind: 'no-elevation' };

/**
 * Browser wording of a failed fetch (a TypeError): Chromium "Failed to fetch", Firefox "NetworkError when
 * attempting to fetch resource.", Safari "Load failed" / "The network connection was lost.", Node "fetch failed".
 */
const NETWORK = /failed to fetch|fetch failed|networkerror|load failed|network|offline/i;

/**
 * Cause of a load error message from hooks/useWeather.ts or hooks/useTerrain.ts (messages of
 * model/weather.ts, model/terrain.ts or the browser's fetch); null when the message is not recognised.
 */
export function classifyLoadError(message: string): LoadErrorCause | null {
  if (/no elevation data/i.test(message)) return { kind: 'no-elevation' };
  const http = /\bHTTP (\d{3})\b/.exec(message);
  if (http) {
    const status = Number(http[1]);
    // "HTTP 200": the body of a successful response could not be read.
    return status >= 400 ? { kind: 'http', status } : { kind: 'data' };
  }
  if (/^Open-Meteo:|Terrarium tile format/.test(message)) return { kind: 'data' };
  if (NETWORK.test(message)) return { kind: 'network' };
  return null;
}
