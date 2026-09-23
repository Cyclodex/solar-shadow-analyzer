import { useCallback, useState } from 'react';

/** Width used until the container has been measured (first render, jsdom). */
export const FALLBACK_SVG_WIDTH = 480;
/** Views never lay out narrower than this (tiny containers scale the SVG down instead). */
export const MIN_SVG_WIDTH = 280;

/**
 * Measures the content width of an element (ResizeObserver) so that an SVG can use a viewBox of the
 * same pixel width: text keeps its real size on phones and diagrams re-layout instead of shrinking.
 * Returns a callback ref for the container and the width in whole pixels (≥ MIN_SVG_WIDTH).
 */
export function useElementWidth<T extends HTMLElement>(
  fallback = FALLBACK_SVG_WIDTH,
): [(el: T | null) => (() => void) | undefined, number] {
  const [width, setWidth] = useState<number | null>(null);
  const ref = useCallback((el: T | null) => {
    if (!el) return undefined;
    const update = (w: number): void => {
      if (w > 0 && Number.isFinite(w)) setWidth(Math.round(w));
    };
    // Measure synchronously (ref callbacks run before paint) to avoid a first frame at the fallback width.
    update(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) update(last.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, Math.max(MIN_SVG_WIDTH, width ?? fallback)];
}
