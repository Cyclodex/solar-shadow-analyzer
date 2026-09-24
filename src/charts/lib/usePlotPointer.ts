import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

// ─────────────────────────────────────────────
// POINTER TRACKING FOR CHART OVERLAYS
// Hover index for tooltips/crosshairs (mouse, pen and touch) plus selection by click/tap or press-and-drag.
// Touch: the tooltip stays after lifting the finger and closes on the next tap outside the chart (a tap on
// an element marked CHART_ACTION_ATTR, e.g. a button in the tooltip, keeps it). The overlays have
// touch-action: pan-y, so a vertical swipe scrolls the page: the browser then ends the touch with
// pointercancel, and nothing it touched stays selected or shown. A touch therefore selects only as a tap
// (the click the browser sends for a short press without movement, not for a long press or a tap that
// stops a fling) or once it has moved sideways (drag, touchScrubSelects).
// Escape closes the hover state from anywhere on the page.
// ─────────────────────────────────────────────

/** Marks an element outside the overlay (e.g. a tooltip button) whose taps keep a touch tooltip open. */
export const CHART_ACTION_ATTR = 'data-chart-action';

export interface PlotPointerOptions {
  /** Data index under a point given in px relative to the overlay's top-left corner (null = none). */
  locate: (x: number, y: number) => number | null;
  /** Click/tap on an index; with `drag` also continuously while the pointer is pressed and moved. */
  onSelect?: (index: number) => void;
  /**
   * Press-and-drag selection (pointer capture); otherwise only a click/tap without movement selects. A touch
   * drag starts once the finger moves sideways, so a vertical swipe still scrolls the page.
   */
  drag?: boolean;
  /**
   * With `drag`: the browser took over a touch drag that had already selected (it turned into a scroll):
   * undo what the drag selected.
   */
  onDragCancel?: () => void;
  /** Touch only (without `drag`): lifting the finger after a sideways scrub selects the index under it. */
  touchScrubSelects?: boolean;
  /**
   * Touch only: a tap shows the index (tooltip) without selecting it; the chart offers an explicit action
   * for that (e.g. a button in the tooltip). Mouse and pen still select on click.
   */
  touchPreview?: boolean;
}

export interface PlotPointerHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: PointerEvent<HTMLElement>) => void;
  onClick: (e: MouseEvent<HTMLElement>) => void;
}

export interface PlotPointer {
  /** Index under the pointer (null when the pointer is outside). */
  hover: number | null;
  /** The hover state comes from a touch (held after lifting the finger): word hints for tapping. */
  touch: boolean;
  /** Hides the hover state (e.g. when keyboard navigation takes over). */
  clear: () => void;
  handlers: PlotPointerHandlers;
}

/** Max. pointer travel (px) between down and up that still counts as a click/tap. */
const CLICK_SLOP = 8;

function localPoint(e: PointerEvent<HTMLElement> | MouseEvent<HTMLElement>): [number, number] {
  const r = e.currentTarget.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

export function usePlotPointer({
  locate,
  onSelect,
  drag = false,
  onDragCancel,
  touchScrubSelects = false,
  touchPreview = false,
}: PlotPointerOptions): PlotPointer {
  const [hover, setHover] = useState<number | null>(null);
  const [touchHold, setTouchHold] = useState(false);
  const down = useRef<{ x: number; y: number; id: number; touch: boolean } | null>(null);
  const dragging = useRef(false);
  /** A touch press on a drag chart that has not moved sideways yet (it may still become a scroll). */
  const pendingDrag = useRef(false);
  /** A touch that ended as a tap (client coordinates); the click that follows selects. */
  const tap = useRef<{ x: number; y: number } | null>(null);
  const lastSelected = useRef<number | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  const select = (index: number | null): void => {
    if (index === null || !onSelect) return;
    if (drag && dragging.current && lastSelected.current === index) return;
    lastSelected.current = index;
    onSelect(index);
  };

  // A tooltip opened by touch closes on the next tap outside the chart overlay (and its actions).
  useEffect(() => {
    if (!touchHold) return;
    const onDown = (e: globalThis.PointerEvent): void => {
      const target = e.target instanceof Element ? e.target : null;
      if (rootRef.current?.contains(target) || target?.closest(`[${CHART_ACTION_ATTR}]`)) return;
      setHover(null);
      setTouchHold(false);
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
      const touch = e.pointerType === 'touch';
      setHover(index);
      setTouchHold(touch);
      down.current = { x, y, id: e.pointerId, touch };
      tap.current = null;
      pendingDrag.current = false;
      if (!drag) return;
      lastSelected.current = null;
      if (touch) {
        // touch-action: pan-y lets a vertical swipe scroll the page (pointercancel follows), so a touch
        // only starts dragging once it moves sideways; a tap selects on its click.
        pendingDrag.current = true;
        dragging.current = false;
        return;
      }
      dragging.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      select(index);
    },
    onPointerMove: (e) => {
      const [x, y] = localPoint(e);
      const index = locate(x, y);
      setHover(index);
      if (e.pointerType !== 'touch') setTouchHold(false);
      const start = down.current;
      if (pendingDrag.current && start && start.id === e.pointerId) {
        const dx = Math.abs(x - start.x);
        if (dx > CLICK_SLOP && dx > Math.abs(y - start.y)) {
          pendingDrag.current = false;
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }
      }
      if (drag && dragging.current) select(index);
    },
    onPointerUp: (e) => {
      const start = down.current;
      down.current = null;
      pendingDrag.current = false;
      if (drag && dragging.current) {
        dragging.current = false;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        return;
      }
      if (!start || start.id !== e.pointerId) return;
      const [x, y] = localPoint(e);
      const moved = Math.hypot(x - start.x, y - start.y) > CLICK_SLOP;
      if (start.touch) {
        if (!moved) tap.current = { x: e.clientX, y: e.clientY };
        // A vertical scroll ends in pointercancel, so this is a sideways scrub.
        else if (touchScrubSelects && !drag) select(locate(x, y));
        return;
      }
      if (!drag && !moved) select(locate(x, y));
    },
    onPointerCancel: () => {
      const undo = dragging.current && down.current?.touch === true && lastSelected.current !== null;
      down.current = null;
      dragging.current = false;
      pendingDrag.current = false;
      tap.current = null;
      // The browser took the gesture (a scroll): no tooltip stays open, nothing stays selected.
      setHover(null);
      setTouchHold(false);
      if (undo) onDragCancel?.();
    },
    onPointerLeave: (e) => {
      if (e.pointerType !== 'touch' && !dragging.current) setHover(null);
    },
    onClick: (e) => {
      const t = tap.current;
      tap.current = null;
      if (!t || Math.hypot(e.clientX - t.x, e.clientY - t.y) > CLICK_SLOP) return;
      const [x, y] = localPoint(e);
      if (touchPreview) setHover(locate(x, y));
      else select(locate(x, y));
    },
  };

  return {
    hover,
    touch: touchHold,
    clear: () => {
      setHover(null);
      setTouchHold(false);
    },
    handlers,
  };
}
