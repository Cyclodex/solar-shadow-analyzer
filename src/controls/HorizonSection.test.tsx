import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createObstacle } from '../model/defaults';
import { MAX_OBSTACLES } from '../model/share';
import { useTerrainLoader } from '../hooks/useTerrain';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { HorizonSection } from './HorizonSection';

/** A failing tile download is retried TILE_RETRIES times with backoff before the loader reports the error. */
const RETRY_WAIT = { timeout: 5000 };

/** Section plus the terrain loader, which performs the retries. */
function WithLoader() {
  useTerrainLoader();
  return <HorizonSection />;
}

const horizon = () => useConfigStore.getState().config.horizon;

/** Expand/collapse button of an obstacle (the remove button starts with the same name). */
function obstacleToggle(name: string): HTMLElement {
  const toggle = screen
    .getAllByRole('button', { name: new RegExp(`^${name}`) })
    .find((b) => b.hasAttribute('aria-expanded'));
  if (!toggle) throw new Error(`no toggle for ${name}`);
  return toggle;
}

/** Terrain profile with a single hill of `peak`° at azimuth 151°. */
function hill(peak: number): number[] {
  return Array.from(
    { length: 360 },
    (_, az) => Math.round(peak * Math.exp(-(((az - 151) / 20) ** 2)) * 100) / 100,
  );
}

const PVGIS_JSON = JSON.stringify({
  inputs: { location: { latitude: 47.1, longitude: 7.45 } },
  outputs: {
    horizon_profile: [
      { A: -180, H_hor: 1.1 },
      { A: -90, H_hor: 2.3 },
      { A: 0, H_hor: 5.4 },
      { A: 90, H_hor: 3.2 },
      { A: 180, H_hor: 1.1 },
    ],
  },
});

describe('HorizonSection', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.setState({ openSections: { horizon: true } });
  });

  describe('terrain', () => {
    it('shows the download progress', () => {
      useDataStore.getState().setTerrain({ status: 'loading', progress: 0.4 });
      render(<HorizonSection />);
      const bar = screen.getByRole('progressbar', { name: 'Fortschritt Geländehorizont' });
      expect(bar).toHaveAttribute('aria-valuenow', '40');
    });

    it('summarises a loaded horizon: site elevation and highest angle', () => {
      useDataStore.getState().setTerrain({
        status: 'ready',
        progress: 1,
        profile: { stepDeg: 1, elevations: hill(8.9) },
        siteElevation: 549.3,
      });
      render(<HorizonSection />);
      expect(screen.getByText('Höhe am Standort (Geländemodell)').nextSibling).toHaveTextContent(/^549\sm$/);
      expect(screen.getByText('Höchster Geländewinkel (vom 1. OG aus)').nextSibling).toHaveTextContent(
        '8.9° bei 151° (SSO)',
      );
    });

    it('translates the cause of a failed download and marks the raw message as English', () => {
      useDataStore.getState().setTerrain({ status: 'error', error: 'No elevation data at the site' });
      render(<HorizonSection />);
      expect(screen.getByText(/Der Geländehorizont konnte nicht geladen werden/)).toBeInTheDocument();
      expect(screen.getByText('Für diesen Standort gibt es keine Höhendaten.')).toBeInTheDocument();
      const raw = screen.getByText('No elevation data at the site');
      expect(raw).toHaveAttribute('lang', 'en');
      expect(raw.closest('details')).not.toHaveAttribute('open');
    });

    it('retries a failed download (here served from the result cache)', async () => {
      render(<WithLoader />);
      // fetch is disabled in tests: the first download fails (after the tile retries).
      await waitFor(() => expect(useDataStore.getState().terrain.status).toBe('error'), RETRY_WAIT);
      expect(screen.getByText(/konnte nicht geladen werden/)).toBeInTheDocument();
      expect(screen.getByText(/network disabled/)).toHaveAttribute('lang', 'en');
      expect(screen.getByText('Keine Verbindung zum Server (offline oder blockiert).')).toBeInTheDocument();
      // Default config: 47.1 / 7.45, observer height 4 m (railing top of the 1st floor, rounded).
      localStorage.setItem(
        'ssa.terrain.v1:47.10000,7.45000,4.0',
        JSON.stringify({ t: 1, stepDeg: 1, e: hill(6), siteElevation: 612.4, tiles: 20 }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
      await waitFor(() => expect(useDataStore.getState().terrain.status).toBe('ready'));
      expect(useDataStore.getState().terrain.siteElevation).toBe(612.4);
      expect(await screen.findByText('6.0° bei 151° (SSO)')).toBeInTheDocument();
    });

    it('keeps the error when the retry fails again', async () => {
      render(<WithLoader />);
      await waitFor(() => expect(useDataStore.getState().terrain.status).toBe('error'), RETRY_WAIT);
      fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
      expect(useDataStore.getState().terrain.status).toBe('loading');
      await waitFor(() => expect(useDataStore.getState().terrain.status).toBe('error'), RETRY_WAIT);
      expect(useDataStore.getState().terrain.error).toMatch(/network disabled/);
    });

    it('toggles the terrain horizon', () => {
      render(<HorizonSection />);
      fireEvent.click(screen.getByRole('switch', { name: 'Geländehorizont berechnen' }));
      expect(horizon().terrainEnabled).toBe(false);
      expect(screen.getByRole('button', { name: /Horizont & Umgebung/ })).toHaveTextContent('Freie Sicht');
    });
  });

  describe('obstacles', () => {
    it('adds, edits and removes an obstacle', () => {
      render(<HorizonSection />);
      expect(screen.getByText('Keine Hindernisse erfasst.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Hindernis hinzufügen' }));
      expect(horizon().obstacles).toEqual([createObstacle('o1', 'Hindernis 1')]);
      const toggle = obstacleToggle('Hindernis 1');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle).toHaveFocus();
      expect(screen.getByText('Hindernis 1 hinzugefügt.')).toBeInTheDocument();

      const item = screen.getByRole('group', { name: 'Hindernis 1' });
      const name = within(item).getByRole('textbox', { name: 'Bezeichnung' });
      fireEvent.change(name, { target: { value: 'Pappel' } });
      fireEvent.blur(name);
      for (const [label, value] of [
        ['Abstand zur Fassade', '30'],
        ['Versatz entlang der Fassade', '-5'],
        ['Breite (entlang der Fassade)', '8'],
        ['Tiefe (von der Fassade weg)', '6'],
        ['Höhe über Boden', '25'],
      ] as const) {
        const field = within(item).getByRole('textbox', { name: label });
        fireEvent.change(field, { target: { value } });
        fireEvent.blur(field);
      }
      expect(horizon().obstacles[0]).toEqual({
        id: 'o1',
        name: 'Pappel',
        offsetAlong: -5,
        distance: 30,
        width: 8,
        depth: 6,
        height: 25,
      });
      // Seen from the 1st floor's panel centre (3.4 m): the summary names the elevation angle.
      expect(obstacleToggle('Pappel')).toHaveTextContent(/Höhenwinkel bis \d+\.\d° \(vom 1\. OG aus\)/);

      fireEvent.click(obstacleToggle('Pappel'));
      expect(obstacleToggle('Pappel')).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(screen.getByRole('button', { name: 'Pappel entfernen' }));
      expect(horizon().obstacles).toEqual([]);
      expect(screen.getByRole('button', { name: 'Hindernis hinzufügen' })).toHaveFocus();
      expect(screen.getByText('Pappel entfernt.')).toBeInTheDocument();
    });

    it('reports an obstacle lower than the panels', () => {
      act(() =>
        useConfigStore.getState().patch('horizon', {
          obstacles: [{ ...createObstacle('o1', 'Hecke'), height: 2 }],
        }),
      );
      render(<HorizonSection />);
      expect(obstacleToggle('Hecke')).toHaveTextContent(
        'Niedriger als die Panelmitte im 1. OG: dort ohne Einfluss auf den Horizont',
      );
    });

    it(`allows at most ${MAX_OBSTACLES} obstacles`, () => {
      const many = Array.from({ length: MAX_OBSTACLES }, (_, i) => createObstacle(`o${i + 1}`, `H${i + 1}`));
      act(() => useConfigStore.getState().patch('horizon', { obstacles: many }));
      render(<HorizonSection />);
      const add = screen.getByRole('button', { name: 'Hindernis hinzufügen' });
      expect(add).toHaveAttribute('aria-disabled', 'true');
      expect(add).toHaveAccessibleDescription(`Maximal ${MAX_OBSTACLES} Hindernisse.`);
      fireEvent.click(add);
      expect(horizon().obstacles).toHaveLength(MAX_OBSTACLES);
    });
  });

  describe('custom horizon import', () => {
    it('imports pasted CSV', () => {
      render(<HorizonSection />);
      const text = screen.getByRole('textbox', { name: 'Oder Daten einfügen' });
      const apply = screen.getByRole('button', { name: 'Eingefügte Daten übernehmen' });
      expect(apply).toBeDisabled();
      fireEvent.change(text, { target: { value: 'azimuth;elevation\n0;2\n90;5\n180;10,5\n270;4\n' } });
      fireEvent.click(apply);
      expect(horizon().manual).toEqual([
        { azimuth: 0, elevation: 2 },
        { azimuth: 90, elevation: 5 },
        { azimuth: 180, elevation: 10.5 },
        { azimuth: 270, elevation: 4 },
      ]);
      expect(screen.getByText('4 Punkte aus CSV-Daten übernommen.')).toBeInTheDocument();
      expect(screen.getByText('4 Punkte, höchster Wert 10.5° bei 180.0° (S)')).toBeInTheDocument();
      expect(text).toHaveValue('');
    });

    it('imports a PVGIS file and converts its azimuths to north-based', async () => {
      render(<HorizonSection />);
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input).not.toBeNull();
      const file = new File([PVGIS_JSON], 'horizon.json', { type: 'application/json' });
      fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
      expect(await screen.findByText('4 Punkte aus PVGIS-Daten übernommen.')).toBeInTheDocument();
      expect(horizon().manual).toEqual([
        { azimuth: 0, elevation: 1.1 },
        { azimuth: 90, elevation: 2.3 },
        { azimuth: 180, elevation: 5.4 },
        { azimuth: 270, elevation: 3.2 },
      ]);
    });

    it('resamples very dense input to the stored maximum', () => {
      const lines = Array.from({ length: 3600 }, (_, i) => `${(i / 10).toFixed(1)},${(i % 50) / 10}`);
      render(<HorizonSection />);
      fireEvent.change(screen.getByRole('textbox', { name: 'Oder Daten einfügen' }), {
        target: { value: lines.join('\n') },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Eingefügte Daten übernehmen' }));
      expect(horizon().manual).toHaveLength(720);
      expect(horizon().manual[719].azimuth).toBe(359.5);
      expect(screen.getByText(/Auf ein Raster mit 720 Punkten umgerechnet/)).toBeInTheDocument();
    });

    it('rejects text without horizon points and clears existing points', () => {
      act(() => useConfigStore.getState().patch('horizon', { manual: [{ azimuth: 180, elevation: 3 }] }));
      render(<HorizonSection />);
      fireEvent.change(screen.getByRole('textbox', { name: 'Oder Daten einfügen' }), {
        target: { value: 'hello world' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Eingefügte Daten übernehmen' }));
      expect(screen.getByText('Keine gültigen Horizontpunkte gefunden.')).toBeInTheDocument();
      expect(horizon().manual).toHaveLength(1);

      fireEvent.click(screen.getByRole('button', { name: 'Punkte entfernen' }));
      expect(horizon().manual).toEqual([]);
      expect(screen.getByText('Keine eigenen Horizontpunkte.')).toBeInTheDocument();
    });

    it('links to the PVGIS horizon of the site', () => {
      render(<HorizonSection />);
      const link = screen.getByRole('link', { name: /PVGIS-Horizont für diesen Standort öffnen/ });
      expect(link).toHaveAttribute('href', expect.stringContaining('printhorizon?lat=47.1&lon=7.45'));
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  describe('horizon chart', () => {
    it('plots the terrain horizon seen from the focus floor', () => {
      // Rail tops of 3 floors at 4, 7 and 9 m (rounded): the lower floors see the higher horizon.
      act(() => {
        useConfigStore.getState().patch('building', { numFloors: 3 });
        useDataStore.getState().setTerrain({
          status: 'ready',
          profile: { stepDeg: 1, elevations: hill(8.9) },
          profiles: {
            4: { stepDeg: 1, elevations: hill(8.9) },
            9: { stepDeg: 1, elevations: hill(6.2) },
          },
        });
      });
      render(<HorizonSection />);
      const plot = screen.getByRole('group', { name: 'Horizont vor der Fassade' });
      expect(plot).toHaveAccessibleDescription(/Höchste Werte: Gelände 8\.9° bei/);
      expect(screen.getByText(/vom 1\. OG aus$/)).toBeInTheDocument();
      act(() => useUiStore.getState().setFocusFloor(2));
      expect(plot).toHaveAccessibleDescription(/Höchste Werte: Gelände 6\.2° bei/);
      expect(screen.getByText(/vom 3\. OG aus$/)).toBeInTheDocument();
      // The terrain summary stays that of the lowest floor.
      expect(screen.getByText('Höchster Geländewinkel (vom 1. OG aus)').nextSibling).toHaveTextContent(
        '8.9° bei 151° (SSO)',
      );
    });

    it('is absent without any horizon', () => {
      act(() => useConfigStore.getState().patch('horizon', { terrainEnabled: false }));
      render(<HorizonSection />);
      expect(screen.queryByRole('group', { name: 'Horizont vor der Fassade' })).not.toBeInTheDocument();
    });

    it('plots the sources and reads out values with the keyboard', () => {
      act(() =>
        useConfigStore.getState().patch('horizon', {
          terrainEnabled: false,
          obstacles: [createObstacle('o1', 'Block')],
          manual: [
            { azimuth: 0, elevation: 4 },
            { azimuth: 180, elevation: 4 },
          ],
        }),
      );
      render(<HorizonSection />);
      const plot = screen.getByRole('group', { name: 'Horizont vor der Fassade' });
      expect(plot).toHaveAccessibleDescription(/Höchste Werte: Hindernisse .*; Eigene Punkte 4\.0° bei/);
      expect(screen.getByText('Höchstwerte im Bereich')).toBeInTheDocument();
      fireEvent.focus(plot);
      expect(screen.getByText('Bei 202° SSW')).toBeInTheDocument();
      fireEvent.keyDown(plot, { key: 'ArrowRight' });
      expect(screen.getByText('Bei 203° SSW')).toBeInTheDocument();
      fireEvent.keyDown(plot, { key: 'Home' });
      expect(screen.getByText('Bei 112° OSO')).toBeInTheDocument();
      fireEvent.keyDown(plot, { key: 'Escape' });
      expect(screen.getByText('Höchstwerte im Bereich')).toBeInTheDocument();
    });
  });

  it('renders in English', () => {
    useUiStore.getState().setLang('en');
    render(<HorizonSection />);
    expect(screen.getByRole('switch', { name: 'Compute terrain horizon' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add obstacle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply pasted data' })).toBeInTheDocument();
  });
});
