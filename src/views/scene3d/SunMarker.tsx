import { useEffect, useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute, type Texture } from 'three';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import type { Format } from '../../i18n';
import { offsetAlong, type Tuple3 } from './coords';
import { Label } from './Label';
import type { ScenePalette } from './palette';
import { TOUCH_LABEL_MIN_PX, type HourMark, type SunPathSegment } from './sceneLayout';

// ─────────────────────────────────────────────
// SUN MARKER AND SUN PATH
// Sun disc + glow at `distance` (dims.sunDistance) from the scene centre along the model's sun vector, and the day's
// path at the same distance: bright where the sun is in front of the facade, faded behind it.
// ─────────────────────────────────────────────

/** Sizes relative to the sun distance (constant apparent size from the scene centre). */
const SUN_RADIUS = 0.028;
const GLOW_SIZE = 0.26;
const TICK_RADIUS = 0.0065;
/** Hour label height at distance 1 (constant on screen: ≈ 3.5 % of the view height at the 35° default fov). */
const HOUR_LABEL = 0.022;
/** Hour labels every this many hours. */
const LABEL_EVERY_H = 2;

export interface SunMarkerProps {
  palette: ScenePalette;
  glow: Texture;
  centre: Tuple3;
  /** Distance of sun and path from the centre, m. */
  distance: number;
  sunDir: Tuple3;
  /** Draw the sun disc (sun above the horizon). */
  showSun: boolean;
  showPath: boolean;
  segments: readonly SunPathSegment[];
  hours: readonly HourMark[];
  format: Format;
}

/**
 * Line pieces (pairs of unit direction vectors) along a path segment, for <lineSegments> in a group at the
 * centre scaled by the distance: independent of the scene size, so tilt or size changes keep the geometry.
 */
function pathGeometry(segment: SunPathSegment): BufferGeometry {
  const pos: number[] = [];
  for (let i = 1; i < segment.dirs.length; i++) {
    pos.push(...segment.dirs[i - 1], ...segment.dirs[i]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

export function SunMarker({
  palette,
  glow,
  centre,
  distance,
  sunDir,
  showSun,
  showPath,
  segments,
  hours,
  format,
}: SunMarkerProps) {
  const lines = useMemo(
    () => segments.map((s) => ({ front: s.front, geometry: pathGeometry(s) })),
    [segments],
  );
  useEffect(() => () => lines.forEach((l) => l.geometry.dispose()), [lines]);
  const sunPos = offsetAlong(centre, sunDir, distance);
  // Touch devices: readable on the small phone canvas (TOUCH_LABEL_MIN_PX, like the floor labels).
  const coarse = useMediaQuery('(pointer: coarse)');

  return (
    <group>
      {showPath && (
        <group position={centre} scale={distance}>
          {lines.map((l, i) => (
            <lineSegments key={i} geometry={l.geometry}>
              <lineBasicMaterial
                color={palette.color(l.front ? 'sun' : 'text-muted')}
                transparent
                opacity={l.front ? 0.95 : 0.4}
                toneMapped={false}
                fog={false}
              />
            </lineSegments>
          ))}
        </group>
      )}
      {showPath &&
        hours.map((h) => {
          const p = offsetAlong(centre, h.dir, distance);
          const labelled = (h.minutes / 60) % LABEL_EVERY_H === 0;
          return (
            <group key={h.minutes}>
              <mesh position={p} scale={TICK_RADIUS * distance}>
                <sphereGeometry args={[1, 12, 8]} />
                <meshBasicMaterial
                  color={palette.color(h.front ? 'sun' : 'text-muted')}
                  transparent
                  opacity={h.front ? 1 : 0.5}
                  toneMapped={false}
                  fog={false}
                />
              </mesh>
              {labelled && (
                <Label
                  text={format.time(h.minutes)}
                  position={[p[0], p[1] + 0.04 * distance, p[2]]}
                  height={HOUR_LABEL}
                  screenSize
                  minPx={coarse ? TOUCH_LABEL_MIN_PX : 0}
                  palette={palette}
                />
              )}
            </group>
          );
        })}
      {showSun && (
        <group position={sunPos}>
          <mesh scale={SUN_RADIUS * distance}>
            <sphereGeometry args={[1, 24, 16]} />
            <meshBasicMaterial color={palette.color('sun')} toneMapped={false} fog={false} />
          </mesh>
          <sprite scale={[GLOW_SIZE * distance, GLOW_SIZE * distance, 1]} renderOrder={-5}>
            <spriteMaterial map={glow} transparent depthWrite={false} toneMapped={false} fog={false} />
          </sprite>
        </group>
      )}
    </group>
  );
}
