import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { clearSkyYear } from '../model/weather';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { resetStores } from '../test/utils';
import { TiltControl } from './TiltControl';

const { latitude, longitude } = DEFAULT_CONFIG.location;

describe('TiltControl', () => {
  beforeEach(() => {
    resetStores();
    useConfigStore.getState().patch('horizon', { terrainEnabled: false });
  });

  it('shows the optimum of the loaded weather series', () => {
    useDataStore.getState().setWeather({ status: 'ready', series: clearSkyYear(latitude, longitude, 2025) });
    render(<TiltControl />);
    expect(screen.getByText(/^Optimum: \d+°$/)).toBeInTheDocument();
    expect(screen.getByText(/höchster Jahresertrag aller Stockwerke: [\d’']+\skWh/)).toBeInTheDocument();
  });

  it('hides the optimum while new weather data load (the old series belongs to another site)', () => {
    useDataStore.getState().setWeather({ status: 'ready', series: clearSkyYear(latitude, longitude, 2025) });
    render(<TiltControl />);
    expect(screen.getByText(/^Optimum: \d+°$/)).toBeInTheDocument();

    // Location change: the loader keeps the previous series while the new one loads.
    act(() => {
      useConfigStore.getState().patch('location', { latitude: 46.0, longitude: 8.95 });
      useDataStore.getState().setWeather({ status: 'loading' });
    });
    expect(screen.getByText('Optimum wird berechnet …')).toBeInTheDocument();
    expect(screen.queryByText(/^Optimum: /)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /übernehmen/ })).not.toBeInTheDocument();

    act(() =>
      useDataStore.getState().setWeather({ status: 'ready', series: clearSkyYear(46.0, 8.95, 2025) }),
    );
    expect(screen.getByText(/^Optimum: \d+°$/)).toBeInTheDocument();
    expect(screen.queryByText('Optimum wird berechnet …')).not.toBeInTheDocument();
  });
});
