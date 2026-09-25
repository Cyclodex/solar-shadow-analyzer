import { flushSync } from 'react-dom';
import { useUiStore } from '../state/uiStore';

/**
 * Opens «Standort» and focuses its search: the way to the address search (and the surroundings behind it) from
 * the first screen. The section content renders when it is open, so the search is looked up a frame later.
 */
export function openLocationSearch(): void {
  flushSync(() => useUiStore.getState().setSectionOpen('location', true));
  let frames = 0;
  const focus = (): void => {
    const input = document.querySelector<HTMLInputElement>('input[data-address-search]');
    if (!input) {
      if (++frames < 30) requestAnimationFrame(focus);
      return;
    }
    input.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    input.focus({ preventScroll: true });
  };
  focus();
}
