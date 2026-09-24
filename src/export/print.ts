import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Theme } from '../model/types';
import { useUiStore } from '../state/uiStore';
import './print.css';

// ─────────────────────────────────────────────
// PRINT REPORT
// print.css turns the page into a report under @media print (controls hidden, one column, page
// breaks). usePrintMode() additionally reacts to beforeprint/afterprint — for the menu item and
// for the browser's own print command alike: it switches to the light theme for paper (canvas
// views redraw with it), marks <html> with PRINTING_CLASS and tells its component when to render
// print-only content (the inputs appendix).
// ─────────────────────────────────────────────

/** Class on <html> while the print dialog is open. */
export const PRINTING_CLASS = 'ssa-printing';

/** Opens the browser's print dialog ("save as PDF" is offered there as well). */
export function printReport(): void {
  window.print();
}

/**
 * Prepares the page while printing. Returns the time (ms) printing started, or null when not printing.
 * Mount in exactly one always-mounted component.
 */
export function usePrintMode(): number | null {
  const [printedAt, setPrintedAt] = useState<number | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    let restoreTheme: Theme | null = null;

    const onBeforePrint = (): void => {
      const { theme, setTheme } = useUiStore.getState();
      // Synchronous render: the print snapshot is taken right after this handler.
      flushSync(() => {
        setPrintedAt(Date.now());
        if (theme !== 'light') {
          restoreTheme = theme;
          setTheme('light');
        }
      });
      root.dataset.theme = 'light';
      root.classList.add(PRINTING_CLASS);
    };

    const onAfterPrint = (): void => {
      root.classList.remove(PRINTING_CLASS);
      if (restoreTheme) {
        const theme = restoreTheme;
        restoreTheme = null;
        useUiStore.getState().setTheme(theme);
        root.dataset.theme = theme;
      }
      setPrintedAt(null);
    };

    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
      if (restoreTheme) onAfterPrint();
    };
  }, []);

  return printedAt;
}
