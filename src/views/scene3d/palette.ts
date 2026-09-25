import { Color, SRGBColorSpace } from 'three';
import { floorToken, parseCssColor, useThemeKey } from '../../styles/tokens';

// ─────────────────────────────────────────────
// SCENE PALETTE
// The 3D scene takes every colour from the design tokens in src/styles/global.css (no literals here):
// the tokens are read from the computed style of <html> and re-read when data-theme changes.
// Derived colours (night sky, glass, grid lines) are mixes of tokens.
// ─────────────────────────────────────────────

/** sRGB colour, channels 0…1 (parseCssColor returns 0…255 tuples, as the charts' canvas uses them). */
export interface Rgba01 {
  r: number;
  g: number;
  b: number;
  a: number;
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
  'warn',
  'ok',
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

/** Scene token of floor `k`'s colour: floorToken() of src/styles/tokens.ts without the leading "--". */
export function floorSceneToken(k: number): SceneToken {
  return floorToken(k).slice(2) as SceneToken;
}

/** Neutral stand-in for a token that is not defined (CSS not loaded, e.g. in unit tests). */
const MISSING: Rgba01 = { r: 0.5, g: 0.5, b: 0.5, a: 1 };

export interface ScenePalette {
  /** Theme key the palette was read for. */
  theme: string;
  /** Token colours as sRGB (for canvas drawing via css()). */
  rgba: Record<SceneToken, Rgba01>;
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
  /** Surrounding buildings: edited ones tinted warm, manual ones green (as in the site plan). */
  neighbourEdited: Color;
  neighbourManual: Color;
  horizonFill: Color;
  /** Font stack for labels (--font-sans). */
  font: string;
}

function toCss({ r, g, b, a }: Rgba01, alpha = a): string {
  const c = (v: number): number => Math.round(v * 255);
  return `rgb(${c(r)} ${c(g)} ${c(b)} / ${Math.round(alpha * 1000) / 1000})`;
}

/** Reads the scene tokens from the computed style of `root`. */
export function readPalette(theme: string, root: Element = document.documentElement): ScenePalette {
  const style = getComputedStyle(root);
  const rgba = {} as Record<SceneToken, Rgba01>;
  for (const t of TOKENS) {
    const c = parseCssColor(style.getPropertyValue(`--${t}`));
    rgba[t] = c ? { r: c[0] / 255, g: c[1] / 255, b: c[2] / 255, a: c[3] / 255 } : MISSING;
  }
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
  const obstacle = mix('wall', 'ground', 0.3);
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
    obstacle,
    neighbourEdited: obstacle.clone().lerp(color('warn'), 0.45),
    neighbourManual: obstacle.clone().lerp(color('ok'), 0.4),
    horizonFill: mix('ground', 'sky-bottom', 0.3).multiplyScalar(0.8),
    font: style.getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif',
  };
}

const cache = new Map<string, ScenePalette>();

/**
 * Scene palette of the current theme. Re-read after <html data-theme> changes (MutationObserver), i.e.
 * after the new token values apply — not when the store changes, which happens before the attribute.
 */
export function useScenePalette(): ScenePalette {
  const theme = useThemeKey();
  let palette = cache.get(theme);
  if (!palette) {
    palette = readPalette(theme);
    cache.set(theme, palette);
  }
  return palette;
}
