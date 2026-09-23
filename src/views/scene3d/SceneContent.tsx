import { useEffect, useMemo, type RefObject } from 'react';
import type { Format, Lang } from '../../i18n';
import type { HorizonProfile, InstantState, Obstacle } from '../../model/types';
import { Building } from './Building';
import { CameraRig, type ActivePreset, type CameraApi } from './CameraRig';
import { facadeRotationY, type Tuple3 } from './coords';
import { Ground } from './Ground';
import type { ScenePalette } from './palette';
import { PanelRows } from './PanelRows';
import {
  SHADOW_FIT_OBSTACLE_DISTANCE,
  boxCorners,
  obstacleBox,
  skyState,
  type HourMark,
  type SceneDims,
  type SunPathSegment,
} from './sceneLayout';
import { SkyAndLights } from './SkyAndLights';
import { SunMarker } from './SunMarker';
import { HorizonRing, Obstacles } from './Surroundings';
import { createGlowTexture } from './textures';

// ─────────────────────────────────────────────
// SCENE GRAPH (inside <Canvas>). Props only — the DOM component reads the stores and the model hooks.
// ─────────────────────────────────────────────

export interface SceneContentProps {
  palette: ScenePalette;
  dims: SceneDims;
  instant: InstantState;
  sunDir: Tuple3;
  /** Sun hidden by the far horizon (terrain / manual points). */
  sunBlocked: boolean;
  segments: readonly SunPathSegment[];
  hours: readonly HourMark[];
  farHorizon: HorizonProfile | null;
  observerHeight: number;
  obstacles: readonly Obstacle[];
  labels: readonly string[];
  lang: Lang;
  format: Format;
  showModelShade: boolean;
  castShadows: boolean;
  showSunPath: boolean;
  preset: ActivePreset;
  onUserMove: () => void;
  apiRef: RefObject<CameraApi | null>;
}

export function SceneContent({
  palette,
  dims,
  instant,
  sunDir,
  sunBlocked,
  segments,
  hours,
  farHorizon,
  observerHeight,
  obstacles,
  labels,
  lang,
  format,
  showModelShade,
  castShadows,
  showSunPath,
  preset,
  onUserMove,
  apiRef,
}: SceneContentProps) {
  const { facadeAzimuth } = dims;
  const altitude = instant.sun.altitude;
  const sky = skyState(altitude);

  // Shadow camera: fitted to the building (+ panels) and nearby obstacles; all obstacles set the light distance.
  const { fitPoints, depthPoints } = useMemo(() => {
    const highTop = dims.buildingHeight - dims.focus.max.z < 12;
    const building = {
      min: { u: -dims.buildingWidth / 2, n: -dims.buildingDepth, z: dims.focus.min.z },
      max: {
        u: dims.buildingWidth / 2,
        n: dims.focus.max.n,
        z: highTop ? dims.buildingHeight : dims.focus.max.z + 3,
      },
    };
    const fit = boxCorners(building, facadeAzimuth);
    const depth: Tuple3[] = [];
    for (const o of obstacles) {
      const corners = boxCorners(obstacleBox(o), facadeAzimuth);
      depth.push(...corners);
      if (o.distance <= SHADOW_FIT_OBSTACLE_DISTANCE) fit.push(...corners);
    }
    return { fitPoints: fit, depthPoints: depth };
  }, [dims, obstacles, facadeAzimuth]);

  const glow = useMemo(() => createGlowTexture(palette), [palette]);
  useEffect(() => () => glow.dispose(), [glow]);

  const compassRadius = Math.hypot(dims.buildingWidth / 2, dims.buildingDepth) + 4;
  const sunVisible = altitude > 0 && preset !== 'sun';

  return (
    <>
      <SkyAndLights
        palette={palette}
        altitude={altitude}
        sunDir={sunDir}
        sunBlocked={sunBlocked}
        castShadows={castShadows}
        target={dims.target}
        fitPoints={fitPoints}
        depthPoints={depthPoints}
      />
      <Ground palette={palette} compassRadius={compassRadius} lang={lang} />
      {farHorizon && <HorizonRing profile={farHorizon} observerHeight={observerHeight} palette={palette} />}
      <group rotation-y={facadeRotationY(facadeAzimuth)}>
        <Building palette={palette} dims={dims} day={sky.day} />
        <PanelRows
          palette={palette}
          dims={dims}
          floors={instant.floors}
          showModelShade={showModelShade}
          labels={labels}
        />
        <Obstacles obstacles={obstacles} palette={palette} />
      </group>
      <SunMarker
        palette={palette}
        glow={glow}
        centre={dims.target}
        distance={dims.sunDistance}
        sunDir={sunDir}
        showSun={sunVisible}
        showPath={showSunPath && preset !== 'sun'}
        segments={segments}
        hours={hours}
        format={format}
      />
      <CameraRig dims={dims} sun={instant.sun} preset={preset} onUserMove={onUserMove} apiRef={apiRef} />
    </>
  );
}
