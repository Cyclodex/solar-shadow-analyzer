import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

// ─────────────────────────────────────────────
// NEAR THE VIEWPORT
// For cards far below the fold whose results are expensive (the year of shade behind the heatmap and the
// shaded hours): while such a card is far from the screen — e.g. the tilt slider is dragged at the top of a
// phone — it neither recomputes nor redraws; it catches up as soon as it comes within `screens` viewport
// heights of the screen, and while the page is printed (the print shows the whole page).
// ─────────────────────────────────────────────

/**
 * Callback ref and whether the <section> around its element (a view card; else the element itself) is
 * within `screens` viewport heights of the screen, or the page is being printed. True where
 * IntersectionObserver is missing or has not reported (e.g. jsdom).
 */
export function useNearViewport<T extends HTMLElement>(
  screens = 1,
): [(el: T | null) => (() => void) | undefined, boolean] {
  const [near, setNear] = useState(true);
  const [printing, setPrinting] = useState(false);

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

  // The print snapshot is taken right after the beforeprint handlers: render synchronously.
  useEffect(() => {
    const onBefore = (): void => flushSync(() => setPrinting(true));
    const onAfter = (): void => setPrinting(false);
    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint', onAfter);
    return () => {
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint', onAfter);
    };
  }, []);

  return [ref, near || printing];
}
