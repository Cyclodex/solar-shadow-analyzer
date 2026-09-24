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
    // Not atomic: only notices that appear are announced, not the whole list again.
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'false');
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

  it('warns about panels reaching below ground, also with a single floor', () => {
    // Ground floor, 113.4 cm module at θ 20°: drop 106.6 cm against a 100 cm railing.
    patch('building', { lowestFloor: 0, numFloors: 1 });
    patch('panels', { tiltFromVertical: 20 });
    render(<WarningsBar />);
    expect(notices()).toEqual([
      'Die Panels der untersten Reihe (EG) reichen 7\u00a0cm unter das Terrain – physisch nicht möglich. ' +
        'Neigung erhöhen, kürzere Module oder Querformat wählen, das Geländer erhöhen oder das unterste ' +
        'Panel-Stockwerk auf 1. OG setzen.',
      'Nur ein Stockwerk: Es gibt keine gegenseitige Verschattung durch Panels.',
    ]);
    const item = screen.getAllByRole('listitem')[0];
    expect(item.className).toMatch(/bad/);
    act(() => useUiStore.getState().setLang('en'));
    expect(notices()[0]).toBe(
      'The panels of the lowest row (Ground floor) reach 7\u00a0cm below ground level – physically impossible. ' +
        'Increase the tilt, choose shorter modules or landscape mounting, raise the railing, or set the lowest ' +
        'panel floor to Floor 1.',
    );
    // Default tilt (θ 45°, drop 80 cm) keeps the ground-floor row above the terrain.
    act(() => patch('panels', { tiltFromVertical: 45 }));
    expect(notices()).toEqual(['Only one floor: panels cannot shade each other.']);
  });

  it('reports weather loading, clear sky and failures', () => {
    useDataStore.getState().setWeather({ status: 'loading' });
    render(<WarningsBar />);
    expect(notices()).toEqual(['Wetterdaten 2025 werden geladen …']);
    act(() =>
      useDataStore.getState().setWeather({ status: 'error', usingFallback: true, error: 'HTTP 429' }),
    );
    expect(notices()[0]).toMatch(/^Die Wetterdaten 2025 \(Open-Meteo\) konnten nicht geladen werden/);
    // The technical detail is the loader's English message: marked as such and kept from page translation.
    const detail = screen.getByText('HTTP 429');
    expect(detail.tagName).toBe('CODE');
    expect(detail).toHaveAttribute('lang', 'en');
    expect(detail).toHaveAttribute('translate', 'no');
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
    // Download progress for the eyes; the live region does not announce every tile.
    act(() => useDataStore.getState().setTerrain({ progress: 7 / 16 }));
    expect(notices()).toEqual(['Geländehorizont wird geladen … 44 %']);
    const pct = screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === ' 44 %');
    expect(pct).toHaveAttribute('aria-hidden', 'true');
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
