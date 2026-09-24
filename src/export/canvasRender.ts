// ─────────────────────────────────────────────
// SYNCHRONOUS CANVAS RE-RENDER (PNG export, print)
// A canvas that redraws asynchronously — the WebGL scene renders on demand in the next animation
// frame — cannot be captured right after a change: the export would copy a stale or low-resolution
// frame, and the print snapshot is taken before the next frame. So before capturing a canvas, the
// PNG export and the print mode dispatch CANVAS_RENDER_EVENT on it. Its owner may listen and, inside
// the handler (synchronously):
//   - redraw with the current state (for 'print': the light theme that print mode just switched to),
//     at `detail.scale` × its CSS size when a scale is given,
//   - set `detail.rendered = true`,
//   - set `detail.restore` if it changed the canvas for the capture (e.g. its resolution); it is
//     called right after the capture.
// Canvases without a listener (2D canvases that redraw synchronously) are captured as they are.
// ─────────────────────────────────────────────

/** Event type dispatched on a <canvas> right before it is captured (CustomEvent<CanvasRenderDetail>). */
export const CANVAS_RENDER_EVENT = 'ssa:canvas-render';

export interface CanvasRenderDetail {
  /** Why the canvas is captured. */
  readonly reason: 'export' | 'print';
  /** Wanted device pixels per CSS pixel; undefined: keep the current resolution. */
  readonly scale?: number;
  /** Set by the listener once the canvas holds a fresh frame. */
  rendered: boolean;
  /** Set by the listener to undo its changes; called once the capture is done. */
  restore?: () => void;
}

/** Asks the owner of `canvas` to redraw it now (see module comment); returns the listener's answer. */
export function requestCanvasRender(
  canvas: HTMLCanvasElement,
  reason: CanvasRenderDetail['reason'],
  scale?: number,
): CanvasRenderDetail {
  const detail: CanvasRenderDetail = { reason, scale, rendered: false };
  canvas.dispatchEvent(new CustomEvent<CanvasRenderDetail>(CANVAS_RENDER_EVENT, { detail }));
  return detail;
}
