import { useId } from 'react';

/**
 * Instance-unique id prefix for SVG defs (clipPath, pattern, gradient) and title/desc references.
 * React's useId contains characters (":" or "«»") that are awkward inside url(#…), so they are removed.
 */
export function useSvgId(): string {
  return `v${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
}
