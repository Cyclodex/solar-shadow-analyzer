import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNearViewport } from './useNearViewport';

/** IntersectionObserver stand-in: the test reports entries through `report`. */
const observers: {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  el?: Element;
}[] = [];
class FakeObserver {
  private readonly rec: (typeof observers)[number];
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.rec = { callback, options };
    observers.push(this.rec);
  }
  observe(el: Element): void {
    this.rec.el = el;
  }
  unobserve(): void {}
  disconnect(): void {
    observers.splice(observers.indexOf(this.rec), 1);
  }
  takeRecords(): [] {
    return [];
  }
}
const report = (isIntersecting: boolean): void =>
  act(() => {
    for (const o of [...observers])
      o.callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
  });

let renders = 0;
function Probe({ screens }: { screens?: number }) {
  const [ref, near] = useNearViewport<HTMLDivElement>(screens);
  renders++;
  return <div ref={ref}>{near ? 'near' : 'far'}</div>;
}

describe('useNearViewport', () => {
  beforeEach(() => {
    observers.length = 0;
    renders = 0;
    vi.stubGlobal('IntersectionObserver', FakeObserver);
  });

  it('starts near and follows the observed element', () => {
    render(<Probe />);
    expect(screen.getByText('near')).toBeInTheDocument();
    expect(observers).toHaveLength(1);
    expect(observers[0].options?.rootMargin).toBe('100% 0px');
    expect(observers[0].el).toBe(screen.getByText('near'));
    report(false);
    expect(screen.getByText('far')).toBeInTheDocument();
    report(true);
    expect(screen.getByText('near')).toBeInTheDocument();
  });

  it('is near while printing (set synchronously in beforeprint)', () => {
    render(<Probe screens={2} />);
    expect(observers[0].options?.rootMargin).toBe('200% 0px');
    report(false);
    const before = renders;
    window.dispatchEvent(new Event('beforeprint'));
    // Rendered within the event, not later: the print snapshot follows right after the handlers.
    expect(renders).toBeGreaterThan(before);
    expect(screen.getByText('near')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(screen.getByText('far')).toBeInTheDocument();
  });

  it('stays near without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Probe />);
    expect(screen.getByText('near')).toBeInTheDocument();
  });
});
