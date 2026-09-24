import { useEffect, useRef, useState, type PointerEvent } from 'react';

// ─────────────────────────────────────────────
// POINTER TRACKING FOR CHART OVERLAYS
// Hover index for tooltips/crosshairs (mouse, pen and touch) plus selection by click/tap or press-and-drag.
// Touch: the tooltip stays after lifting the finger and closes on the next tap outside the chart.
// Escape closes the hover state from anywhere on the page.
// ─────────────────────────────────────────────

export interface PlotPointerOptions {
  /** Data index under a point given in px relative to the overlay's top-left corner (null = none). */
  locate: (x: number, y: number) => number | null;
  /** Click/tap on an index; with `drag` also continuously while the pointer is pressed and moved. */
  onSelect?: (index: number) => void;
  /** Press-and-drag selection (pointer capture); otherwise only a click/tap without movement selects. */
  drag?: boolean;
}

export interface PlotPointerHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: PointerEvent<HTMLElement>) => void;
}

export interface PlotPointer {
  /** Index under the pointer (null when the pointer is outside). */
  hover: number | null;
  /** Hides the hover state (e.g. when keyboard navigation takes over). */
  clear: () => void;
  handlers: PlotPointerHandlers;
}

/** Max. pointer travel (px) between down and up that still counts as a click/tap. */
const CLICK_SLOP = 8;

function localPoint(e: PointerEvent<HTMLElement>): [number, number] {
  const r = e.currentTarget.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

export function usePlotPointer({ locate, onSelect, drag = false }: PlotPointerOptions): PlotPointer {
  const [hover, setHover] = useState<number | null>(null);
  const [touchHold, setTouchHold] = useState(false);
  const down = useRef<{ x: number; y: number; id: number } | null>(null);
  const dragging = useRef(false);
  const lastSelected = useRef<number | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  const select = (index: number | null): void => {
    if (index === null || !onSelect) return;
    if (drag && dragging.current && lastSelected.current === index) return;
    lastSelected.current = index;
    onSelect(index);
  };

  // A tooltip opened by touch closes on the next tap outside the chart overlay.
  useEffect(() => {
    if (!touchHold) return;
    const onDown = (e: globalThis.PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setHover(null);
        setTouchHold(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [touchHold]);

  // Escape dismisses a hover tooltip wherever the focus is (WCAG 1.4.13); the next pointer move shows it
  // again. The overlays' own keydown handlers take care of the keyboard cursor.
  const hovering = hover !== null;
  useEffect(() => {
    if (!hovering) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setHover(null);
      setTouchHold(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hovering]);

  const handlers: PlotPointerHandlers = {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      rootRef.current = e.currentTarget;
      const [x, y] = localPoint(e);
      const index = locate(x, y);
      setHover(index);
      setTouchHold(e.pointerType === 'touch');
      down.current = { x, y, id: e.pointerId };
      if (drag) {
        dragging.current = true;
        lastSelected.current = null;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        select(index);
      }
    },
    onPointerMove: (e) => {
      const [x, y] = localPoint(e);
      const index = locate(x, y);
      setHover(index);
      if (drag && dragging.current) select(index);
    },
    onPointerUp: (e) => {
      const start = down.current;
      down.current = null;
      if (drag) {
        dragging.current = false;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        return;
      }
      if (!start || start.id !== e.pointerId) return;
      const [x, y] = localPoint(e);
      if (Math.hypot(x - start.x, y - start.y) <= CLICK_SLOP) select(locate(x, y));
    },
    onPointerCancel: () => {
      down.current = null;
      dragging.current = false;
    },
    onPointerLeave: (e) => {
      if (e.pointerType !== 'touch' && !dragging.current) setHover(null);
    },
  };

  return {
    hover,
    clear: () => {
      setHover(null);
      setTouchHold(false);
    },
    handlers,
  };
}
