import { useEffect, useRef } from 'react';
import { clearSkyYear, fetchOpenMeteoYear, sameWeatherSite } from '../model/weather';
import { useConfig, useConfigSection } from '../state/configStore';
import { useDataStore } from '../state/dataStore';

// ─────────────────────────────────────────────
// WEATHER LOADER
// config.weather.source 'open-meteo' → hourly year from the Open-Meteo archive (model/weather.ts,
// cached in localStorage); on any error the clear-sky year is used instead (usingFallback + error).
// 'clear-sky' → synthetic clear-sky year. Writes dataStore.weather. Mount once (DataLoader).
// ─────────────────────────────────────────────

/** Delay after the last location/year change before requesting Open-Meteo. */
export const WEATHER_DEBOUNCE_MS = 800;

/**
 * True while the weather of the configured site and year is not in the store yet: a series is loading
 * (the previous one, possibly of another site or year, is kept meanwhile) or the stored series still
 * belongs to another site or year (right after a location or year change). Yield results must not be
 * presented as final (or exported) meanwhile; see also useResultsReady (hooks/useModel.ts).
 */
export function useWeatherBusy(): boolean {
  const { year } = useConfigSection('weather');
  const { latitude, longitude } = useConfigSection('location');
  return useDataStore(
    ({ weather: { status, series } }) =>
      status === 'loading' || (series !== null && !sameWeatherSite(series, latitude, longitude, year)),
  );
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Loads the weather series into dataStore. Call exactly once (in <DataLoader/>). */
export function useWeatherLoader(): void {
  const config = useConfig();
  const { source, year } = config.weather;
  const { latitude, longitude } = config.location;
  const attempt = useDataStore((s) => s.weatherAttempt);
  /** Request of the previous run: only a *changed* request is debounced (first load is immediate). */
  const lastRequest = useRef<string | null>(null);

  useEffect(() => {
    const { setWeather } = useDataStore.getState();
    if (source === 'clear-sky') {
      lastRequest.current = null;
      setWeather({
        status: 'ready',
        series: clearSkyYear(latitude, longitude, year),
        error: null,
        usingFallback: false,
      });
      return;
    }
    const request = `${latitude},${longitude},${year}`;
    const delay = lastRequest.current === null || lastRequest.current === request ? 0 : WEATHER_DEBOUNCE_MS;
    lastRequest.current = request;
    const ctrl = new AbortController();
    // Keep the previous series while loading (stale-while-revalidate); the UI shows the loading state.
    setWeather({ status: 'loading', error: null });
    const timer = setTimeout(() => {
      fetchOpenMeteoYear(latitude, longitude, year, { signal: ctrl.signal }).then(
        (series) => {
          if (ctrl.signal.aborted) return;
          setWeather({ status: 'ready', series, error: null, usingFallback: false });
        },
        (e: unknown) => {
          if (ctrl.signal.aborted) return;
          setWeather({
            status: 'error',
            series: clearSkyYear(latitude, longitude, year),
            error: errorMessage(e),
            usingFallback: true,
          });
        },
      );
    }, delay);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [source, year, latitude, longitude, attempt]);
}
