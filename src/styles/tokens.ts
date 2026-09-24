import { useSyncExternalStore } from 'react';

// ─────────────────────────────────────────────
// DESIGN TOKENS FROM SCRIPT
// Helpers for code that needs the tokens of global.css outside CSS: floor colours by index, the current
// theme (to redraw canvases and WebGL after a switch), computed token values and a colour parser.
// SVG and HTML follow the theme through var(--…) by themselves.
// ─────────────────────────────────────────────

/** Number of distinct floor colours (--floor-0 … --floor-7). */
export const FLOOR_COLOR_COUNT = 8;

/**
 * CSS custom property of floor `floor`'s colour. The colour follows the floor index (never its rank or
 * position) and wraps after the last one.
 */
export function floorToken(floor: number): `--floor-${number}` {
  const k = ((Math.round(floor) % FLOOR_COLOR_COUNT) + FLOOR_COLOR_COUNT) % FLOOR_COLOR_COUNT;
  return `--floor-${k}`;
}

/** `var(--floor-k)` of floor `floor`, for fills, strokes and inline custom properties. */
export function floorColor(floor: number): string {
  return `var(${floorToken(floor)})`;
}

// ── Theme ────────────────────────────────────

function subscribeTheme(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const themeSnapshot = (): string => document.documentElement.getAttribute('data-theme') ?? '';
const serverThemeSnapshot = (): string => '';

/**
 * The current <html data-theme> value, observed with a MutationObserver: it changes after the attribute,
 * and with it the computed token values, has switched (not when the store changes, which is earlier).
 */
export function useThemeKey(): string {
  return useSyncExternalStore(subscribeTheme, themeSnapshot, serverThemeSnapshot);
}

/** Computed value of a CSS custom property on `el` (inherited from :root), trimmed. */
export function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

// ── Colour parsing ───────────────────────────

/** RGBA colour, every channel 0…255 as in ImageData (alpha too; not rounded). */
export type Rgba = readonly [number, number, number, number];

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const FUNC_RE = /^rgba?\(\s*([^)]*)\)$/i;

/** An rgb() channel (0…255 or %) or the `alpha` (0…1 or %) on the 0…255 scale; null if not a number. */
function channel(s: string, alpha: boolean): number | null {
  const t = s.trim();
  const pct = t.endsWith('%');
  const num = pct ? t.slice(0, -1) : t;
  const v = Number(num);
  if (num === '' || !Number.isFinite(v)) return null;
  const scaled = pct ? (v / 100) * 255 : alpha ? v * 255 : v;
  return Math.min(255, Math.max(0, scaled));
}

/**
 * Parses the colour syntaxes of the design tokens and of canvas' normalised fillStyle: #rgb, #rgba,
 * #rrggbb, #rrggbbaa, and rgb()/rgba() with commas or spaces and an optional "/ alpha" (number or %).
 * Null for anything else (names, hsl(), var(), malformed values).
 */
export function parseCssColor(value: string): Rgba | null {
  const s = value.trim();
  const hex = HEX_RE.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 255];
  }
  const fn = FUNC_RE.exec(s);
  if (!fn) return null;
  const [colour, alphaPart, ...rest] = fn[1].split('/');
  if (rest.length > 0) return null;
  const parts = colour.includes(',') ? colour.split(',') : colour.trim().split(/\s+/);
  let alpha: string | undefined = alphaPart;
  if (parts.length === 4 && alpha === undefined) alpha = parts.pop();
  if (parts.length !== 3) return null;
  const [r, g, b] = parts.map((p) => channel(p, false));
  const a = alpha === undefined ? 255 : channel(alpha, true);
  if (r === null || g === null || b === null || a === null) return null;
  return [r, g, b, a];
}
