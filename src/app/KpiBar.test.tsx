import { act, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { substringBeamLoss } from '../model/geometry';
import { clearSkyYear } from '../model/weather';
import { markAddressPoint } from '../state/addressPointStore';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { PROVISIONAL_DELAY_MS, useInstant, useLayout } from '../hooks/useModel';
import { ANNOUNCE_MS, KpiBar } from './KpiBar';

const series = clearSkyYear(DEFAULT_CONFIG.location.latitude, DEFAULT_CONFIG.location.longitude, 2025);
const patch = useConfigStore.getState().patch;

/** KPI card (<div> around <dt>) whose label matches. */
function kpi(label: string | RegExp): HTMLElement {
  const bar = screen.getByRole('region', { name: /Ergebnisse|Results/ });
  return within(bar).getByText(label, { selector: 'dt' }).parentElement as HTMLElement;
}

/** Texts of the <dd> elements of a KPI card (value, sub lines). */
const dds = (card: HTMLElement): string[] =>
  [...card.querySelectorAll('dd')].map((d) => (d.textContent ?? '').replace(/\s+/g, ' ').trim());

/** Number in a German formatted text ("1’234" → 1234). */
const num = (text: string): number => Number(text.replace(/[’'\s]/g, '').replace(/[^\d.-]/g, ''));

describe('KpiBar', () => {
  beforeEach(() => {
    resetStores();
    patch('horizon', { terrainEnabled: false });
  });

  describe('annual group', () => {
    it('shows skeletons until the simulation exists, then consistent numbers', () => {
      render(<KpiBar />);
      const annual = screen.getByRole('heading', { name: 'Jahr 2025' }).parentElement as HTMLElement;
      expect(annual).toHaveAttribute('aria-busy', 'true');
      expect(kpi('Jahresertrag')).not.toHaveTextContent(/kWh/);

      act(() => useDataStore.getState().setWeather({ status: 'ready', series }));
      expect(annual).not.toHaveAttribute('aria-busy');
      const total = num(dds(kpi('Jahresertrag'))[0]);
      const [specific, installed] = dds(kpi('Spezifischer Ertrag'));
      expect(installed).toMatch(/^bei 1\.72\skWp installiert$/); // 2 floors × 2 × 430 Wp
      expect(num(specific)).toBeCloseTo(total / 1.72, -1);
      // A normal space before the unit: on a 320 px phone "kWh/kWp" moves onto the next line.
      expect(kpi('Spezifischer Ertrag').querySelector('dd')?.textContent).toMatch(/^[\d’']+ kWh\/kWp$/);
    });

    it('stays busy while the terrain horizon loads (values would be without terrain)', () => {
      patch('horizon', { terrainEnabled: true });
      useDataStore.getState().setWeather({ status: 'ready', series });
      useDataStore.getState().setTerrain({ status: 'loading' });
      render(<KpiBar />);
      const annual = screen.getByRole('heading', { name: 'Jahr 2025' }).parentElement as HTMLElement;
      expect(annual).toHaveAttribute('aria-busy', 'true');
      expect(within(annual).getByText('Jahresergebnisse werden berechnet …')).toBeInTheDocument();
      expect(kpi('Jahresertrag')).not.toHaveTextContent(/kWh/);
      // A failed download keeps the values (without terrain, with its own warning).
      act(() => useDataStore.getState().setTerrain({ status: 'error', error: 'x' }));
      expect(annual).not.toHaveAttribute('aria-busy');
      expect(kpi('Jahresertrag')).toHaveTextContent(/kWh/);
    });

    it('shows the numbers without terrain as provisional while only the terrain horizon loads', () => {
      vi.useFakeTimers();
      patch('horizon', { terrainEnabled: true });
      useDataStore.getState().setWeather({ status: 'loading' });
      useDataStore.getState().setTerrain({ status: 'loading' });
      render(<KpiBar />);
      const annual = screen.getByRole('heading', { name: 'Jahr 2025' }).parentElement as HTMLElement;
      // The weather gates: never numbers from another site or year, however long it takes.
      act(() => {
        vi.advanceTimersByTime(PROVISIONAL_DELAY_MS * 2);
      });
      expect(annual).toHaveAttribute('aria-busy', 'true');
      expect(kpi('Jahresertrag')).not.toHaveTextContent(/kWh/);

      act(() => useDataStore.getState().setWeather({ status: 'ready', series }));
      // A fast terrain download finishes within the delay: skeletons until then, no provisional flash.
      act(() => {
        vi.advanceTimersByTime(PROVISIONAL_DELAY_MS - 1);
      });
      expect(kpi('Jahresertrag')).not.toHaveTextContent(/kWh/);
      expect(within(annual).queryByText(/vorläufig/)).not.toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(annual).not.toHaveAttribute('aria-busy');
      expect(within(annual).getByText('vorläufig – Geländehorizont wird geladen')).toBeInTheDocument();
      const provisional = num(dds(kpi('Jahresertrag'))[0]);
      expect(provisional).toBeGreaterThan(0);
      expect(kpi('Amortisation')).toHaveTextContent(/Jahre|nie/);

      act(() => useDataStore.getState().setTerrain({ status: 'ready', profile: null, profiles: {} }));
      expect(within(annual).queryByText(/vorläufig/)).not.toBeInTheDocument();
      expect(num(dds(kpi('Jahresertrag'))[0])).toBe(provisional); // no terrain profile: same numbers
    });

    it('marks the numbers provisional while the laser scan waits for the location (address point)', () => {
      const { latitude, longitude } = useConfigStore.getState().config.location;
      act(() => {
        patch('horizon', { surfaceModel: { enabled: true, trees: true, radius: 300 } });
        markAddressPoint(latitude, longitude);
        useDataStore.getState().setWeather({ status: 'ready', series });
        useDataStore.getState().setSurface({ status: 'waiting' });
      });
      render(<KpiBar />);
      const annual = screen.getByRole('heading', { name: 'Jahr 2025' }).parentElement as HTMLElement;
      expect(
        within(annual).getByText('vorläufig – Standort noch nicht im Lageplan bestätigt'),
      ).toBeInTheDocument();
      expect(kpi('Jahresertrag')).toHaveTextContent(/kWh/);
      // No buildings yet (import under way or failed): the action loads them.
      act(() => {
        useUiStore.getState().consumeSurroundingsImport();
      });
      within(annual).getByRole('button', { name: 'Gebäude laden' }).click();
      expect(useUiStore.getState().surroundingsImport).toMatchObject({ latitude, longitude });
      // Placed on the facade (another location): final again.
      act(() => {
        patch('location', { latitude: latitude + 1e-4 });
        useDataStore.getState().setSurface({ status: 'loading' });
      });
      expect(within(annual).queryByText(/Standort noch nicht/)).not.toBeInTheDocument();
    });

    it('never combines a new site with the previous site’s weather', () => {
      useDataStore.getState().setWeather({ status: 'ready', series });
      render(<KpiBar />);
      expect(kpi('Jahresertrag')).toHaveTextContent(/kWh/);
      act(() => patch('location', { latitude: 53.55, longitude: 9.99 }));
      expect(kpi('Jahresertrag')).not.toHaveTextContent(/kWh/);
      act(() =>
        useDataStore.getState().setWeather({ status: 'ready', series: clearSkyYear(53.55, 9.99, 2025) }),
      );
      expect(kpi('Jahresertrag')).toHaveTextContent(/kWh/);
    });
  });

  describe('now group (21 June 2025)', () => {
    it('explains the profile angle, the shaded floor and the power per floor', () => {
      render(<KpiBar />);
      expect(dds(kpi('Profilwinkel'))[1]).toBe('kritisch 68.1° (2D-Näherung, nur zur Erklärung)');
      const shade = kpi('Schatten auf 1. OG');
      expect(dds(shade)[0]).toMatch(/^\d+\s%$/);
      expect(dds(shade)[1]).toBe('der Panelfläche, exakt aus dem 3D-Modell');
      const power = kpi('Leistung jetzt');
      const items = within(power)
        .getAllByRole('listitem')
        .map((li) => li.textContent ?? '');
      expect(items[0]).toMatch(/^2\. OG/); // top-down, as on the building
      expect(items[1]).toMatch(/^1\. OG/);
      const perFloor = items.map((s) => num(s.replace(/^\d\. OG/, '')));
      expect(num(dds(power)[0])).toBe(perFloor[0] + perFloor[1]);
    });

    it('adds the direct-beam loss of the substring model to a partial shade', () => {
      useTimeStore.setState({ minutes: 13 * 60 });
      const { result } = renderHook(() => ({ instant: useInstant(), layout: useLayout() }));
      const { shade } = result.current.instant.floors[0];
      const losses = substringBeamLoss(shade, result.current.layout);
      const meanLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
      expect(shade.fraction).toBeGreaterThan(0);

      const { unmount } = render(<KpiBar />);
      const lines = dds(kpi('Schatten auf 1. OG'));
      expect(num(lines[0])).toBe(Math.round(shade.fraction * 100));
      // Same mean as the Panel-Schatten view; larger than the area share.
      expect(lines[2]).toMatch(
        new RegExp(`^${Math.round(meanLoss * 100)}\\s% Verlust der Direktstrahlung \\(Teilstränge\\)$`),
      );
      expect(meanLoss).toBeGreaterThan(shade.fraction);
      unmount();

      act(() => patch('system', { shadingModel: 'linear' }));
      render(<KpiBar />);
      expect(dds(kpi('Schatten auf 1. OG'))).toHaveLength(2);
    });

    it('analyses the floor below the top floor, also when the top floor is focused', () => {
      patch('building', { numFloors: 4 });
      useUiStore.getState().setFocusFloor(3);
      render(<KpiBar />);
      expect(dds(kpi('Schatten auf 3. OG'))[0]).toMatch(/^\d+\s%$/);
      act(() => useUiStore.getState().setFocusFloor(0));
      expect(kpi('Schatten auf 1. OG')).toBeInTheDocument();
    });

    it('keeps the analysed floor after the floor count shrinks', () => {
      patch('building', { numFloors: 4 });
      useUiStore.getState().setFocusFloor(2);
      render(<KpiBar />);
      expect(kpi('Schatten auf 3. OG')).toBeInTheDocument();
      act(() => patch('building', { numFloors: 2 }));
      expect(dds(kpi('Schatten auf 1. OG'))[0]).toMatch(/^\d+\s%$/);
    });

    it('a single floor has no shade and no critical angle', () => {
      patch('building', { numFloors: 1 });
      render(<KpiBar />);
      expect(dds(kpi('Schatten auf 1. OG'))).toEqual(['–', 'nur ein Stockwerk']);
      expect(dds(kpi('Profilwinkel'))[1]).toBe('keine Reihe darüber');
      expect(screen.getByRole('region', { name: 'Ergebnisse' })).not.toHaveTextContent(/kritisch/);
    });

    it('overlapping rows show no (negative) critical angle', () => {
      patch('building', { floorHeight: 200 });
      patch('panels', { length: 210, tiltFromVertical: 0 });
      render(<KpiBar />);
      const profile = kpi('Profilwinkel');
      expect(dds(profile)[1]).toBe('Panelreihen überlappen sich');
      expect(profile).not.toHaveTextContent(/−90|kritisch/);
    });

    it('vertical panels never reach the critical angle', () => {
      patch('panels', { tiltFromVertical: 0 });
      render(<KpiBar />);
      expect(dds(kpi('Profilwinkel'))[1]).toBe('Profilwinkel-Grenze wird nie erreicht');
    });

    it('at night', () => {
      useTimeStore.setState({ minutes: 60 });
      render(<KpiBar />);
      expect(dds(kpi('Sonnenhöhe'))[0]).toBe('–');
      expect(kpi('Sonnenhöhe')).toHaveTextContent('Sonne unter dem Horizont');
      expect(dds(kpi('Profilwinkel'))[0]).toBe('–');
      expect(dds(kpi('Schatten auf 1. OG'))).toEqual(['–', 'Sonne unter dem Horizont']);
    });

    it('in English', () => {
      useUiStore.getState().setLang('en');
      render(<KpiBar />);
      expect(dds(kpi('Shade on Floor 1'))[1]).toBe('of panel area, exact from the 3D model');
    });
  });

  describe('announcement of changed instant results', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const status = (): HTMLElement =>
      within(screen.getByRole('region', { name: 'Ergebnisse' })).getByRole('status');

    it('announces the results once a change has settled, not during the time animation', () => {
      vi.useFakeTimers();
      render(<KpiBar />);
      const initial = status().textContent ?? '';
      expect(initial).toMatch(
        /^Schatten auf 1\. OG: \d+\s%, Profilwinkel [\d.]+°, Leistung jetzt: [\d’']+ W$/,
      );

      // Tilt changed: announced after the quiet time only.
      act(() => patch('panels', { tiltFromVertical: 20 }));
      act(() => {
        vi.advanceTimersByTime(ANNOUNCE_MS - 1);
      });
      expect(status().textContent).toBe(initial);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      const tilted = status().textContent ?? '';
      expect(tilted).not.toBe(initial);
      expect(tilted).toContain(`Leistung jetzt: ${dds(kpi('Leistung jetzt'))[0]}`);

      // Time animation: frozen until it stops.
      act(() => useTimeStore.getState().setPlaying(true));
      act(() => useTimeStore.getState().setMinutes(15 * 60));
      act(() => {
        vi.advanceTimersByTime(5 * ANNOUNCE_MS);
      });
      expect(status().textContent).toBe(tilted);
      act(() => useTimeStore.getState().setPlaying(false));
      act(() => {
        vi.advanceTimersByTime(ANNOUNCE_MS);
      });
      expect(status().textContent).not.toBe(tilted);
    });

    it('names the sun state instead of a value at night', () => {
      vi.useFakeTimers();
      useTimeStore.setState({ minutes: 60 });
      render(<KpiBar />);
      expect(status()).toHaveTextContent('Schatten auf 1. OG: Sonne unter dem Horizont, Leistung jetzt: 0 W');
    });
  });
});
