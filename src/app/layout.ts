// Media queries of the page layout (App.tsx); the CSS breakpoints are in App.module.css.

/** Desktop layout: sticky sidebar (time, tilt, settings) | main column. */
export const WIDE_LAYOUT = '(min-width: 1100px)';

/**
 * One-column layout on phones, touch tablets and narrow windows: control bar at the bottom of the screen
 * (BottomBar) and the time and tilt cards after the views, so the 3D view comes right after the results.
 * Implies !WIDE_LAYOUT.
 */
export const BOTTOM_BAR_LAYOUT = '(max-width: 899.98px), (max-width: 1099.98px) and (pointer: coarse)';
