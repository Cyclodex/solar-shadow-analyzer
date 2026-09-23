import type { CSSProperties } from 'react';

/** Inline style that only sets CSS custom properties: cssVars({ '--pos': 0.5 }). */
export function cssVars(vars: Record<`--${string}`, string | number>): CSSProperties {
  return vars as CSSProperties;
}
