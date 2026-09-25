import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConfigStore } from '../../state/configStore';
import { useDataStore } from '../../state/dataStore';
import { useUiStore } from '../../state/uiStore';
import { resetStores } from '../../test/utils';
import { SurfaceModelControls } from './SurfaceModelControls';

const model = () => useConfigStore.getState().config.horizon.surfaceModel;
/** Text with non-breaking spaces as plain spaces (units and percentages use U+00A0). */
const plain = (s: string | null): string => (s ?? '').replace(/\u00a0/g, ' ');
const enable = (): void =>
  act(() => useConfigStore.getState().patch('horizon', { surfaceModel: { ...model(), enabled: true } }));

describe('SurfaceModelControls', () => {
  beforeEach(resetStores);

  it('offers the laser scan; the settings appear once it is on', () => {
    render(<SurfaceModelControls />);
    const toggle = screen.getByRole('switch', { name: 'Laserscan-Umgebung (swisstopo)' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('switch', { name: 'Bäume berücksichtigen' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(model().enabled).toBe(true);
    expect(screen.getByRole('switch', { name: 'Bäume berücksichtigen' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      screen.getByText('Bäume werden ganzjährig als blickdicht angenommen (Befliegung meist ohne Laub).'),
    ).toBeInTheDocument();
    expect(screen.getByText('Daten: © swisstopo (swissSURFACE3D Raster, swissALTI3D)')).toBeInTheDocument();
  });

  it('trees and radius (with the estimated download) change the config', () => {
    enable();
    render(<SurfaceModelControls />);
    const radius = screen.getByRole('combobox', { name: 'Umkreis' });
    const options = within(radius)
      .getAllByRole('option')
      .map((o) => plain(o.textContent));
    expect(options).toHaveLength(8);
    expect(options[0]).toMatch(/^150 m \(ca\. \d+\.\d MB\)$/);
    expect(options[3]).toMatch(/^300 m \(ca\. 6\.\d MB\)$/);
    expect(options[7]).toMatch(/^500 m \(ca\. 1\d\.\d MB\)$/);
    fireEvent.change(radius, { target: { value: '450' } });
    expect(model().radius).toBe(450);
    fireEvent.click(screen.getByRole('switch', { name: 'Bäume berücksichtigen' }));
    expect(model().trees).toBe(false);
    expect(screen.getByText(/Aus: nur Gebäude/)).toBeInTheDocument();
    // Without trees the ground model and the building tiles are loaded too.
    const more = within(screen.getByRole('combobox', { name: 'Umkreis' }))
      .getAllByRole('option')
      .map((o) => plain(o.textContent));
    expect(more[3]).not.toBe(options[3]);
  });

  it('shows progress while loading', () => {
    enable();
    act(() => useDataStore.getState().setSurface({ status: 'loading', progress: 0.43, bytes: 2_150_000 }));
    render(<SurfaceModelControls />);
    const bar = screen.getByRole('progressbar', { name: 'Fortschritt Laserscan' });
    expect(bar).toHaveAttribute('aria-valuenow', '43');
    expect(plain(bar.getAttribute('aria-valuetext'))).toBe('43 %, 2.2 MB');
    expect(plain(bar.previousElementSibling?.textContent ?? '')).toBe(
      'Laserscan wird geladen … 2.2 MB (43 %)',
    );
  });

  it('shows data year and size when ready, and partial coverage at the border', () => {
    enable();
    act(() =>
      useDataStore.getState().setSurface({
        status: 'ready',
        dataYears: [2019, 2023],
        bytes: 5_010_000,
        coverage: 1,
        horizons: {},
      }),
    );
    const { rerender } = render(<SurfaceModelControls />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Laserscan geladen');
    expect(status).toHaveTextContent('Datenstand 2019, 2023');
    expect(status).toHaveTextContent('5.0 MB Daten');
    expect(status).not.toHaveTextContent('deckt nur');
    act(() => useDataStore.getState().setSurface({ coverage: 0.41 }));
    rerender(<SurfaceModelControls />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Der Laserscan deckt nur 41 % des Umkreises ab: Ausserhalb der Schweiz und Liechtensteins fehlen Gebäude und Bäume.',
    );
  });

  it('outside CH/FL: says where the scan exists', () => {
    enable();
    act(() => useDataStore.getState().setSurface({ status: 'unavailable' }));
    render(<SurfaceModelControls />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Laserscan nur in der Schweiz und Liechtenstein verfügbar.',
    );
  });

  it('an error explains the fallback and retries', () => {
    enable();
    act(() =>
      useDataStore
        .getState()
        .setSurface({ status: 'error', error: 'HTTP 503 for https://data.geo.admin.ch/x' }),
    );
    render(<SurfaceModelControls />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'Der Laserscan konnte nicht geladen werden. Es wird ohne Laserscan gerechnet.',
    );
    expect(alert).toHaveTextContent('Der Server hat mit Fehler 503 geantwortet.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    expect(useDataStore.getState().surfaceAttempt).toBe(1);
  });

  it('English', () => {
    act(() => {
      useUiStore.setState({ lang: 'en' });
    });
    enable();
    act(() => useDataStore.getState().setSurface({ status: 'unavailable' }));
    render(<SurfaceModelControls />);
    expect(screen.getByRole('switch', { name: 'Laser-scan surroundings (swisstopo)' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Include trees' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Laser scan only available in Switzerland and Liechtenstein.',
    );
    expect(screen.getByRole('combobox', { name: 'Radius' })).toBeInTheDocument();
  });
});
