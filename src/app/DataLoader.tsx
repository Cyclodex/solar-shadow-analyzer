import { useSurfaceModelLoader } from '../hooks/useSurfaceModel';
import { useTerrainLoader } from '../hooks/useTerrain';
import { useWeatherLoader } from '../hooks/useWeather';

/**
 * Runs the network loaders (terrain horizon, weather year, laser-scan horizon) once for the whole app.
 * Renders nothing.
 */
export function DataLoader() {
  useTerrainLoader();
  useWeatherLoader();
  useSurfaceModelLoader();
  return null;
}
