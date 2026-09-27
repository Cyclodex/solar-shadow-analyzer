// ─────────────────────────────────────────────
// HOLD IN VIEW (owned by the buildings feature, docs/ARCHITECTURE.md "Umgebung", "Öffnen nach einem Import")
// After an address pick the site plan jumps to its start while the page above it is still settling (the
// warnings and «vorläufig» notes of the key figures appear, charts of the new site replace their
// placeholders). Browsers with scroll anchoring (CSS overflow-anchor) keep the plan in place themselves, during
// layout, so even a tap in the same frame hits what was shown. Without it the plan would move down by every
// growth above; holdInView keeps the element's top where the jump put it, frame by frame, until the user
// scrolls, taps, clicks or types, a scroll it did not make, or HOLD_MS. Meanwhile the browser's own anchoring
// (if any) is off for that scroller, so the two never correct the same shift twice.
// ─────────────────────────────────────────────

/** Whether the browser keeps content in place when something above it changes size (scroll anchoring). */
export function hasScrollAnchoring(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('overflow-anchor', 'auto')
  );
}

/** Longest hold after the jump, ms (weather, terrain and the first results of a new site arrive meanwhile). */
export const HOLD_MS = 10_000;

/** Events that mean the user takes over the scroll position (or taps what they see). */
const USER_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/** The nearest ancestor that scrolls vertically, else the document's scroller. */
function scrollerOf(el: Element): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * Keeps `el`'s top at its current screen position (layout shifts above it are scrolled away) until a user
 * event, a scroll the hold did not make, `el` leaving the document, or `ms`. Returns the function that ends
 * the hold (idempotent).
 */
export function holdInView(el: HTMLElement, ms = HOLD_MS): () => void {
  const scroller = scrollerOf(el);
  const top0 = el.getBoundingClientRect().top;
  const previousAnchor = scroller.style.overflowAnchor;
  scroller.style.overflowAnchor = 'none';
  let expected = scroller.scrollTop;
  let frame = 0;
  let done = false;
  const started = performance.now();

  const stop = (): void => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    for (const type of USER_EVENTS) window.removeEventListener(type, stop, true);
    scroller.style.overflowAnchor = previousAnchor;
  };

  const tick = (now: number): void => {
    if (done) return;
    // Scrolled by someone else (the user dragging a scrollbar, a jump): theirs from here on.
    if (!el.isConnected || now - started > ms || Math.abs(scroller.scrollTop - expected) >= 1) {
      stop();
      return;
    }
    const shift = el.getBoundingClientRect().top - top0;
    if (Math.abs(shift) >= 1) scroller.scrollBy({ top: shift, behavior: 'instant' });
    expected = scroller.scrollTop;
    frame = requestAnimationFrame(tick);
  };

  for (const type of USER_EVENTS) window.addEventListener(type, stop, { capture: true, passive: true });
  frame = requestAnimationFrame(tick);
  return stop;
}
