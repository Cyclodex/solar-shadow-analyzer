import type { MouseEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JUMP_REVEAL_ATTR, jumpTo } from './jumpTo';

// jsdom: 768 px viewport, page scrolled to 0; the control bar covers the bottom 60 px.
const BAR = 60;

function setup(targetTop: number, reveal?: { top: number; bottom: number }) {
  const target = document.createElement('section');
  target.id = 'views';
  target.tabIndex = -1;
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: targetTop, height: 1000 }));
  if (reveal) {
    const stage = document.createElement('div');
    stage.setAttribute(JUMP_REVEAL_ATTR, '');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ y: reveal.top, height: reveal.bottom - reveal.top }),
    );
    target.append(stage);
  }
  document.body.append(target);
  const scrollIntoView = vi.fn();
  target.scrollIntoView = scrollIntoView;
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const event = { preventDefault: vi.fn() } as unknown as MouseEvent<HTMLAnchorElement>;
  return { target, scrollIntoView, scrollTo, event };
}

describe('jumpTo', () => {
  beforeEach(() => document.documentElement.style.setProperty('--bottom-bar-h', `${BAR}px`));
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.documentElement.style.removeProperty('--bottom-bar-h');
  });

  it('aligns the target with the top of the screen and focuses it', () => {
    const { target, scrollIntoView, scrollTo, event } = setup(1200);
    jumpTo(event, 'views', { smooth: true });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
  });

  it('keeps the start alignment where the marked part is above the control bar after it', () => {
    // After scrolling by 1200 px, the stage is at 200 … 600 px, above the bar (708 px).
    const { scrollIntoView, scrollTo, event } = setup(1200, { top: 1400, bottom: 1800 });
    jumpTo(event, 'views');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls on until the marked part is above the control bar (short screens)', () => {
    // After the start alignment the stage would be at 250 … 750 px: 50 px more bring it 8 px above the bar.
    const { target, scrollIntoView, scrollTo, event } = setup(1000, { top: 1250, bottom: 1750 });
    jumpTo(event, 'views', { smooth: true });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 + 50, behavior: 'smooth' });
    expect(document.activeElement).toBe(target);
  });

  it('never scrolls the top of the marked part off the screen', () => {
    // A stage taller than the space above the bar: its top ends at the top of the screen.
    const { scrollTo, event } = setup(1000, { top: 1100, bottom: 1900 });
    jumpTo(event, 'views');
    expect(scrollTo).toHaveBeenCalledWith({ top: 1100, behavior: 'auto' });
  });
});
