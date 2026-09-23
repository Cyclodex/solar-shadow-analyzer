import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { DEFAULT_CONFIG } from './model/defaults';
import { encodeConfig } from './model/share';
import { useConfigStore } from './state/configStore';
import { useDataStore } from './state/dataStore';
import { useUiStore } from './state/uiStore';
import { initUrlSync } from './state/urlSync';
import { resetStores } from './test/utils';

/** The KPI card (<div> around <dt>) with the given label. */
function kpi(label: string): HTMLElement {
  const dt = screen.getByText(label, { selector: 'dt' });
  return dt.parentElement as HTMLElement;
}

describe('App', () => {
  let stopUrlSync: (() => void) | null = null;

  beforeEach(() => {
    resetStores();
    history.replaceState(null, '', '/');
  });

  afterEach(() => {
    stopUrlSync?.();
    stopUrlSync = null;
  });

  it('renders the German UI', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Verschattungsanalyse' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Zeitpunkt' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Panelneigung' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ansichten' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Analyse' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Uhrzeit (Ortszeit)' })).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/^12:00/),
    );
    expect(screen.getByRole('slider', { name: 'Neigung θ ab Senkrechte' })).toHaveValue('45');
    expect(document.documentElement.lang).toBe('de');
  });

  it('renders in English and the language toggle switches texts', () => {
    useUiStore.getState().setLang('en');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Shading analysis' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Point in time' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Deutsch' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Verschattungsanalyse' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Deutsch' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'English' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Shading analysis' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  it('shows annual kWh from the clear-sky fallback when the weather request fails', async () => {
    render(<App />);
    await waitFor(() => expect(useDataStore.getState().weather.status).toBe('error'), { timeout: 5000 });
    await waitFor(() => expect(kpi('Jahresertrag').textContent).toMatch(/\d[\d’']*\s?kWh/), {
      timeout: 5000,
    });
    expect(kpi('Jahresertrag')).toHaveTextContent('Theoretisches Maximum bei klarem Himmel');
    expect(kpi('Verschattungsverlust').textContent).toMatch(/kWh/);
    expect(kpi('Amortisation').textContent).toMatch(/Jahre|nie/);
    expect(screen.getByText(/konnten nicht geladen werden/)).toBeInTheDocument();
  });

  it('resets the configuration after confirmation', () => {
    render(<App />);
    const tilt = screen.getByRole('slider', { name: 'Neigung θ ab Senkrechte' });
    fireEvent.change(tilt, { target: { value: '70' } });
    expect(useConfigStore.getState().config.panels.tiltFromVertical).toBe(70);
    fireEvent.click(screen.getByRole('button', { name: 'Alle Einstellungen zurücksetzen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, zurücksetzen' }));
    expect(useConfigStore.getState().config).toEqual(DEFAULT_CONFIG);
    expect(screen.getByRole('slider', { name: 'Neigung θ ab Senkrechte' })).toHaveValue('45');
  });

  it('a #c= share hash overrides the stored config', () => {
    useConfigStore.getState().patch('building', { numFloors: 3 });
    const shared = { ...DEFAULT_CONFIG, building: { ...DEFAULT_CONFIG.building, numFloors: 5 } };
    history.replaceState(null, '', `/#c=${encodeConfig(shared)}`);
    act(() => {
      stopUrlSync = initUrlSync();
    });
    render(<App />);
    expect(useConfigStore.getState().config.building.numFloors).toBe(5);
    expect(within(screen.getByRole('banner')).getByText('5 Stockwerke')).toBeInTheDocument();
  });
});
