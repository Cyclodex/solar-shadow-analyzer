import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Content width (px, floored) of the element behind the returned ref, updated with a ResizeObserver.
 * Returns `fallback` until the element has been measured (and in environments without layout, e.g. jsdom).
 * Charts render in real pixels at this width so text keeps its size on narrow screens.
 */
export function useElementWidth<T extends HTMLElement>(fallback = 600): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (w: number): void => {
      const px = Math.floor(w);
      if (px > 0) setWidth((prev) => (prev === px ? prev : px));
    };
    apply(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) apply(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width > 0 ? width : fallback];
}
