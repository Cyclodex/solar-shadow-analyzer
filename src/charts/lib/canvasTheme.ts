import { parseCssColor, type Rgba } from '../../styles/tokens';

// ─────────────────────────────────────────────
// THEME FOR CANVAS DRAWING
// SVG follows the theme through var(--…) automatically; a canvas has to re-read the tokens (cssVar) and
// redraw when useThemeKey() changes (both in src/styles/tokens.ts).
// ─────────────────────────────────────────────

/**
 * Resolves any CSS colour (e.g. a token value) to RGBA with the canvas' own colour parser: assigning
 * fillStyle normalises it. Unparsable input → mid grey.
 */
export function resolveColor(ctx: CanvasRenderingContext2D, color: string): Rgba {
  ctx.fillStyle = '#808080';
  if (color) ctx.fillStyle = color;
  const fill = ctx.fillStyle;
  return (typeof fill === 'string' ? parseCssColor(fill) : null) ?? [128, 128, 128, 255];
}
