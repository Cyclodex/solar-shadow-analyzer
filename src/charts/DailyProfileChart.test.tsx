import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConfigStore } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { DailyProfileChart } from './DailyProfileChart';

// jsdom has no layout: the chart renders at the 600 px fallback width, so the plot spans x = 48 … 586
// (538 px). On 21 June at 47.1° N the visible window is 04:00–23:00 (sunrise 05:3x, sunset 21:2x).
const PLOT_W = 538;
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

  it('arrow keys move the selected time in 10-minute steps', () => {
    render(<DailyProfileChart />);
    const slider = screen.getByRole('slider', { name: 'Uhrzeit im Tagesverlauf' });
    expect(slider).toHaveAttribute('aria-valuenow', '720');
    expect(slider).toHaveAttribute('aria-valuemin', String(WIN.start));
    expect(slider.getAttribute('aria-valuetext')).toMatch(/^12:00, 2\. OG \d+\sW, 1\. OG \d+\sW \(\d+\s%/);
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

  it('shows a tooltip with every floor on hover', () => {
    render(<DailyProfileChart />);
    const slider = screen.getByRole('slider', { name: 'Uhrzeit im Tagesverlauf' });
    fireEvent.pointerMove(slider, { clientX: PLOT_W / 2, clientY: 50, pointerId: 1, pointerType: 'mouse' });
    expect(screen.getByText(/^13:30 · Sonnenhöhe/)).toBeInTheDocument();
    expect(screen.getByText('Klicken oder ziehen setzt die Uhrzeit')).toBeInTheDocument();
    fireEvent.pointerLeave(slider, { pointerId: 1, pointerType: 'mouse' });
    expect(screen.queryByText(/^13:30 · Sonnenhöhe/)).not.toBeInTheDocument();
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
