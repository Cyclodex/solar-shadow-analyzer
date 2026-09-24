import { useEffect, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

// ─────────────────────────────────────────────
// NEAR THE VIEWPORT
// Lets below-the-fold content skip work while it is far off screen, e.g. computing and drawing the
// heatmap on every step of a slider drag on a phone, where it sits several screens below the slider.
// Printing prints every chart, so everything counts as near while printing: the flag is set in a
// beforeprint listener registered when this module loads — before the print mode's own handler
// (export/print.ts), which captures the canvases — and rendered synchronously (flushSync), because the
// print snapshot is taken right after the beforeprint handlers.
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
 * Whether the element (callback ref, first item) is within `rootMargin` of the viewport (default: one
 * screen above and below). Starts true, so the first render does its work as before (also where
 * IntersectionObserver is missing, e.g. jsdom), and is true while printing. Pass it as `enabled` to the
 * model hooks of below-the-fold content and keep showing the last result while it is false.
 */
export function useNearViewport<T extends Element>(
  rootMargin = '100% 0px',
): [ref: (el: T | null) => void, near: boolean] {
  const [el, setEl] = useState<T | null>(null);
  const [near, setNear] = useState(true);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setNear(last.isIntersecting);
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, rootMargin]);
  const isPrinting = useSyncExternalStore(subscribePrinting, getPrinting, () => false);
  return [setEl, near || isPrinting];
}
