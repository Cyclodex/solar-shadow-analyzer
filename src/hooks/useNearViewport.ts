import { useCallback, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

// ─────────────────────────────────────────────
// NEAR THE VIEWPORT
// For cards far below the fold whose results are expensive (the year of shade behind the heatmap and the
// shaded hours): while such a card is far from the screen — e.g. the tilt slider is dragged at the top of a
// phone — it neither recomputes nor redraws; it catches up as soon as it comes within `screens` viewport
// heights of the screen, and while the page is printed (the print shows the whole page).
// Printing: the flag is set in a beforeprint listener registered when this module loads — before the print
// mode's own handler (export/print.ts), which captures the canvases — and rendered synchronously
// (flushSync), because the print snapshot is taken right after the beforeprint handlers.
// ─────────────────────────────────────────────

let printing = false;
const printListeners = new Set<() => void>();

function setPrinting(value: boolean): void {
  if (printing === value) return;
  printing = value;
  flushSync(() => printListeners.forEach((l) => l()));
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', () => setPrinting(true));
  window.addEventListener('afterprint', () => setPrinting(false));
}

function subscribePrinting(listener: () => void): () => void {
  printListeners.add(listener);
  return () => printListeners.delete(listener);
}

const getPrinting = (): boolean => printing;

/**
 * Callback ref and whether the <section> around its element (a view card; else the element itself) is
 * within `screens` viewport heights of the screen, or the page is being printed. True where
 * IntersectionObserver is missing or has not reported (e.g. jsdom). Pass it as `enabled` to the model hooks
 * of below-the-fold content and keep showing the last result while it is false.
 */
export function useNearViewport<T extends HTMLElement>(
  screens = 1,
): [(el: T | null) => (() => void) | undefined, boolean] {
  const [near, setNear] = useState(true);

  const ref = useCallback(
    (el: T | null) => {
      if (!el || typeof IntersectionObserver === 'undefined') return undefined;
      const target = el.closest('section') ?? el;
      // First answer right away (before paint and before the deferred first computation): a card far
      // below the fold at load is not computed until it comes near.
      const r = target.getBoundingClientRect();
      const vh = window.innerHeight;
      setNear(r.bottom >= -screens * vh && r.top <= (1 + screens) * vh);
      const observer = new IntersectionObserver(
        (entries) => {
          const last = entries[entries.length - 1];
          if (last) setNear(last.isIntersecting);
        },
        { rootMargin: `${screens * 100}% 0px` },
      );
      observer.observe(target);
      return () => observer.disconnect();
    },
    [screens],
  );

  const isPrinting = useSyncExternalStore(subscribePrinting, getPrinting, () => false);
  return [ref, near || isPrinting];
}
