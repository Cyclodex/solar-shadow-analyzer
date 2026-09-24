// Shared layout constants of the SVG views (px = SVG user units at the measured width).

/** Outer padding of every figure. */
export const PAD = 10;
/** Label font size (svg.module.css `.label`). */
export const FONT = 11;
/** Line height of multi-line status text. */
export const LINE = 15;
/** Layout width until the container is measured, and the narrowest layout (smaller containers scale it). */
export const VIEW_WIDTH = { fallback: 480, min: 280 } as const;

/** Hatch texture (HatchPattern props): dark lines for light fills (behind the facade, blocked sky). */
export const HATCH = { color: 'var(--text)', opacity: 0.4, lineWidth: 1.2, spacing: 6 } as const;
/** Light hatch lines for dark fills (shade on the dark-blue panels). */
export const HATCH_LIGHT = { ...HATCH, color: 'var(--on-accent)', opacity: 0.55 } as const;
