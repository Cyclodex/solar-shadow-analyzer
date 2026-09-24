import { useCallback, useState } from 'react';

export interface ElementWidthOptions {
  /** Width until the element has been measured (first render, environments without layout such as jsdom). */
  fallback?: number;
  /** Lower bound of the returned width. */
  min?: number;
}

/**
 * Content width (px, floored so a layout never overflows its container) of the element behind the returned
 * callback ref, updated with a ResizeObserver. The first measurement happens in the ref callback, before
 * paint, so there is no frame at the fallback width. Charts render in real pixels at this width so text
 * keeps its size on narrow screens.
 */
export function useElementWidth<T extends HTMLElement>({
  fallback = 600,
  min = 0,
}: ElementWidthOptions = {}): [(el: T | null) => (() => void) | undefined, number] {
  const [width, setWidth] = useState<number | null>(null);
  const ref = useCallback((el: T | null) => {
    if (!el) return undefined;
    const apply = (w: number): void => {
      const px = Math.floor(w);
      if (px > 0) setWidth(px);
    };
    apply(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) apply(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, Math.max(min, width ?? fallback)];
}
