import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartTooltip } from './ChartTooltip';

// jsdom has no layout: the tooltip measures 200 × 120 px, its offset parent (the chart root) is 200 × 300 px.
// The chart root starts so far down the 768 px viewport that only its top 200 px are above the 60 px
// control bar of phones.
const BAR = 60;
const VISIBLE = 200;

function place(y: number, withAction: boolean): string {
  const { container } = render(
    <div data-root="">
      <ChartTooltip
        x={100}
        y={y}
        boundsWidth={200}
        boundsHeight={300}
        title="θ 20° · β 70°"
        action={withAction ? { label: 'Neigung 20° übernehmen', onClick: () => {} } : undefined}
      />
    </div>,
  );
  const tooltip = container.querySelector('[data-root] > div') as HTMLElement;
  return tooltip.style.transform;
}

describe('ChartTooltip', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return this.parentElement;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ y: window.innerHeight - BAR - VISIBLE, width: 200, height: 300 }),
    );
    document.documentElement.style.setProperty('--bottom-bar-h', `${BAR}px`);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty('--bottom-bar-h');
  });

  it('goes below the anchor, too narrow beside it (left edge at 0)', () => {
    expect(place(40, false)).toBe('translate(0px, 54px)');
    expect(place(40, true)).toBe('translate(0px, 54px)');
  });

  it('with a button (touch) it goes above the anchor where the control bar would cover it below', () => {
    // Below the anchor (164 … 284 px) fits the chart, but the bar covers the chart from 200 px down.
    expect(place(150, false)).toBe('translate(0px, 164px)');
    expect(place(150, true)).toBe('translate(0px, 16px)');
    // No room above either: at the top of the visible part, the button clear of the bar.
    expect(place(100, true)).toBe('translate(0px, 0px)');
  });

  it('keeps to the chart bounds when the visible part is lower than the tooltip', () => {
    document.documentElement.style.setProperty('--bottom-bar-h', `${BAR + VISIBLE - 100}px`);
    expect(place(150, true)).toBe('translate(0px, 164px)');
  });
});
