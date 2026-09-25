import { useBuildingImportLoader } from '../hooks/useBuildingImport';
import { useSurfaceModelLoader } from '../hooks/useSurfaceModel';
import { useTerrainLoader } from '../hooks/useTerrain';
import { useWeatherLoader } from '../hooks/useWeather';

/**
 * Runs the network loaders (terrain horizon, weather year, laser-scan horizon) and the building import after
 * an address pick once for the whole app. Renders nothing.
 */
export function DataLoader() {
  useTerrainLoader();
  useWeatherLoader();
  useSurfaceModelLoader();
  useBuildingImportLoader();
  return null;
}
