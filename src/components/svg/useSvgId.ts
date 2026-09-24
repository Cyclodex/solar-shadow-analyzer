import { useId } from 'react';

/**
 * useId() reduced to characters that are safe inside url(#…) references and CSS selectors (React ids may
 * contain colons or guillemets). Unique per component instance.
 */
export function useSvgId(prefix = 'c'): string {
  return `${prefix}${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
}
