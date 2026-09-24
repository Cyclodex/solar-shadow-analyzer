import type { MouseEvent } from 'react';

/**
 * In-page link handler: scrolls to and focuses the element `id` (a region with tabIndex={-1}) without
 * navigating to '#id', which would replace the '#c=' share hash and add a history entry. Without the target
 * the native jump remains. `smooth` scrolls smoothly unless the user prefers reduced motion.
 */
export function jumpTo(e: MouseEvent<HTMLAnchorElement>, id: string, { smooth = false } = {}): void {
  const target = document.getElementById(id);
  if (!target) return;
  e.preventDefault();
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  target.scrollIntoView?.({ block: 'start', behavior: smooth && !reduce ? 'smooth' : 'auto' });
  target.focus({ preventScroll: true });
}
