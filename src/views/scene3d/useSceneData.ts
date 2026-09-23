import { useMemo } from 'react';
import { floorLabel, useLang } from '../../i18n';
import {
  useFloorPlacements,
  useInstant,
  useLayout,
  useSolarPath,
  useTerrainProfile,
} from '../../hooks/useModel';
import { terrainObserverHeight } from '../../hooks/useTerrain';
import { horizonAt, horizonFromPoints, maxHorizon } from '../../model/horizon';
import type { HorizonProfile, InstantState, Obstacle } from '../../model/types';
import { useConfig } from '../../state/configStore';
import { useTimeStore } from '../../state/timeStore';
import type { Tuple3 } from './coords';
import {
  hourMarks,
  sceneDims,
  sunDirection,
  sunPathSegments,
  type HourMark,
  type SceneDims,
  type SunPathSegment,
} from './sceneLayout';

export interface SceneData {
  dims: SceneDims;
  instant: InstantState;
  date: string;
  sunDir: Tuple3;
  /** Sun above the astronomical horizon but hidden by the far horizon (terrain / manual points). */
  sunBlocked: boolean;
  segments: readonly SunPathSegment[];
  hours: readonly HourMark[];
  /** Terrain (if enabled and loaded) ∪ manual horizon points; null if neither exists. */
  farHorizon: HorizonProfile | null;
  observerHeight: number;
  obstacles: readonly Obstacle[];
  /** Storey label per floor index. */
  labels: readonly string[];
}

/**
 * Everything the 3D scene shows, from the model hooks. Geometry is memoised on config sections, so a
 * time step only recomputes the instant, the sun direction and the far-horizon test.
 */
export function useSceneData(): SceneData {
  const config = useConfig();
  const { building, horizon } = config;
  const lang = useLang();
  const layout = useLayout();
  const placements = useFloorPlacements();
  const instant = useInstant();
  const path = useSolarPath();
  const terrain = useTerrainProfile();
  const date = useTimeStore((s) => s.date);
  const azimuth = building.facadeAzimuth;

  const dims = useMemo(() => {
    const first = placements[0];
    const railHeight = first ? first.railTopZ - first.slabZ : 0;
    return sceneDims(layout, placements, azimuth, railHeight);
  }, [layout, placements, azimuth]);
  const segments = useMemo(() => sunPathSegments(path, azimuth), [path, azimuth]);
  const hours = useMemo(() => hourMarks(path, azimuth), [path, azimuth]);
  const manual = horizon.manual;
  const farHorizon = useMemo(() => {
    const parts: HorizonProfile[] = [];
    if (terrain) parts.push(terrain);
    if (manual.length > 0) parts.push(horizonFromPoints(manual, 1));
    return parts.length > 0 ? maxHorizon(parts, 1) : null;
  }, [terrain, manual]);
  const labels = useMemo(() => placements.map((p) => floorLabel(p.storey, lang)), [placements, lang]);
  const { sun } = instant;
  const sunDir = useMemo(() => sunDirection(sun), [sun]);
  const sunBlocked =
    farHorizon !== null && sun.altitude > 0 && sun.altitude < horizonAt(farHorizon, sun.azimuth);

  return {
    dims,
    instant,
    date,
    sunDir,
    sunBlocked,
    segments,
    hours,
    farHorizon,
    observerHeight: terrainObserverHeight(config),
    obstacles: horizon.obstacles,
    labels,
  };
}
