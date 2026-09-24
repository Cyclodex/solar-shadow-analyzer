import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { dayOfYear } from '../model/time';
import { useConfigStore } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { ShadeHeatmap } from './ShadeHeatmap';

// jsdom: 600 px fallback width → plot 548 × 240 px starting at (44, 8); the overlay's own coordinates are
// relative to the plot (getBoundingClientRect() is all zeros in jsdom, so clientX/Y = plot coordinates).
const PLOT_W = 548;

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
