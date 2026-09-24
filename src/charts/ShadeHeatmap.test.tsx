import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { dayOfYear } from '../model/time';
import { useConfigStore } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { ShadeHeatmap } from './ShadeHeatmap';

// jsdom: 600 px fallback width → plot 548 × 240 px starting at (44, 8); the overlay's own coordinates are
// relative to the plot (getBoundingClientRect() is all zeros in jsdom, so clientX/Y = plot coordinates).
const PLOT_W = 548;

/**
 * IntersectionObserver whose reports the test sends (report(true) = near the screen); the card starts far
 * below the fold (its section 5000 px down).
 */
function farBelowTheFold(): { report: (near: boolean) => void } {
  const callbacks: IntersectionObserverCallback[] = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: IntersectionObserverCallback) {
        callbacks.push(cb);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): [] {
        return [];
      }
    },
  );
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(DOMRect.fromRect({ y: 5000, height: 500 }));
  onTestFinished(() => rect.mockRestore());
  return {
    report: (near) =>
      act(() => {
        const cb = callbacks.at(-1);
        cb?.([{ isIntersecting: near } as IntersectionObserverEntry], {} as IntersectionObserver);
      }),
  };
}

describe('ShadeHeatmap', () => {
  beforeEach(() => {
    resetStores();
    useConfigStore.getState().patch('horizon', { terrainEnabled: false });
  });

  it('renders a canvas image with a summary and the lit/shaded hours', () => {
    render(<ShadeHeatmap />);
    const img = screen.getByRole('img');
    expect(img.tagName).toBe('CANVAS');
    expect(img).toHaveAccessibleName(
      /^Jahres-Heatmap 2025 für 1\. OG\. Direkte Sonne auf dem Panel: [\d’']+\sh\. Davon \d+\sh \([\d.]+\s%\) durch 2\. OG verschattet\. Am meisten verschattete Stunden im (Mai|Juni|Juli)/,
    );
    expect(screen.getByText('Verschattung von 1. OG durch 2. OG, 2025: Tag × Ortszeit')).toBeInTheDocument();
    expect(screen.getByText('davon verschattet')).toBeInTheDocument();
    // Two floors: only the lower one can be shaded → no floor selector.
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('keeps the year of shade out of the first render (placeholder until the deferred render)', () => {
    // The initial render (as on the server) uses the deferred value's initial value: no heatmap yet.
    const html = renderToString(<ShadeHeatmap />);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('<canvas');
    // The deferred render that follows computes it.
    render(<ShadeHeatmap />);
    expect(screen.getByRole('img').tagName).toBe('CANVAS');
  });

  it('computes only near the screen, keeps its last result far from it and catches up for printing', () => {
    const io = farBelowTheFold();
    render(<ShadeHeatmap />);
    // Far below the fold at load: placeholder, nothing computed.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    io.report(true);
    const img = screen.getByRole('img');
    const at45 = img.getAttribute('aria-label');
    expect(at45).toMatch(/verschattet/);

    // Scrolled away: a tilt change is not computed, the card keeps its result.
    io.report(false);
    act(() => useConfigStore.getState().patch('panels', { tiltFromVertical: 5 }));
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', at45);

    // Printing shows the current result (synchronously, in the beforeprint handler).
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    const at5 = screen.getByRole('img').getAttribute('aria-label');
    expect(at5).not.toBe(at45);
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', at5);

    // Near the screen again: up to date.
    act(() => useConfigStore.getState().patch('panels', { tiltFromVertical: 45 }));
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', at5);
    io.report(true);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', at45);
  });

  it('clicking a cell selects its date and time', () => {
    act(() => useTimeStore.getState().setPlaying(true));
    render(<ShadeHeatmap />);
    const widget = screen.getByRole('application', { name: 'Heatmap 1. OG: Tag und Uhrzeit wählen' });
    const x = (100.5 / 365) * PLOT_W; // day index 100 → 11 April
    fireEvent.pointerDown(widget, {
      clientX: x,
      clientY: 120,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
    });
    fireEvent.pointerUp(widget, { clientX: x, clientY: 120, pointerId: 1, pointerType: 'mouse' });
    const { date, minutes, playing } = useTimeStore.getState();
    expect(date).toBe('2025-04-11');
    expect(dayOfYear(date)).toBe(101);
    expect(minutes % 10).toBe(5); // middle of the 10-minute slot
    expect(playing).toBe(false);
  });

  it('touch: a tap selects; a sideways scrub selects the cell under the finger when lifted', () => {
    render(<ShadeHeatmap />);
    const widget = screen.getByRole('application');
    const touch = { pointerId: 4, pointerType: 'touch' } as const;
    const day = (d: number): number => ((d + 0.5) / 365) * PLOT_W;
    fireEvent.pointerDown(widget, { ...touch, clientX: day(100), clientY: 120 });
    expect(screen.getByText('Tippen oder seitwärts ziehen übernimmt Datum und Uhrzeit')).toBeInTheDocument();
    fireEvent.pointerUp(widget, { ...touch, clientX: day(100), clientY: 120 });
    fireEvent.click(widget, { clientX: day(100), clientY: 120 });
    expect(useTimeStore.getState().date).toBe('2025-04-11');

    fireEvent.pointerDown(widget, { ...touch, clientX: day(100), clientY: 120 });
    fireEvent.pointerMove(widget, { ...touch, clientX: day(150), clientY: 121 });
    expect(screen.getByText(/^31\. Mai 2025 · /)).toBeInTheDocument();
    fireEvent.pointerUp(widget, { ...touch, clientX: day(150), clientY: 121 });
    expect(useTimeStore.getState().date).toBe('2025-05-31');

    // A vertical swipe scrolls the page (pointercancel): nothing selected, no tooltip left open.
    fireEvent.pointerDown(widget, { ...touch, clientX: day(200), clientY: 120 });
    fireEvent.pointerCancel(widget, touch);
    expect(useTimeStore.getState().date).toBe('2025-05-31');
    expect(screen.queryByText(/ · \d\d:\d0–/)).not.toBeInTheDocument();
  });

  it('shows a tooltip on hover and ignores a drag', () => {
    render(<ShadeHeatmap />);
    const widget = screen.getByRole('application');
    fireEvent.pointerMove(widget, { clientX: PLOT_W / 2, clientY: 120, pointerId: 1, pointerType: 'mouse' });
    expect(screen.getByText('Klicken übernimmt Datum und Uhrzeit')).toBeInTheDocument();
    expect(screen.getByText(/^\d+\. \w+ 2025 · \d\d:\d0–\d\d:\d0$/)).toBeInTheDocument();
    fireEvent.pointerDown(widget, {
      clientX: 10,
      clientY: 120,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
    });
    fireEvent.pointerUp(widget, { clientX: 200, clientY: 120, pointerId: 1, pointerType: 'mouse' });
    expect(useTimeStore.getState().date).toBe('2025-06-21');
  });

  it('keyboard: arrows move the cursor, Enter selects', () => {
    render(<ShadeHeatmap />);
    const widget = screen.getByRole('application');
    act(() => widget.focus());
    fireEvent.keyDown(widget, { key: 'ArrowRight' });
    fireEvent.keyDown(widget, { key: 'ArrowDown' });
    expect(
      screen.getByText(/^22\. Juni 2025, 12:10–12:20: /, { selector: '[aria-live]' }),
    ).toBeInTheDocument();
    fireEvent.keyDown(widget, { key: 'Enter' });
    expect(useTimeStore.getState().date).toBe('2025-06-22');
    expect(useTimeStore.getState().minutes).toBe(735);
    fireEvent.keyDown(widget, { key: 'PageUp' });
    fireEvent.keyDown(widget, { key: ' ' });
    expect(useTimeStore.getState().date).toBe('2025-05-22');
  });

  it('marks the same calendar day when the heatmap year differs in leap status', () => {
    act(() => {
      useConfigStore.getState().patch('weather', { source: 'clear-sky', year: 2024 });
      useTimeStore.getState().setDate('2026-09-24');
      useTimeStore.getState().setMinutes(720);
    });
    render(<ShadeHeatmap />);
    const widget = screen.getByRole('application');
    act(() => widget.focus());
    fireEvent.keyDown(widget, { key: 'ArrowLeft' });
    fireEvent.keyDown(widget, { key: 'ArrowRight' });
    expect(
      screen.getByText(/^24\. September 2024, 12:00–12:10: /, { selector: '[aria-live]' }),
    ).toBeInTheDocument();
    fireEvent.keyDown(widget, { key: 'Enter' });
    expect(useTimeStore.getState().date).toBe('2024-09-24');
  });

  it('Escape hides the keyboard cursor and a hover tooltip', () => {
    render(<ShadeHeatmap />);
    const widget = screen.getByRole('application');
    act(() => widget.focus());
    fireEvent.keyDown(widget, { key: 'ArrowRight' });
    expect(screen.getByText('Eingabe übernimmt Datum und Uhrzeit')).toBeInTheDocument();
    fireEvent.keyDown(widget, { key: 'Escape' });
    expect(screen.queryByText('Eingabe übernimmt Datum und Uhrzeit')).not.toBeInTheDocument();
    expect(screen.getByText('', { selector: '[aria-live]' })).toBeInTheDocument();
    expect(widget).toHaveFocus();
    expect(useTimeStore.getState().date).toBe('2025-06-21');
    act(() => widget.blur());
    fireEvent.pointerMove(widget, { clientX: PLOT_W / 2, clientY: 120, pointerId: 1, pointerType: 'mouse' });
    expect(screen.getByText('Klicken übernimmt Datum und Uhrzeit')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByText('Klicken übernimmt Datum und Uhrzeit')).not.toBeInTheDocument();
  });

  it('offers a floor selector with more than two floors (shared focus floor)', () => {
    act(() => useConfigStore.getState().patch('building', { numFloors: 4 }));
    render(<ShadeHeatmap />);
    const group = screen.getByRole('radiogroup', { name: 'Analysiertes Stockwerk' });
    const options = within(group).getAllByRole('radio');
    expect(options.map((o) => o.textContent)).toEqual(['1. OG', '2. OG', '3. OG']);
    fireEvent.click(within(group).getByRole('radio', { name: '2. OG' }));
    expect(useUiStore.getState().focusFloor).toBe(1);
    expect(screen.getByText('Verschattung von 2. OG durch 3. OG, 2025: Tag × Ortszeit')).toBeInTheDocument();
  });

  it('never analyses the top floor when a lower one exists; one floor has no shading', () => {
    act(() => useUiStore.getState().setFocusFloor(1));
    const { unmount } = render(<ShadeHeatmap />);
    expect(screen.getByText('Verschattung von 1. OG durch 2. OG, 2025: Tag × Ortszeit')).toBeInTheDocument();
    unmount();
    act(() => useConfigStore.getState().patch('building', { numFloors: 1 }));
    render(<ShadeHeatmap />);
    expect(
      screen.getByText('Direkte Sonne auf 1. OG, 2025: Tag × Ortszeit – keine Panels darüber'),
    ).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(/Keine Panels darüber/);
    expect(screen.queryByText('davon verschattet')).not.toBeInTheDocument();
  });
});
