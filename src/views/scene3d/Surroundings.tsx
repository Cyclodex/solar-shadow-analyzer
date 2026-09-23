import { memo, useEffect, useMemo } from 'react';
import { BoxGeometry, BufferGeometry, DoubleSide, EdgesGeometry, Float32BufferAttribute } from 'three';
import { horizonAt } from '../../model/horizon';
import type { HorizonProfile, Obstacle } from '../../model/types';
import { toRad } from '../../model/units';
import { enuToThree, facadeLocal } from './coords';
import { Label } from './Label';
import type { ScenePalette } from './palette';
import { HORIZON_RING_RADIUS, obstacleBox } from './sceneLayout';

// ─────────────────────────────────────────────
// SURROUNDINGS: neighbour obstacles (facade frame) and the far horizon as a silhouette ring (world frame)
// ─────────────────────────────────────────────

function ObstacleBox({ obstacle, palette }: { obstacle: Obstacle; palette: ScenePalette }) {
  const { min, max } = obstacleBox(obstacle);
  const sx = max.u - min.u;
  const sy = max.z - min.z;
  const sz = max.n - min.n;
  const geometry = useMemo(() => new BoxGeometry(sx, sy, sz), [sx, sy, sz]);
  const edges = useMemo(() => new EdgesGeometry(geometry), [geometry]);
  useEffect(
    () => () => {
      geometry.dispose();
      edges.dispose();
    },
    [geometry, edges],
  );
  const centre = facadeLocal({ u: (min.u + max.u) / 2, n: (min.n + max.n) / 2, z: (min.z + max.z) / 2 });
  return (
    <group>
      <mesh geometry={geometry} position={centre} castShadow receiveShadow>
        <meshStandardMaterial color={palette.obstacle} roughness={0.95} metalness={0} />
      </mesh>
      <lineSegments geometry={edges} position={centre}>
        <lineBasicMaterial color={palette.color('wall-edge')} />
      </lineSegments>
      {obstacle.name && (
        <Label
          text={obstacle.name}
          position={facadeLocal({ u: centre[0], n: centre[2], z: max.z + 1.2 })}
          height={Math.min(2.5, Math.max(0.8, sy * 0.08))}
          palette={palette}
        />
      )}
    </group>
  );
}

/** Neighbour buildings as boxes (children of the facade group). */
export const Obstacles = memo(function Obstacles({
  obstacles,
  palette,
}: {
  obstacles: readonly Obstacle[];
  palette: ScenePalette;
}) {
  return (
    <group>
      {obstacles.map((o) => (
        <ObstacleBox key={o.id} obstacle={o} palette={palette} />
      ))}
    </group>
  );
});

/**
 * Silhouette ring at HORIZON_RING_RADIUS: the top edge lies at observerHeight + R·tan(elevation), so from
 * the observer height the silhouette covers exactly the horizon elevation of each azimuth.
 */
function ringGeometries(
  profile: HorizonProfile,
  observerHeight: number,
): { band: BufferGeometry; edge: BufferGeometry } {
  const n = Math.max(72, profile.elevations.length);
  const pos: number[] = [];
  const top: number[] = [];
  const index: number[] = [];
  const R = HORIZON_RING_RADIUS;
  for (let i = 0; i <= n; i++) {
    const az = (i * 360) / n;
    const e = Math.min(80, horizonAt(profile, az));
    const y = Math.max(0, observerHeight + R * Math.tan(toRad(e)));
    const a = toRad(az);
    const [x, , z] = enuToThree({ x: Math.sin(a) * R, y: Math.cos(a) * R, z: 0 });
    pos.push(x, -0.5, z, x, y, z);
    if (i < n) top.push(x, y, z);
    if (i < n) {
      const b = 2 * i;
      index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const band = new BufferGeometry();
  band.setAttribute('position', new Float32BufferAttribute(pos, 3));
  band.setIndex(index);
  const edge = new BufferGeometry();
  edge.setAttribute('position', new Float32BufferAttribute(top, 3));
  return { band, edge };
}

export interface HorizonRingProps {
  profile: HorizonProfile;
  observerHeight: number;
  palette: ScenePalette;
}

export const HorizonRing = memo(function HorizonRing({ profile, observerHeight, palette }: HorizonRingProps) {
  const ring = useMemo(() => ringGeometries(profile, observerHeight), [profile, observerHeight]);
  useEffect(
    () => () => {
      ring.band.dispose();
      ring.edge.dispose();
    },
    [ring],
  );
  return (
    <group>
      <mesh geometry={ring.band} renderOrder={-2}>
        <meshBasicMaterial
          color={palette.horizonFill}
          transparent
          opacity={0.8}
          side={DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <lineLoop geometry={ring.edge}>
        <lineBasicMaterial color={palette.color('text-muted')} toneMapped={false} />
      </lineLoop>
    </group>
  );
});
