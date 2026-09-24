import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Theme } from '../model/types';
import { useUiStore } from '../state/uiStore';
import { requestCanvasRender } from './canvasRender';
import './print.css';

// ─────────────────────────────────────────────
// PRINT REPORT
// print.css turns the page into a report under @media print (controls hidden, one column, page
// breaks). usePrintMode() additionally reacts to beforeprint/afterprint — for the menu item and
// for the browser's own print command alike: it switches to the light theme for paper, marks <html>
// with PRINTING_CLASS and tells its component when to render print-only content (the inputs appendix).
//
// Canvases must show the light theme in the print snapshot. 2D canvases redraw synchronously with the
// theme; the WebGL scene redraws in an animation frame, which the snapshot does not wait for. Hence:
// - printReport() switches the theme first and waits two frames before opening the print dialog;
// - for the browser's print command, beforeprint asks every canvas to re-render synchronously
//   (CANVAS_RENDER_EVENT, reason 'print') and prints a 2D copy of each canvas that did, since the
//   browser prints the last *presented* WebGL frame, not the one just drawn.
// ─────────────────────────────────────────────

/** Class on <html> while the print dialog is open. */
export const PRINTING_CLASS = 'ssa-printing';

/** Marks the 2D copy of a canvas that is printed in its place (see print.css). */
export const PRINT_STAND_IN_ATTR = 'data-print-stand-in';
/** Marks a canvas that is replaced by its PRINT_STAND_IN_ATTR copy while printing. */
const PRINT_REPLACED_ATTR = 'data-print-replaced';

/** Theme to restore after printing; set while print mode has switched to the light theme. */
let themeBeforePrint: Theme | null = null;

/** Switches to the light theme (call inside flushSync) and remembers the theme to restore. */
function enterPrintTheme(): void {
  const { theme, setTheme } = useUiStore.getState();
  if (theme === 'light') return;
  themeBeforePrint ??= theme;
  setTheme('light');
}

/** Restores the theme that was active before printing, if print mode changed it. */
function leavePrintTheme(): void {
  const theme = themeBeforePrint;
  if (!theme) return;
  themeBeforePrint = null;
  useUiStore.getState().setTheme(theme);
  document.documentElement.dataset.theme = theme;
}

/** Switches to the light theme synchronously (store, <html data-theme>). */
function switchToLightTheme(): void {
  if (useUiStore.getState().theme === 'light') return;
  flushSync(enterPrintTheme);
  document.documentElement.dataset.theme = 'light';
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Opens the browser's print dialog ("save as PDF" is offered there as well). Switches to the light
 * theme first and lets canvases redraw with it (two animation frames), then prints; print mode
 * restores the theme afterwards.
 */
export async function printReport(): Promise<void> {
  switchToLightTheme();
  // Frame 1: pending renders (the menu closing, the WebGL scene with the new palette); frame 2: on screen.
  await nextFrame();
  await nextFrame();
  let started = false;
  const onStart = (): void => {
    started = true;
  };
  window.addEventListener('beforeprint', onStart);
  try {
    window.print();
  } finally {
    window.removeEventListener('beforeprint', onStart);
  }
  // No print events during print() (printing unsupported, or a non-blocking dialog without them):
  // do not leave the page in the light theme.
  if (!started) leavePrintTheme();
}

/**
 * Puts a 2D copy of `canvas` next to it; print.css prints the copy instead of the canvas.
 * Returns a function that removes the copy, or null if the canvas cannot be copied.
 */
function printStandIn(canvas: HTMLCanvasElement): (() => void) | null {
  if (canvas.width === 0 || canvas.height === 0) return null;
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  try {
    const ctx = copy.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0);
  } catch {
    return null;
  }
  copy.className = canvas.className;
  copy.style.cssText = canvas.style.cssText;
  copy.setAttribute(PRINT_STAND_IN_ATTR, '');
  copy.setAttribute('aria-hidden', 'true');
  canvas.after(copy);
  canvas.setAttribute(PRINT_REPLACED_ATTR, '');
  return () => {
    copy.remove();
    canvas.removeAttribute(PRINT_REPLACED_ATTR);
  };
}

/** Re-renders the canvases that support it (CANVAS_RENDER_EVENT) and puts 2D copies of them in place. */
function captureCanvases(): (() => void)[] {
  const removers: (() => void)[] = [];
  for (const canvas of document.querySelectorAll('canvas')) {
    if (canvas.hasAttribute(PRINT_STAND_IN_ATTR)) continue;
    const render = requestCanvasRender(canvas, 'print');
    try {
      const remove = render.rendered ? printStandIn(canvas) : null;
      if (remove) removers.push(remove);
    } finally {
      render.restore?.();
    }
  }
  return removers;
}

/**
 * Prepares the page while printing. Returns the time (ms) printing started, or null when not printing.
 * Mount in exactly one always-mounted component.
 */
export function usePrintMode(): number | null {
  const [printedAt, setPrintedAt] = useState<number | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    let standIns: (() => void)[] = [];

    const onBeforePrint = (): void => {
      // Synchronous render: the print snapshot is taken right after this handler.
      flushSync(() => {
        setPrintedAt(Date.now());
        enterPrintTheme();
      });
      root.dataset.theme = 'light';
      root.classList.add(PRINTING_CLASS);
      standIns.forEach((remove) => remove());
      standIns = captureCanvases();
    };

    const onAfterPrint = (): void => {
      standIns.forEach((remove) => remove());
      standIns = [];
      root.classList.remove(PRINTING_CLASS);
      leavePrintTheme();
      setPrintedAt(null);
    };

    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
      if (root.classList.contains(PRINTING_CLASS)) onAfterPrint();
    };
  }, []);

  return printedAt;
}
