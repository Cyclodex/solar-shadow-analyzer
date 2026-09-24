import type { MouseEvent } from 'react';

/**
 * Marks the part of a jump target that should be fully visible after the jump, e.g. the 3D view with its
 * camera buttons in the views region (views/scene3d/SceneStage.tsx).
 */
export const JUMP_REVEAL_ATTR = 'data-jump-reveal';

/** Least space (px) between a revealed element and the control bar of phones. */
const REVEAL_GAP = 8;

const px = (value: string): number => parseFloat(value) || 0;

/**
 * Page scroll position (px) that aligns `target` with the top of the screen and then scrolls on until the
 * bottom of `reveal` is above the control bar of phones (--bottom-bar-h, app/BottomBar.tsx), as far as the
 * top of `reveal` stays on screen; null when the start alignment already shows `reveal` completely.
 */
function revealScrollTop(target: Element, reveal: Element): number | null {
  const root = getComputedStyle(document.documentElement);
  // Scroll distance of the start alignment (scroll-margin-top of the target, scroll-padding-top of the page).
  const start =
    target.getBoundingClientRect().top -
    px(getComputedStyle(target).scrollMarginTop) -
    px(root.scrollPaddingTop);
  const r = reveal.getBoundingClientRect();
  const below =
    r.bottom - start + REVEAL_GAP - (window.innerHeight - px(root.getPropertyValue('--bottom-bar-h')));
  const extra = Math.min(below, r.top - start);
  return extra > 0 ? window.scrollY + start + extra : null;
}

/**
 * In-page link handler: scrolls to and focuses the element `id` (a region with tabIndex={-1}) without
 * navigating to '#id', which would replace the '#c=' share hash and add a history entry. Without the target
 * the native jump remains. `smooth` scrolls smoothly unless the user prefers reduced motion. The target's
 * top is aligned with the top of the screen; where a part of it marked JUMP_REVEAL_ATTR would end behind
 * the control bar of phones, the page scrolls on until it is visible (short screens).
 */
export function jumpTo(e: MouseEvent<HTMLAnchorElement>, id: string, { smooth = false } = {}): void {
  const target = document.getElementById(id);
  if (!target) return;
  e.preventDefault();
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const behavior: ScrollBehavior = smooth && !reduce ? 'smooth' : 'auto';
  const reveal = target.querySelector(`[${JUMP_REVEAL_ATTR}]`);
  const top = reveal ? revealScrollTop(target, reveal) : null;
  if (top !== null) window.scrollTo({ top, behavior });
  else target.scrollIntoView?.({ block: 'start', behavior });
  target.focus({ preventScroll: true });
}
