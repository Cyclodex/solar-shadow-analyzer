import { useSyncExternalStore } from 'react';
import { Color, SRGBColorSpace } from 'three';

// ─────────────────────────────────────────────
// SCENE PALETTE
// The 3D scene takes every colour from the design tokens in src/styles/global.css (no literals here):
// the tokens are read from the computed style of <html> and re-read when data-theme changes.
// Derived colours (night sky, glass, grid lines) are mixes of tokens.
// ─────────────────────────────────────────────

/** sRGB colour, channels 0…1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const FUNC_RE = /^rgba?\(\s*([^)]*)\)$/i;

function channel(s: string, max: number): number | null {
  const t = s.trim();
  if (t.endsWith('%')) {
    const v = Number(t.slice(0, -1));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v / 100)) : null;
  }
  const v = Number(t);
  return t !== '' && Number.isFinite(v) ? Math.min(1, Math.max(0, v / max)) : null;
}

/**
 * Parses the colour syntaxes used by the design tokens: #rgb, #rgba, #rrggbb, #rrggbbaa,
 * rgb()/rgba() with commas or spaces and an optional "/ alpha" (number or %). Null for anything else.
 */
export function parseCssColor(value: string): Rgba | null {
  const s = value.trim();
  const hex = HEX_RE.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
  }
  const fn = FUNC_RE.exec(s);
  if (!fn) return null;
  const [colour, alphaPart] = fn[1].split('/');
  const parts = colour.includes(',') ? colour.split(',') : colour.trim().split(/\s+/);
  let alphaStr: string | undefined = alphaPart;
  if (parts.length === 4 && alphaStr === undefined) alphaStr = parts.pop();
  if (parts.length !== 3) return null;
  const [r, g, b] = parts.map((p) => channel(p, 255));
  const a = alphaStr === undefined ? 1 : channel(alphaStr, 1);
  if (r === null || g === null || b === null || a === null) return null;
  return { r, g, b, a };
}

/** Tokens the scene reads (see global.css). */
const TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'text',
  'text-muted',
  'sky-top',
  'sky-bottom',
  'ground',
  'wall',
  'wall-edge',
  'railing',
  'panel',
  'panel-cell',
  'panel-edge',
  'sun',
  'sun-glow',
  'shade',
  'grid',
  'axis',
  'floor-0',
  'floor-1',
  'floor-2',
  'floor-3',
  'floor-4',
  'floor-5',
  'floor-6',
  'floor-7',
] as const;

export type SceneToken = (typeof TOKENS)[number];

const FLOOR_TOKENS = [
  'floor-0',
  'floor-1',
  'floor-2',
  'floor-3',
  'floor-4',
  'floor-5',
  'floor-6',
  'floor-7',
] as const satisfies readonly SceneToken[];

/** Colour token of floor index `k` (fixed order, as in the charts). */
export function floorToken(k: number): SceneToken {
  return FLOOR_TOKENS[Math.min(FLOOR_TOKENS.length - 1, Math.max(0, Math.round(k)))];
}

/** Neutral stand-in for a token that is not defined (CSS not loaded, e.g. in unit tests). */
const MISSING: Rgba = { r: 0.5, g: 0.5, b: 0.5, a: 1 };

export interface ScenePalette {
  /** Theme key the palette was read for. */
  theme: string;
  /** Token colours as sRGB (for canvas drawing via css()). */
  rgba: Record<SceneToken, Rgba>;
  /** Linear (working space) three.js colour of a token. */
  color: (token: SceneToken) => Color;
  /** CSS colour string of a token, alpha included (for 2D canvas textures). */
  css: (token: SceneToken, alpha?: number) => string;
  /** Derived colours (linear working space). */
  nightTop: Color;
  nightHorizon: Color;
  glass: Color;
  gridLine: Color;
  obstacle: Color;
  horizonFill: Color;
  /** Font stack for labels (--font-sans). */
  font: string;
}

function toCss({ r, g, b, a }: Rgba, alpha = a): string {
  const c = (v: number): number => Math.round(v * 255);
  return `rgb(${c(r)} ${c(g)} ${c(b)} / ${Math.round(alpha * 1000) / 1000})`;
}

/** Reads the scene tokens from the computed style of `root`. */
export function readPalette(theme: string, root: Element = document.documentElement): ScenePalette {
  const style = getComputedStyle(root);
  const rgba = {} as Record<SceneToken, Rgba>;
  for (const t of TOKENS) rgba[t] = parseCssColor(style.getPropertyValue(`--${t}`)) ?? MISSING;
  const colors = new Map<SceneToken, Color>();
  const color = (t: SceneToken): Color => {
    let c = colors.get(t);
    if (!c) {
      const { r, g, b } = rgba[t];
      c = new Color().setRGB(r, g, b, SRGBColorSpace);
      colors.set(t, c);
    }
    return c;
  };
  const mix = (a: SceneToken, b: SceneToken, t: number): Color => color(a).clone().lerp(color(b), t);
  return {
    theme,
    rgba,
    color,
    css: (t, alpha) => toCss(rgba[t], alpha),
    // Night: the day sky darkened (dark in both themes).
    nightTop: color('sky-top').clone().multiplyScalar(0.06),
    nightHorizon: color('sky-bottom').clone().multiplyScalar(0.1),
    glass: mix('sky-top', 'panel', 0.55).multiplyScalar(0.7),
    gridLine: mix('ground', 'text', 0.22),
    obstacle: mix('wall', 'ground', 0.3),
    horizonFill: mix('ground', 'sky-bottom', 0.3).multiplyScalar(0.8),
    font: style.getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif',
  };
}

// ── Theme subscription ───────────────────────

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const themeSnapshot = (): string => document.documentElement.getAttribute('data-theme') ?? '';

const cache = new Map<string, ScenePalette>();

/**
 * Scene palette of the current theme. Re-read after <html data-theme> changes (MutationObserver), i.e.
 * after the new token values apply — not when the store changes, which happens before the attribute.
 */
export function useScenePalette(): ScenePalette {
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot, () => '');
  let palette = cache.get(theme);
  if (!palette) {
    palette = readPalette(theme);
    cache.set(theme, palette);
  }
  return palette;
}
