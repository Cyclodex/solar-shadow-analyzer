import { describe, expect, it, vi } from 'vitest';
import type { CanvasRenderDetail } from '../../export/canvasRender';
import { renderForCapture } from './captureRender';

/** Stand-in for the R3F root state: a renderer that records its pixel ratio and render calls. */
function fakeRoot(pixelRatio: number, maxTextureSize = 16384) {
  const gl = {
    ratio: pixelRatio,
    renderedAt: [] as number[],
    capabilities: { maxTextureSize },
    getPixelRatio: () => gl.ratio,
    setPixelRatio: (r: number) => {
      gl.ratio = r;
    },
    render: () => {
      gl.renderedAt.push(gl.ratio);
    },
  };
  const invalidate = vi.fn();
  const root = { gl, scene: {}, camera: {}, size: { width: 954, height: 560 }, invalidate };
  // Only the members used by renderForCapture are faked.
  return { gl, invalidate, root: root as unknown as Parameters<typeof renderForCapture>[0] };
}

const detail = (reason: CanvasRenderDetail['reason'], scale?: number): CanvasRenderDetail => ({
  reason,
  scale,
  rendered: false,
});

describe('renderForCapture', () => {
  it('renders at the requested scale and restores the screen resolution afterwards', () => {
    const { gl, invalidate, root } = fakeRoot(1);
    const d = detail('export', 2);
    renderForCapture(root, d);
    expect(gl.renderedAt).toEqual([2]);
    expect(d.rendered).toBe(true);
    expect(gl.ratio).toBe(2);
    d.restore?.();
    expect(gl.ratio).toBe(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('keeps the drawing buffer within the maximum texture size', () => {
    const { gl, root } = fakeRoot(1, 2048);
    renderForCapture(root, detail('export', 4));
    expect(gl.renderedAt[0]).toBeCloseTo(2048 / 954, 9);
  });

  it('renders at the current resolution without a scale or when that is already sharper', () => {
    for (const [ratio, scale] of [
      [2, undefined],
      [2, 1.5],
    ] as const) {
      const { gl, invalidate, root } = fakeRoot(ratio);
      const d = detail('print', scale);
      renderForCapture(root, d);
      expect(gl.renderedAt).toEqual([2]);
      expect(d.rendered).toBe(true);
      expect(d.restore).toBeUndefined();
      expect(invalidate).not.toHaveBeenCalled();
    }
  });
});
