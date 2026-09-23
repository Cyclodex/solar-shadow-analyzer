import { memo, useEffect, useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { compassPoint, type Lang } from '../../i18n';
import { toRad } from '../../model/units';
import { enuToThree, type Tuple3 } from './coords';
import { Label } from './Label';
import type { ScenePalette } from './palette';

// ─────────────────────────────────────────────
// GROUND, GRID AND COMPASS (world frame, north = −Z)
// ─────────────────────────────────────────────

const GROUND_RADIUS = 1400;
const GRID_SIZE = 80;
const GRID_STEP = 2;

/** Point on the ground at azimuth `az` (degrees from north, clockwise) and distance `r`, lifted by `y`. */
function groundPoint(az: number, r: number, y = 0): Tuple3 {
  const a = toRad(az);
  const [x, , z] = enuToThree({ x: Math.sin(a) * r, y: Math.cos(a) * r, z: 0 });
  return [x, y, z];
}

/** Compass ring with ticks every 10° (longer every 30°, longest at the cardinal points). */
function compassGeometry(radius: number): BufferGeometry {
  const pos: number[] = [];
  const segs = 180;
  const y = 0.03;
  for (let i = 0; i < segs; i++) {
    pos.push(...groundPoint((i * 360) / segs, radius, y), ...groundPoint(((i + 1) * 360) / segs, radius, y));
  }
  for (let az = 0; az < 360; az += 10) {
    const len = az % 90 === 0 ? 1.6 : az % 30 === 0 ? 0.9 : 0.45;
    pos.push(...groundPoint(az, radius, y), ...groundPoint(az, radius + len, y));
  }
  // North arrow (chevron outside the ring).
  const tip = radius + 3.2;
  pos.push(...groundPoint(-4, radius + 2, y), ...groundPoint(0, tip, y));
  pos.push(...groundPoint(4, radius + 2, y), ...groundPoint(0, tip, y));
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

export interface GroundProps {
  palette: ScenePalette;
  /** Compass radius, m (encloses the building). */
  compassRadius: number;
  lang: Lang;
}

/** Static per theme/scene size: memoised so time steps do not re-render it. */
export const Ground = memo(function Ground({ palette, compassRadius, lang }: GroundProps) {
  const compass = useMemo(() => compassGeometry(compassRadius), [compassRadius]);
  useEffect(() => () => compass.dispose(), [compass]);
  const labelR = compassRadius + 5.2;

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[GROUND_RADIUS, 96]} />
        <meshStandardMaterial
          color={palette.color('ground')}
          roughness={1}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <gridHelper
        args={[GRID_SIZE, GRID_SIZE / GRID_STEP, palette.gridLine, palette.gridLine]}
        position-y={0.01}
        material-transparent
        material-opacity={0.45}
        material-depthWrite={false}
      />
      <lineSegments geometry={compass} renderOrder={1}>
        <lineBasicMaterial
          color={palette.color('text-muted')}
          transparent
          opacity={0.85}
          depthWrite={false}
        />
      </lineSegments>
      {[0, 90, 180, 270].map((az) => (
        <Label
          key={az}
          text={compassPoint(az, lang)}
          position={groundPoint(az, labelR, 0.8)}
          height={1.3}
          palette={palette}
          strong={az === 0}
        />
      ))}
    </group>
  );
});
