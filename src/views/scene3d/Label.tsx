import { useEffect, useMemo } from 'react';
import type { Tuple3 } from './coords';
import type { ScenePalette, SceneToken } from './palette';
import { createLabelTexture } from './textures';

export interface LabelProps {
  text: string;
  position: Tuple3;
  /**
   * Height of the label: world metres, or with `screenSize` the height at distance 1 in front of the
   * camera (constant on screen for a given field of view).
   */
  height: number;
  /** Constant size on screen instead of world size (no perspective shrinking). */
  screenSize?: boolean;
  palette: ScenePalette;
  /** Token of a colour dot before the text. */
  dot?: SceneToken;
  strong?: boolean;
  /** Draw on top of everything (compass letters, hour labels). */
  overlay?: boolean;
  /** Horizontal anchor: 'center' (default) or 'right' (the label ends at `position`). */
  anchor?: 'center' | 'right';
}

/**
 * Text label as a camera-facing sprite (part of the WebGL image, so it appears in the PNG export).
 * The canvas texture is rebuilt when text or theme change and disposed afterwards.
 */
export function Label({
  text,
  position,
  height,
  palette,
  dot,
  strong = false,
  overlay = false,
  anchor = 'center',
  screenSize = false,
}: LabelProps) {
  const label = useMemo(
    () => createLabelTexture(text, { palette, dot, strong }),
    [text, palette, dot, strong],
  );
  useEffect(() => () => label.texture.dispose(), [label]);
  return (
    <sprite
      position={position}
      scale={[height * label.aspect, height, 1]}
      center={[anchor === 'right' ? 1 : 0.5, 0.5]}
      renderOrder={overlay ? 20 : 10}
    >
      <spriteMaterial
        map={label.texture}
        transparent
        depthWrite={false}
        depthTest={!overlay}
        sizeAttenuation={!screenSize}
        toneMapped={false}
        fog={false}
      />
    </sprite>
  );
}
