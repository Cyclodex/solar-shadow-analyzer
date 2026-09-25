import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { Footer } from './Footer';

describe('Footer', () => {
  beforeEach(() => {
    resetStores();
  });

  it('attributes the data sources in German, marking the quoted English licence text', () => {
    const { container } = render(<Footer />);
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('Wetterdaten von Open-Meteo.com, Lizenz CC BY 4.0.');
    expect(footer).toHaveTextContent('Modellauswahl best_match: ERA5-Reanalyse');
    expect(footer).toHaveTextContent(
      'Open-Meteo Geocoding API: Ortssuche; Ortsdaten von GeoNames, Lizenz CC BY 4.0.',
    );
    expect(footer).not.toHaveTextContent(/Weather data by/);
    expect(footer).toHaveTextContent(/swisstopo \(geo\.admin\.ch\): Adresssuche.*© swisstopo/);
    expect(footer).toHaveTextContent(
      'EU-DEM (produced using Copernicus data and information funded by the European Union), 3DEP/NED',
    );
    const english = Array.from(container.querySelectorAll('[lang="en"]'), (el) => el.textContent);
    expect(english).toEqual(['produced using Copernicus data and information funded by the European Union']);
  });

  it('renders the English attribution without language switches', () => {
    const { container } = render(<Footer />);
    act(() => useUiStore.getState().setLang('en'));
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('Weather data by Open-Meteo.com, licence CC BY 4.0.');
    expect(footer).toHaveTextContent('Open-Meteo Geocoding API: Place search; place data by GeoNames');
    expect(footer).toHaveTextContent(/swisstopo \(geo\.admin\.ch\): Address search.*© swisstopo/);
    expect(footer).toHaveTextContent(
      'EU-DEM (produced using Copernicus data and information funded by the European Union), 3DEP/NED',
    );
    expect(container.querySelector('[lang]')).toBeNull();
  });
});
