import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { clearSkyYear } from '../model/weather';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { MonthlyYieldChart } from './MonthlyYieldChart';

const series = clearSkyYear(DEFAULT_CONFIG.location.latitude, DEFAULT_CONFIG.location.longitude, 2025);

describe('MonthlyYieldChart', () => {
  beforeEach(() => {
    resetStores();
    useConfigStore.getState().patch('horizon', { terrainEnabled: false });
  });

  it('waits for the simulation', () => {
    render(<MonthlyYieldChart />);
    expect(screen.getByText('Der Jahresertrag wird berechnet …')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('draws grouped bars with hatched losses, totals and the data source', () => {
    useDataStore.getState().setWeather({ status: 'error', series, usingFallback: true });
    const { container } = render(<MonthlyYieldChart />);
    const img = screen.getByRole('img', { name: 'Monatsertrag' });
    expect(img).toHaveAccessibleDescription(
      /^Monatsertrag 2025: total [\d’']+\skWh, Verschattungsverlust \d+\skWh \([\d.]+\s%\)\. Höchster Monat \w+ mit/,
    );
    expect(
      screen.getByText('Datenbasis: klarer Himmel 2025 – theoretisches Maximum, kein reales Wetter.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Jahr 2025')).toBeInTheDocument();
    const solid = container.querySelectorAll('path[fill^="var(--floor-"]');
    const hatched = container.querySelectorAll('path[fill^="url(#"]');
    expect(solid).toHaveLength(24); // 12 months × 2 floors
    expect(hatched.length).toBeGreaterThan(0); // the lower floor loses energy in summer
    expect(container.querySelectorAll('pattern')).toHaveLength(3); // 2 floors + neutral legend hatch
    expect(screen.getByRole('radio', { name: 'Nebeneinander' })).toHaveAttribute('aria-checked', 'true');
  });

  it('switches to stacked columns', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    const { container } = render(<MonthlyYieldChart />);
    fireEvent.click(screen.getByRole('radio', { name: 'Gestapelt' }));
    expect(screen.getByRole('radio', { name: 'Gestapelt' })).toHaveAttribute('aria-checked', 'true');
    // Losses of all floors are one neutral hatched segment per month on top of the stack.
    const lossId = container.querySelectorAll('pattern')[2].id;
    const loss = container.querySelectorAll(`path[fill="url(#${lossId})"]`);
    expect(loss.length).toBeGreaterThan(0);
    expect(loss.length).toBeLessThanOrEqual(12);
  });

  it('keyboard reads out month by month', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    render(<MonthlyYieldChart />);
    const slider = screen.getByRole('slider', { name: 'Monat im Diagramm' });
    act(() => slider.focus());
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '2');
    expect(slider.getAttribute('aria-valuetext')).toMatch(
      /^Februar: 2\. OG \d+\skWh.*, 1\. OG \d+\skWh.*, Total \d+\skWh/,
    );
    expect(screen.getByText('Februar 2025')).toBeInTheDocument(); // tooltip
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider).toHaveAttribute('aria-valuenow', '12');
  });

  it('English and a single floor (no mode switch)', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    act(() => {
      useUiStore.getState().setLang('en');
      useConfigStore.getState().patch('building', { numFloors: 1 });
    });
    render(<MonthlyYieldChart />);
    expect(screen.getByRole('img', { name: 'Monthly yield' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });
});
