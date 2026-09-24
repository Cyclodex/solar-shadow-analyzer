import { useEffect, useRef } from 'react';
import { clearSkyYear, fetchOpenMeteoYear } from '../model/weather';
import { useConfig } from '../state/configStore';
import { useDataStore, type WeatherData } from '../state/dataStore';

// ─────────────────────────────────────────────
// WEATHER LOADER
// config.weather.source 'open-meteo' → hourly year from the Open-Meteo archive (model/weather.ts,
// cached in localStorage); on any error the clear-sky year is used instead (usingFallback + error).
// 'clear-sky' → synthetic clear-sky year. Writes dataStore.weather. Mount once (DataLoader).
// ─────────────────────────────────────────────

/** Delay after the last location/year change before requesting Open-Meteo. */
export const WEATHER_DEBOUNCE_MS = 800;

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

/** Weather load state (status, series, error, usingFallback). */
export function useWeather(): WeatherData {
  return useDataStore((s) => s.weather);
}
