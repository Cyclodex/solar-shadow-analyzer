import type { RootState } from '@react-three/fiber';
import type { CanvasRenderDetail } from '../../export/canvasRender';

/**
 * Answers CANVAS_RENDER_EVENT (export/canvasRender.ts) for the scene: renders a frame right now, at
 * `detail.scale` device pixels per CSS pixel when that is sharper than the screen's (capped so the
 * drawing buffer stays within the GPU's texture size limit), and sets `detail.restore` to go back to
 * the screen resolution. Synchronous, since the canvas is captured right after the event.
 */
export function renderForCapture(
  { gl, scene, camera, size, invalidate }: Pick<RootState, 'gl' | 'scene' | 'camera' | 'size' | 'invalidate'>,
  detail: CanvasRenderDetail,
): void {
  const prev = gl.getPixelRatio();
  const target = Math.min(
    detail.scale ?? prev,
    gl.capabilities.maxTextureSize / Math.max(1, size.width, size.height),
  );
  if (target > prev) gl.setPixelRatio(target);
  gl.render(scene, camera);
  detail.rendered = true;
  if (target > prev) {
    detail.restore = () => {
      gl.setPixelRatio(prev);
      invalidate();
    };
  }
}
