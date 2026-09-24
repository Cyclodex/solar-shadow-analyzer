import { useEffect, useRef } from 'react';
import type { WeatherSeries } from '../model/types';
import { clearSkyYear, fetchOpenMeteoYear } from '../model/weather';
import { useConfig } from '../state/configStore';
import { useDataStore } from '../state/dataStore';

// ─────────────────────────────────────────────
// WEATHER LOADER
// config.weather.source 'open-meteo' → hourly year from the Open-Meteo archive (model/weather.ts,
// cached in localStorage); on any error the clear-sky year is used instead (usingFallback + error).
// 'clear-sky' → synthetic clear-sky year. Writes dataStore.weather. Mount once (DataLoader).
// ─────────────────────────────────────────────

/** Delay after the last location/year change before requesting Open-Meteo. */
export const WEATHER_DEBOUNCE_MS = 800;

/** Coordinate decimals of an Open-Meteo request (≈ 1 km, model/weather.ts openMeteoUrl). */
const WEATHER_COORD_DECIMALS = 2;

const roundCoord = (x: number): number => Number(x.toFixed(WEATHER_COORD_DECIMALS));

/**
 * True if `series` is the weather of this site and year: coordinates compared at the request precision
 * (Open-Meteo series store rounded coordinates, clear-sky series the exact ones). The source is not
 * compared: the clear-sky fallback after an Open-Meteo error belongs to the site as well.
 */
export function weatherMatches(
  series: WeatherSeries,
  latitude: number,
  longitude: number,
  year: number,
): boolean {
  return (
    series.year === year &&
    roundCoord(series.latitude) === roundCoord(latitude) &&
    roundCoord(series.longitude) === roundCoord(longitude)
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
