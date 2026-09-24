import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, createObstacle } from '../model/defaults';
import { clearSkyYear } from '../model/weather';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { resetStores } from '../test/utils';
import { estimateTextWidth } from '../components/svg/text';
import { TiltSweepChart } from './TiltSweepChart';

// Focus in these tests stands for keyboard focus (jsdom's :focus-visible depends on earlier events).
vi.mock('./lib/focus', () => ({ isFocusVisible: () => true }));

const series = clearSkyYear(DEFAULT_CONFIG.location.latitude, DEFAULT_CONFIG.location.longitude, 2025);
// jsdom: 600 px fallback width → plot from x = 52 to 584 (532 px) for θ = 0…90°.
const PLOT_W = 532;
const tilt = (): number => useConfigStore.getState().config.panels.tiltFromVertical;
const xOf = (theta: number): number => 52 + (theta / 90) * PLOT_W;

/** x-span of an SVG text (jsdom has no layout: estimated width, as the chart does without a canvas). */
function textSpan(el: Element): [number, number] {
  const x = Number(el.getAttribute('x'));
  const w = estimateTextWidth(el.textContent ?? '', 11);
  return el.getAttribute('text-anchor') === 'end' ? [x - w, x] : [x, x + w];
}

/** Largest screen y (lowest point) of a "M x y L x y …" path between x0 and x1, linear in between. */
function lowestY(d: string, x0: number, x1: number): number {
  const pts = [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const at = (px: number): number => {
    const i = pts.findIndex(([x]) => x >= px);
    if (i <= 0) return pts[i < 0 ? pts.length - 1 : 0][1];
    const [[xa, ya], [xb, yb]] = [pts[i - 1], pts[i]];
    return ya + ((px - xa) / (xb - xa)) * (yb - ya);
  };
  return Math.max(at(x0), at(x1), ...pts.filter(([x]) => x > x0 && x < x1).map(([, y]) => y));
}

describe('TiltSweepChart', () => {
  beforeEach(() => {
    resetStores();
    useConfigStore.getState().patch('horizon', { terrainEnabled: false });
  });

  it('waits for weather data', () => {
    render(<TiltSweepChart />);
    expect(screen.getByText('Der Neigungsvergleich wird berechnet …')).toBeInTheDocument();
  });

  it('draws floors, total, current tilt and optimum', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    const { container } = render(<TiltSweepChart />);
    const img = screen.getByRole('img', { name: 'Neigungsvergleich' });
    expect(img).toHaveAccessibleDescription(
      /^Jahresertrag je Neigung von 0° bis 90°\. Optimum aller Stockwerke bei \d+° mit [\d’']+\skWh\. Aktuelle Neigung 45°\. 2\. OG: Optimum \d+°/,
    );
    expect(container.querySelectorAll('path[stroke^="var(--floor-"]')).toHaveLength(2);
    expect(container.querySelectorAll('path[stroke="var(--text)"]')).toHaveLength(1);
    expect(screen.getByText('θ 45°')).toBeInTheDocument();
    expect(screen.getByText(/^Optimum \d+°$/)).toBeInTheDocument();
    expect(screen.getByText(/Gerechnet in 5°-Schritten\./)).toBeInTheDocument();
  });

  it('is busy while annual inputs load and while the sweep updates after another input changed', () => {
    vi.useFakeTimers();
    useDataStore.getState().setWeather({ status: 'ready', series });
    const { container } = render(<TiltSweepChart />);
    const busy = (): boolean => container.querySelector('[aria-busy="true"]') !== null;
    // Settle timer, then the background sweep it starts.
    const settle = (): void => {
      for (let i = 0; i < 2; i++)
        act(() => {
          vi.runAllTimers();
        });
    };
    expect(busy()).toBe(false);

    // Another input changed: the previous sweep is shown until the new one is computed.
    act(() => useConfigStore.getState().patch('system', { lossesPct: 18 }));
    expect(busy()).toBe(true);
    expect(screen.getByRole('img', { name: 'Neigungsvergleich' })).toBeInTheDocument();
    settle();
    expect(busy()).toBe(false);

    // Terrain horizon (enabled) still loading: the curves are provisional.
    act(() => useDataStore.getState().setTerrain({ status: 'loading' }));
    act(() => useConfigStore.getState().patch('horizon', { terrainEnabled: true }));
    settle();
    expect(busy()).toBe(true);
    act(() => useDataStore.getState().setTerrain({ status: 'error' }));
    expect(busy()).toBe(false);
  });

  it('computes obstacle horizons per tilt (no approximation caption)', () => {
    useConfigStore.getState().patch('horizon', {
      obstacles: [{ ...createObstacle('o1', 'Haus'), distance: 6, height: 10 }],
    });
    useDataStore.getState().setWeather({ status: 'ready', series });
    render(<TiltSweepChart />);
    expect(screen.getByText(/Gerechnet in 5°-Schritten\./)).toBeInTheDocument();
    expect(screen.queryByText(/Hindernis-Horizonte/)).not.toBeInTheDocument();
  });

  it('click on the chart sets the tilt (snapped to the 5° points)', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    render(<TiltSweepChart />);
    const slider = screen.getByRole('slider', { name: 'Neigung im Neigungsvergleich' });
    const x = (26 / 90) * PLOT_W;
    fireEvent.pointerMove(slider, { clientX: x, clientY: 40, pointerId: 1, pointerType: 'mouse' });
    expect(screen.getByText('Klicken übernimmt diese Neigung')).toBeInTheDocument();
    fireEvent.pointerDown(slider, { clientX: x, clientY: 40, pointerId: 1, pointerType: 'mouse', button: 0 });
    fireEvent.pointerUp(slider, { clientX: x, clientY: 40, pointerId: 1, pointerType: 'mouse' });
    expect(tilt()).toBe(25);
    expect(slider).toHaveAttribute('aria-valuenow', '25');
  });

  it('arrow keys step through the sweep points', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    useConfigStore.getState().patch('panels', { tiltFromVertical: 47 });
    render(<TiltSweepChart />);
    const slider = screen.getByRole('slider', { name: 'Neigung im Neigungsvergleich' });
    expect(slider).toHaveAttribute('aria-valuetext', 'θ 47°, β 43°');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(tilt()).toBe(50);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(tilt()).toBe(45);
    expect(slider.getAttribute('aria-valuetext')).toMatch(/^θ 45°, β 45°: Summe [\d’']+\skWh, 2\. OG/);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(tilt()).toBe(0);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(tilt()).toBe(0);
  });

  it('places the optimum label where neither the θ marker nor a curve crosses it', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    const { container } = render(<TiltSweepChart />);
    const label = screen.getByText(/^Optimum \d+°$/);
    const [x0, x1] = textSpan(label);
    const markerX = xOf(45);
    expect(markerX < x0 || markerX > x1).toBe(true);
    const total = container.querySelector('path[stroke="var(--text)"]')!;
    // Below the total curve with room for the glyphs (11 px font, halo).
    expect(Number(label.getAttribute('y')) - 11).toBeGreaterThan(lowestY(total.getAttribute('d')!, x0, x1));

    // Total hidden: the label sits at the foot of the drop line, below every floor curve.
    fireEvent.click(screen.getByRole('button', { name: 'Summe zeigen' }));
    const hidden = screen.getByText(/^Optimum Summe \d+°$/);
    const [h0, h1] = textSpan(hidden);
    expect(markerX < h0 || markerX > h1).toBe(true);
    const y = Number(hidden.getAttribute('y'));
    for (const path of container.querySelectorAll('path[stroke^="var(--floor-"]')) {
      expect(y - 11).toBeGreaterThan(lowestY(path.getAttribute('d')!, h0, h1));
    }
  });

  it('keyboard focus shows the tooltip; Escape hides it without changing the tilt', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    render(<TiltSweepChart />);
    const slider = screen.getByRole('slider', { name: 'Neigung im Neigungsvergleich' });
    act(() => slider.focus());
    expect(screen.getByText('θ 45° · β 45°')).toBeInTheDocument();
    fireEvent.keyDown(slider, { key: 'Escape' });
    expect(screen.queryByText('θ 45° · β 45°')).not.toBeInTheDocument();
    expect(slider).toHaveFocus();
    expect(tilt()).toBe(45);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(screen.getByText('θ 50° · β 40°')).toBeInTheDocument();
  });

  it('the total line can be hidden', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    const { container } = render(<TiltSweepChart />);
    const toggle = screen.getByRole('button', { name: 'Summe zeigen' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelectorAll('path[stroke="var(--text)"]')).toHaveLength(0);
  });
});
