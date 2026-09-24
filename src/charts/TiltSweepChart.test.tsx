import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { clearSkyYear } from '../model/weather';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { resetStores } from '../test/utils';
import { TiltSweepChart } from './TiltSweepChart';

const series = clearSkyYear(DEFAULT_CONFIG.location.latitude, DEFAULT_CONFIG.location.longitude, 2025);
// jsdom: 600 px fallback width → plot from x = 52 to 584 (532 px) for θ = 0…90°.
const PLOT_W = 532;
const tilt = (): number => useConfigStore.getState().config.panels.tiltFromVertical;

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
