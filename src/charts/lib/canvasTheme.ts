import { useSyncExternalStore } from 'react';

// ─────────────────────────────────────────────
// THEME FOR CANVAS DRAWING
// SVG follows the theme through var(--…) automatically; a canvas has to re-read the tokens and redraw.
// useThemeKey() returns the <html data-theme> attribute itself (observed with a MutationObserver), so the
// redraw happens after the attribute — and with it the computed token values — has actually changed.
// ─────────────────────────────────────────────

function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}

const getSnapshot = (): string => document.documentElement.getAttribute('data-theme') ?? '';
const getServerSnapshot = (): string => '';

/** The current <html data-theme> value; changes after the theme tokens have switched. */
export function useThemeKey(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** RGBA colour, all channels 0…255 (as in ImageData). */
export type Rgba = readonly [number, number, number, number];

/** Computed value of a CSS custom property on `el` (inherited from :root), trimmed. */
export function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const FUNC_RE = /^rgba?\(([^)]+)\)$/i;

const byte = (v: number): number => Math.round(Math.min(255, Math.max(0, Number.isFinite(v) ? v : 0)));

/**
 * Parses "#rgb", "#rrggbb", "#rrggbbaa", "rgb(r, g, b)", "rgba(r, g, b, a)" and the space-separated
 * "rgb(r g b / a)" form (what canvas fillStyle normalises colours to). Anything else → null.
 */
export function parseColor(color: string): Rgba | null {
  const s = color.trim();
  const hex = HEX_RE.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 255];
  }
  const fn = FUNC_RE.exec(s);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (p: string): number => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    const alpha =
      parts.length > 3 ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
    return [byte(channel(parts[0])), byte(channel(parts[1])), byte(channel(parts[2])), byte(alpha * 255)];
  }
  return null;
}

/**
 * Resolves any CSS colour (e.g. a token value) to RGBA with the canvas' own colour parser: assigning
 * fillStyle normalises it. Unparsable input → mid grey.
 */
export function resolveColor(ctx: CanvasRenderingContext2D, color: string): Rgba {
  ctx.fillStyle = '#808080';
  if (color) ctx.fillStyle = color;
  const fill = ctx.fillStyle;
  return (typeof fill === 'string' ? parseColor(fill) : null) ?? [128, 128, 128, 255];
}
