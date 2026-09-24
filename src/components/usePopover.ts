import { useEffect, useEffectEvent, useLayoutEffect, type RefObject } from 'react';

// ─────────────────────────────────────────────
// POPOVERS
// Shared behaviour of the small popovers anchored to a button (export menu, share link, info tips):
// they stay inside the viewport horizontally and close on a pointer press outside.
// ─────────────────────────────────────────────

/** Viewport margin kept free by popovers, px. */
const EDGE = 8;

/**
 * While `active`, shifts the absolutely positioned popover `ref` horizontally so it stays inside the
 * viewport: sets the CSS variable --shift (px), which the popover's transform has to include, e.g.
 * `transform: translateX(var(--shift, 0px))`.
 */
export function useKeepInViewport(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    el.style.setProperty('--shift', '0px');
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    let shift = 0;
    if (r.left < EDGE) shift = EDGE - r.left;
    else if (r.right > vw - EDGE) shift = vw - EDGE - r.right;
    el.style.setProperty('--shift', `${Math.round(shift)}px`);
  }, [ref, active]);
}

/**
 * While `active`, calls `onDismiss` (its latest version) on a pointer press outside `rootRef`, the
 * element that holds both the trigger and the popover.
 */
export function useDismissOnOutsidePointer(
  rootRef: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
): void {
  const dismiss = useEffectEvent(onDismiss);
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [rootRef, active]);
}
