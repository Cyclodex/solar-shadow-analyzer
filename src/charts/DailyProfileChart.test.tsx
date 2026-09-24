import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { useConfigStore } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { DailyProfileChart } from './DailyProfileChart';

// Focus in these tests stands for keyboard focus (jsdom's :focus-visible depends on earlier events).
vi.mock('./lib/focus', () => ({ isFocusVisible: () => true }));

// jsdom has no layout: the chart renders at the 600 px fallback width, so the plot spans x = 48 … 582
// (534 px). On 21 June at 47.1° N the visible window is 04:00–23:00 (sunrise 05:3x, sunset 21:2x).
const PLOT_W = 534;
const WIN = { start: 240, end: 1380 };
const minutesAt = (x: number): number =>
  Math.round((WIN.start + (x / PLOT_W) * (WIN.end - WIN.start)) / 5) * 5;

describe('DailyProfileChart', () => {
  beforeEach(() => {
    resetStores();
    useConfigStore.getState().patch('horizon', { terrainEnabled: false });
  });

  it('draws one line per floor with a text summary', () => {
    const { container } = render(<DailyProfileChart />);
    const img = screen.getByRole('img', { name: 'Tagesverlauf' });
    expect(img).toHaveAccessibleDescription(
      /21\. Juni 2025.*Spitze.*Sonnenaufgang 05:\d\d, Sonnenuntergang 21:\d\d/,
    );
    expect(img).toHaveAccessibleDescription(/1\. OG verschattet \d\d:\d\d–\d\d:\d\d/);
    expect(container.querySelectorAll('path[stroke^="var(--floor-"]')).toHaveLength(2);
    // Legend inside the SVG (part of the PNG export)
    expect(screen.getByText('Verschattung durch oberes Stockwerk')).toBeInTheDocument();
    expect(screen.getByText(/^Aufgang 05:\d\d$/)).toBeInTheDocument();
  });

  it('fits sunrise/sunset labels and the legend into a narrow phone width', () => {
    // An iPhone SE card: the chart root is 262 px wide.
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(DOMRect.fromRect({ width: 262 }));
    onTestFinished(() => rect.mockRestore());
    render(<DailyProfileChart />);
    // "Aufgang 05:3x" and "Untergang 21:2x" would overlap: times only.
    expect(screen.getByText(/^05:\d\d$/, { selector: 'text' })).toBeInTheDocument();
    expect(screen.getByText(/^21:\d\d$/, { selector: 'text' })).toBeInTheDocument();
    expect(screen.queryByText(/^Aufgang/)).not.toBeInTheDocument();
    // The long legend label (estimated 258 px incl. swatch in jsdom) moves left to end inside the SVG.
    const legend = screen.getByText('Verschattung durch oberes Stockwerk').closest('g[aria-hidden]');
    const x = Number(/translate\(([\d.]+) /.exec(legend?.getAttribute('transform') ?? '')?.[1]);
    expect(x).toBeLessThanOrEqual(262 - 258);
  });

  it('keeps the words of the sunrise/sunset labels while a small gap stays between them', () => {
    // Chart widths where the estimated labels (81 and 93 px, 4 px from their lines) leave a gap of about
    // 5.6 px (290 px) and 3.6 px (288 px) between them.
    const labels = (width: number): string[] => {
      const rect = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue(DOMRect.fromRect({ width }));
      const { container, unmount } = render(<DailyProfileChart />);
      const texts = [...container.querySelectorAll('text[text-anchor="start"], text[text-anchor="end"]')]
        .map((t) => t.textContent ?? '')
        .filter((t) => /\d\d:\d\d$/.test(t));
      unmount();
      rect.mockRestore();
      return texts;
    };
    expect(labels(290)).toEqual([
      expect.stringMatching(/^Aufgang 05:\d\d$/),
      expect.stringMatching(/^Untergang 21:\d\d$/),
    ]);
    expect(labels(288)).toEqual([expect.stringMatching(/^05:\d\d$/), expect.stringMatching(/^21:\d\d$/)]);
  });

  it('keeps the legend at the plot edge where it fits', () => {
    const { container } = render(<DailyProfileChart />);
    const legend = screen.getByText('Verschattung durch oberes Stockwerk').closest('g[aria-hidden]');
    expect(legend).toHaveAttribute('transform', 'translate(48 4)');
    expect(container.querySelector('svg')).toHaveAttribute('width', '600');
  });

  it('arrow keys move the selected time in 10-minute steps', () => {
    render(<DailyProfileChart />);
    const slider = screen.getByRole('slider', { name: 'Uhrzeit im Tagesverlauf' });
    expect(slider).toHaveAttribute('aria-valuenow', '720');
    expect(slider).toHaveAttribute('aria-valuemin', String(WIN.start));
    expect(slider.getAttribute('aria-valuetext')).toMatch(
      /^12:00, 2\. OG \d+\sW, 1\. OG \d+\sW \(\d+\s% der Fläche verschattet\)/,
    );
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(useTimeStore.getState().minutes).toBe(730);
    fireEvent.keyDown(slider, { key: 'ArrowLeft', shiftKey: true });
    expect(useTimeStore.getState().minutes).toBe(720);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(useTimeStore.getState().minutes).toBe(WIN.end);
    expect(slider).toHaveAttribute('aria-valuenow', String(WIN.end));
  });

  it('click and drag set the time and stop the animation', () => {
    act(() => useTimeStore.getState().setPlaying(true));
    render(<DailyProfileChart />);
    const slider = screen.getByRole('slider', { name: 'Uhrzeit im Tagesverlauf' });
    fireEvent.pointerDown(slider, {
      clientX: 269,
      clientY: 50,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
    });
    expect(useTimeStore.getState().minutes).toBe(minutesAt(269));
    expect(useTimeStore.getState().playing).toBe(false);
    fireEvent.pointerMove(slider, { clientX: 100, clientY: 50, pointerId: 1, pointerType: 'mouse' });
    expect(useTimeStore.getState().minutes).toBe(minutesAt(100));
    fireEvent.pointerUp(slider, { clientX: 100, clientY: 50, pointerId: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(slider, { clientX: 300, clientY: 50, pointerId: 1, pointerType: 'mouse' });
    expect(useTimeStore.getState().minutes).toBe(minutesAt(100));
  });

  it('touch: a vertical swipe (pointercancel) neither sets the time nor leaves a tooltip', () => {
    render(<DailyProfileChart />);
    const slider = screen.getByRole('slider', { name: 'Uhrzeit im Tagesverlauf' });
    const touch = { pointerId: 3, pointerType: 'touch' } as const;
    fireEvent.pointerDown(slider, { ...touch, clientX: 100, clientY: 80 });
    expect(screen.getByText(/· Sonnenhöhe/)).toBeInTheDocument();
    fireEvent.pointerMove(slider, { ...touch, clientX: 102, clientY: 60 });
    fireEvent.pointerCancel(slider, touch);
    expect(useTimeStore.getState().minutes).toBe(720);
    expect(screen.queryByText(/· Sonnenhöhe/)).not.toBeInTheDocument();
  });

  it('touch: a tap sets the time; a sideways drag scrubs and is undone if the page scrolls after all', () => {
    act(() => useTimeStore.getState().setPlaying(true));
    render(<DailyProfileChart />);
    const slider = screen.getByRole('slider', { name: 'Uhrzeit im Tagesverlauf' });
    const touch = { pointerId: 3, pointerType: 'touch' } as const;
    fireEvent.pointerDown(slider, { ...touch, clientX: 100, clientY: 80 });
    fireEvent.pointerUp(slider, { ...touch, clientX: 101, clientY: 81 });
    expect(useTimeStore.getState().minutes).toBe(720); // the click that follows a tap selects
    fireEvent.click(slider, { clientX: 101, clientY: 81 });
    expect(useTimeStore.getState().minutes).toBe(minutesAt(101));
    expect(screen.getByText('Tippen oder seitwärts ziehen setzt die Uhrzeit')).toBeInTheDocument();

    act(() => useTimeStore.getState().setPlaying(true));
    fireEvent.pointerDown(slider, { ...touch, clientX: 200, clientY: 80 });
    fireEvent.pointerMove(slider, { ...touch, clientX: 205, clientY: 80 }); // within the slop
    expect(useTimeStore.getState().minutes).toBe(minutesAt(101));
    fireEvent.pointerMove(slider, { ...touch, clientX: 300, clientY: 82 });
    expect(useTimeStore.getState().minutes).toBe(minutesAt(300));
    expect(useTimeStore.getState().playing).toBe(false);
    fireEvent.pointerCancel(slider, touch);
    expect(useTimeStore.getState().minutes).toBe(minutesAt(101));
    expect(useTimeStore.getState().playing).toBe(true);

    fireEvent.pointerDown(slider, { ...touch, clientX: 200, clientY: 80 });
    fireEvent.pointerMove(slider, { ...touch, clientX: 300, clientY: 82 });
    fireEvent.pointerUp(slider, { ...touch, clientX: 300, clientY: 82 });
    expect(useTimeStore.getState().minutes).toBe(minutesAt(300));
  });

  it('shows a tooltip with every floor on hover', () => {
    render(<DailyProfileChart />);
    const slider = screen.getByRole('slider', { name: 'Uhrzeit im Tagesverlauf' });
    fireEvent.pointerMove(slider, { clientX: PLOT_W / 2, clientY: 50, pointerId: 1, pointerType: 'mouse' });
    expect(screen.getByText(/^13:30 · Sonnenhöhe/)).toBeInTheDocument();
    expect(screen.getByText('Klicken oder ziehen setzt die Uhrzeit')).toBeInTheDocument();
    fireEvent.pointerLeave(slider, { pointerId: 1, pointerType: 'mouse' });
    expect(screen.queryByText(/^13:30 · Sonnenhöhe/)).not.toBeInTheDocument();
  });

  it('keyboard focus shows the readout; Escape hides it and a hover tooltip', () => {
    render(<DailyProfileChart />);
    const slider = screen.getByRole('slider', { name: 'Uhrzeit im Tagesverlauf' });
    act(() => slider.focus());
    // Focus alone shows the selected time's readout without changing it.
    expect(screen.getByText(/^12:00 · Sonnenhöhe/)).toBeInTheDocument();
    expect(useTimeStore.getState().minutes).toBe(720);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(screen.getByText(/^12:10 · Sonnenhöhe/)).toBeInTheDocument();
    fireEvent.keyDown(slider, { key: 'Escape' });
    expect(screen.queryByText(/^12:10 · Sonnenhöhe/)).not.toBeInTheDocument();
    expect(slider).toHaveFocus();
    expect(useTimeStore.getState().minutes).toBe(730);
    // Hover tooltip: Escape closes it wherever the focus is.
    act(() => slider.blur());
    fireEvent.pointerMove(slider, { clientX: PLOT_W / 2, clientY: 50, pointerId: 1, pointerType: 'mouse' });
    expect(screen.getByText(/^13:30 · Sonnenhöhe/)).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByText(/^13:30 · Sonnenhöhe/)).not.toBeInTheDocument();
  });

  it('draws shaded periods in the colour and opacity of their legend swatch', () => {
    const { container } = render(<DailyProfileChart />);
    const shades = [...container.querySelectorAll('rect[fill^="var(--seq-"]')];
    // One legend swatch plus one band per shaded period.
    expect(shades.length).toBeGreaterThan(1);
    const looks = new Set(shades.map((r) => `${r.getAttribute('fill')} ${r.getAttribute('fill-opacity')}`));
    expect([...looks]).toEqual(['var(--seq-5) 0.3']);
  });

  it('keeps the polar-night note legible over the time marker', () => {
    act(() => {
      useConfigStore.getState().patch('location', {
        latitude: 69.65,
        longitude: 18.96,
        timezone: 'Europe/Oslo',
      });
      useTimeStore.getState().setDate('2025-12-21');
    });
    render(<DailyProfileChart />);
    const note = screen.getByText('Polarnacht: Die Sonne geht nicht auf.', { selector: 'text' });
    expect(note.getAttribute('class')).toMatch(/halo/);
  });

  it('has an hourly table twin and English texts', () => {
    act(() => useUiStore.getState().setLang('en'));
    render(<DailyProfileChart />);
    expect(screen.getByRole('img', { name: 'Daily profile' })).toBeInTheDocument();
    const summary = screen.getByText('Values as a table');
    const details = summary.closest('details')!;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    const table = screen.getByRole('table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength((WIN.end - WIN.start) / 60 + 1);
    expect(screen.getByRole('columnheader', { name: 'Sun altitude' })).toBeInTheDocument();
  });
});
