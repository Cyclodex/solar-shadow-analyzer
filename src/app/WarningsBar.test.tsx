import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useShareLinkStore } from '../state/shareLinkStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { WarningsBar } from './WarningsBar';

const patch = useConfigStore.getState().patch;
const notices = (): string[] =>
  within(screen.getByRole('region', { name: /Hinweise|Notices/ }))
    .queryAllByRole('listitem')
    .map((li) => li.textContent ?? '');
/** Rows overlap: 210 cm modules hanging vertically, 200 cm floor height. */
const overlap = (): void => {
  patch('building', { floorHeight: 200 });
  patch('panels', { length: 210, tiltFromVertical: 0 });
};

describe('WarningsBar', () => {
  beforeEach(() => {
    resetStores();
    patch('horizon', { terrainEnabled: false });
  });

  it('is an empty live region without notices', () => {
    render(<WarningsBar />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(notices()).toEqual([]);
  });

  it('warns about physically overlapping rows (not for a single floor)', () => {
    overlap();
    const { unmount } = render(<WarningsBar />);
    expect(notices()).toEqual([expect.stringMatching(/überlappen sich physisch: Ein Panel reicht 210\scm/)]);
    unmount();
    patch('building', { numFloors: 1 });
    render(<WarningsBar />);
    expect(notices()).toEqual(['Nur ein Stockwerk: Es gibt keine gegenseitige Verschattung durch Panels.']);
  });

  it('reports weather loading, clear sky and failures', () => {
    useDataStore.getState().setWeather({ status: 'loading' });
    render(<WarningsBar />);
    expect(notices()).toEqual(['Wetterdaten 2025 werden geladen …']);
    act(() =>
      useDataStore.getState().setWeather({ status: 'error', usingFallback: true, error: 'HTTP 429' }),
    );
    expect(notices()[0]).toMatch(/^Die Wetterdaten 2025 \(Open-Meteo\) konnten nicht geladen werden/);
    expect(screen.getByText('HTTP 429')).toBeInTheDocument();
    act(() => {
      useDataStore.getState().setWeather({ status: 'ready', error: null, usingFallback: false });
      patch('weather', { source: 'clear-sky' });
    });
    expect(notices()).toEqual([expect.stringMatching(/^Wetterdaten: klarer Himmel/)]);
  });

  it('reports terrain loading and errors only while the terrain horizon is enabled', () => {
    useDataStore.getState().setTerrain({ status: 'error', error: 'Failed to fetch' });
    render(<WarningsBar />);
    expect(notices()).toEqual([]);
    act(() => patch('horizon', { terrainEnabled: true }));
    expect(notices()).toEqual([expect.stringMatching(/^Der Geländehorizont konnte nicht geladen werden\./)]);
    expect(screen.getByText('Details', { selector: 'summary' })).toBeInTheDocument();
    act(() => useDataStore.getState().setTerrain({ status: 'loading', error: null }));
    expect(notices()).toEqual(['Geländehorizont wird geladen …']);
  });

  it('offers to restore the configuration a share link replaced', () => {
    const own = { ...DEFAULT_CONFIG, building: { ...DEFAULT_CONFIG.building, numFloors: 5 } };
    useShareLinkStore.getState().linkApplied(own);
    render(<WarningsBar />);
    expect(notices()[0]).toMatch(/^Konfiguration aus dem geöffneten Link geladen/);
    fireEvent.click(screen.getByRole('button', { name: 'Bisherige Konfiguration wiederherstellen' }));
    expect(useConfigStore.getState().config.building.numFloors).toBe(5);
    expect(notices()[0]).toMatch(/^Vorherige Konfiguration wiederhergestellt\./);
    const close = screen.getByRole('button', { name: 'Hinweis schliessen' });
    expect(close).toHaveFocus();
    fireEvent.click(close);
    expect(notices()).toEqual([]);
  });

  it('reports an invalid share link; each link notice closes on its own', () => {
    useShareLinkStore
      .getState()
      .linkApplied({ ...DEFAULT_CONFIG, building: { ...DEFAULT_CONFIG.building, numFloors: 5 } });
    useShareLinkStore.getState().linkInvalid('saved');
    useUiStore.getState().setLang('en');
    render(<WarningsBar />);
    expect(notices()[0]).toMatch(
      /^The opened share link is invalid or incomplete – showing the saved configuration\./,
    );
    expect(notices()[1]).toMatch(/^Configuration loaded from the opened link/);
    fireEvent.click(screen.getAllByRole('button', { name: 'Close notice' })[0]);
    expect(notices()).toEqual([expect.stringMatching(/^Configuration loaded from the opened link/)]);
  });
});
