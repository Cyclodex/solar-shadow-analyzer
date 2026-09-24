import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { PerspectiveCamera, Vector3, type Sprite } from 'three';
import type { Tuple3 } from './coords';
import type { ScenePalette, SceneToken } from './palette';
import { spriteHeightForPx } from './sceneLayout';
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
  /**
   * Minimum height on screen, CSS px (0 = none): the label grows beyond `height` where it would look
   * smaller (small canvas, distant camera). A world-size label still grows when the camera comes closer.
   */
  minPx?: number;
  palette: ScenePalette;
  /** Token of a colour dot before the text. */
  dot?: SceneToken;
  strong?: boolean;
  /** Draw on top of everything (compass letters, hour labels). */
  overlay?: boolean;
  /** Horizontal anchor: 'center' (default) or 'right' (the label ends at `position`). */
  anchor?: 'center' | 'right';
}

/** Scratch vector (the frame callbacks never run concurrently). */
const WORLD = new Vector3();

/**
 * Text label as a camera-facing sprite (part of the WebGL image, so it appears in the PNG export).
 * The canvas texture is rebuilt when text or theme change and disposed afterwards. With `minPx` the sprite
 * is rescaled before every rendered frame (relative to the view height, so the PNG export keeps the
 * proportions of the screen).
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
  minPx = 0,
}: LabelProps) {
  const label = useMemo(
    () => createLabelTexture(text, { palette, dot, strong }),
    [text, palette, dot, strong],
  );
  useEffect(() => () => label.texture.dispose(), [label]);
  const ref = useRef<Sprite>(null);
  useFrame(({ camera, size }) => {
    const sprite = ref.current;
    if (!sprite) return;
    let h = height;
    if (minPx > 0 && camera instanceof PerspectiveCamera) {
      let depth = 1;
      if (!screenSize) {
        camera.updateMatrixWorld();
        depth = Math.max(0, -sprite.getWorldPosition(WORLD).applyMatrix4(camera.matrixWorldInverse).z);
      }
      h = Math.max(height, spriteHeightForPx(minPx, camera.fov, size.height, depth));
    }
    // Also back to `height` when minPx is switched off (the unchanged scale prop is not applied again).
    if (sprite.scale.y !== h) sprite.scale.set(h * label.aspect, h, 1);
  });
  return (
    <sprite
      ref={ref}
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
