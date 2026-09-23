import { useTerrainLoader } from '../hooks/useTerrain';
import { useWeatherLoader } from '../hooks/useWeather';

/** Runs the network loaders (terrain horizon, weather year) once for the whole app. Renders nothing. */
export function DataLoader() {
  useTerrainLoader();
  useWeatherLoader();
  return null;
}
