import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, hasScrollAnchoring, holdInView } from './holdInView';

// A scroller with a child whose screen position follows a "layout" offset (content above it) and the scroll
// position; rAF and the clock are driven by hand.

let frames: FrameRequestCallback[] = [];
let now = 0;

function step(ms = 16): void {
  now += ms;
  const due = frames;
  frames = [];
  for (const cb of due) cb(now);
}

function setup(opts: { nested?: boolean } = {}) {
  const scroller = opts.nested ? document.createElement('div') : document.documentElement;
  const el = document.createElement('div');
  if (opts.nested) {
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 5000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 800 });
    document.body.append(scroller);
  } else {
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: scroller });
  }
  scroller.append(el);
  const state = { above: 1000, scrollTop: 984, scrolls: 0 };
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => state.scrollTop,
    set: (v: number) => (state.scrollTop = v),
  });
  scroller.scrollBy = ((o: ScrollToOptions) => {
    state.scrollTop += o.top ?? 0;
    state.scrolls++;
  }) as typeof scroller.scrollBy;
  el.getBoundingClientRect = () => ({ top: state.above - state.scrollTop }) as DOMRect;
  return { scroller, el, state };
}

beforeEach(() => {
  frames = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames = [];
  });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.documentElement.style.overflowAnchor = '';
  for (const child of [...document.documentElement.children]) {
    if (child !== document.head && child !== document.body) child.remove();
  }
});

describe('holdInView', () => {
  it('scrolls a layout shift above the element away in the next frame, anchoring off meanwhile', () => {
    const { el, state, scroller } = setup();
    const stop = holdInView(el);
    expect(scroller.style.overflowAnchor).toBe('none');
    step();
    expect(state.scrolls).toBe(0);
    state.above += 232; // a card above grew
    step();
    expect(el.getBoundingClientRect().top).toBe(16);
    state.above -= 231; // and shrank again
    step();
    expect(el.getBoundingClientRect().top).toBe(16);
    stop();
    expect(scroller.style.overflowAnchor).toBe('');
  });

  it('ends when the user touches, scrolls the wheel, presses a pointer or a key', () => {
    for (const type of ['touchstart', 'wheel', 'pointerdown', 'keydown']) {
      const { el, state } = setup();
      holdInView(el);
      step();
      window.dispatchEvent(new Event(type));
      state.above += 100;
      step();
      expect(el.getBoundingClientRect().top, type).toBe(116);
      expect(document.documentElement.style.overflowAnchor, type).toBe('');
    }
  });

  it('ends after a scroll it did not make (a scrollbar drag, a jump elsewhere)', () => {
    const { el, state } = setup();
    holdInView(el);
    step();
    state.scrollTop += 300;
    state.above += 50;
    step();
    step();
    expect(el.getBoundingClientRect().top).toBe(16 - 300 + 50);
  });

  it(`ends after ${HOLD_MS} ms and when the element leaves the document`, () => {
    const { el, state } = setup();
    holdInView(el);
    step(HOLD_MS + 1);
    state.above += 40;
    step();
    expect(el.getBoundingClientRect().top).toBe(56);

    const second = setup();
    holdInView(second.el);
    second.el.remove();
    second.state.above += 40;
    step();
    expect(second.state.scrolls).toBe(0);
  });

  it('is only needed without scroll anchoring (CSS overflow-anchor)', () => {
    vi.stubGlobal('CSS', { supports: (p: string, v: string) => p === 'overflow-anchor' && v === 'auto' });
    expect(hasScrollAnchoring()).toBe(true);
    vi.stubGlobal('CSS', { supports: () => false });
    expect(hasScrollAnchoring()).toBe(false);
    vi.stubGlobal('CSS', undefined);
    expect(hasScrollAnchoring()).toBe(false);
  });

  it('holds within the nearest scrolling ancestor (the sidebar on wide screens)', () => {
    const { el, state, scroller } = setup({ nested: true });
    holdInView(el);
    expect(scroller.style.overflowAnchor).toBe('none');
    expect(document.documentElement.style.overflowAnchor).toBe('');
    state.above += 70;
    step();
    expect(state.scrolls).toBe(1);
    expect(el.getBoundingClientRect().top).toBe(16);
  });
});
