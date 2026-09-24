import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { LocationSection } from './LocationSection';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const GEOCODING = {
  results: [
    {
      name: 'Bern',
      latitude: 46.94809,
      longitude: 7.44744,
      elevation: 549,
      timezone: 'Europe/Zurich',
      country_code: 'CH',
      admin1: 'Bern',
      admin1_id: 2661551,
    },
    {
      name: 'Bernau bei Berlin',
      latitude: 52.67982,
      longitude: 13.58708,
      elevation: 67,
      timezone: 'Europe/Berlin',
      country_code: 'DE',
      admin1: 'Brandenburg',
    },
  ],
};

const location = () => useConfigStore.getState().config.location;

function searchInput(): HTMLInputElement {
  return screen.getByRole('combobox', { name: 'Ort suchen' });
}

/** Options of the search listbox (the preset <select> has options too). */
async function findResults(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('listbox', { name: 'Suchergebnisse' });
  return within(list).getAllByRole('option');
}

/** Replaces navigator.geolocation for one test. */
function mockGeolocation(impl: Partial<Geolocation> | undefined): void {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: impl });
}

describe('LocationSection', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.setState({ openSections: { location: true } });
  });

  afterEach(() => {
    // jsdom has no geolocation: remove the own property again.
    delete (navigator as unknown as Record<string, unknown>).geolocation;
  });

  describe('place search', () => {
    it('debounces the request and applies a result chosen with the keyboard', async () => {
      const fetchMock = vi.fn(async () => jsonResponse(GEOCODING));
      vi.stubGlobal('fetch', fetchMock);
      render(<LocationSection />);
      const input = searchInput();
      expect(input).toHaveAttribute('aria-expanded', 'false');

      fireEvent.change(input, { target: { value: 'Be' } });
      fireEvent.change(input, { target: { value: 'Ber' } });
      fireEvent.change(input, { target: { value: 'Bern' } });
      expect(screen.getByText('Suche läuft …')).toBeInTheDocument();

      const options = await findResults();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
      expect(url).toContain('geocoding-api.open-meteo.com');
      expect(url).toContain('name=Bern');
      expect(url).toContain('language=de');
      expect(options).toHaveLength(2);
      expect(options[0]).toHaveTextContent('Bern, BE, CH');
      expect(options[0]).toHaveTextContent('46.948° N, 7.447° O · 549 m · Europe/Zurich');
      expect(input).toHaveAttribute('aria-expanded', 'true');
      expect(input).not.toHaveAttribute('aria-activedescendant');

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // wraps
      expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
      fireEvent.keyDown(input, { key: 'ArrowUp' }); // wraps back
      expect(input).toHaveAttribute('aria-activedescendant', options[1].id);

      fireEvent.keyDown(input, { key: 'Enter' });
      expect(location()).toEqual({
        name: 'Bernau bei Berlin, Brandenburg, DE',
        latitude: 52.6798,
        longitude: 13.5871,
        timezone: 'Europe/Berlin',
        elevation: 67,
      });
      expect(input).toHaveValue('');
      expect(input).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText('Übernommen: Bernau bei Berlin, Brandenburg, DE')).toBeInTheDocument();
    });

    it('aborts the running request when the query changes', async () => {
      const signals: AbortSignal[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              const signal = init?.signal as AbortSignal;
              signals.push(signal);
              signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            }),
        ),
      );
      render(<LocationSection />);
      fireEvent.change(searchInput(), { target: { value: 'Zür' } });
      await waitFor(() => expect(signals).toHaveLength(1));
      fireEvent.change(searchInput(), { target: { value: 'Züri' } });
      expect(signals[0].aborted).toBe(true);
    });

    it('selects with the mouse, closes with Escape and reports empty results', async () => {
      const fetchMock = vi.fn(async (url: string) =>
        jsonResponse(url.includes('Xyz') ? { results: [] } : GEOCODING),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<LocationSection />);
      const input = searchInput();
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'Bern' } });
      await findResults();
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(input).toHaveAttribute('aria-expanded', 'false');
      expect(input).toHaveValue('Bern');
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // reopens
      const [bern] = await findResults();
      fireEvent.click(bern);
      expect(location().name).toBe('Bern, BE, CH');
      expect(location().latitude).toBe(46.9481);

      fireEvent.change(input, { target: { value: 'Xyz' } });
      const none = 'Keine Treffer für «Xyz» – oder die Ortssuche ist nicht erreichbar.';
      expect(await screen.findByText(none)).toBeInTheDocument();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      fireEvent.change(input, { target: { value: 'X' } });
      expect(screen.getByText('Mindestens 2 Zeichen eingeben.')).toBeInTheDocument();

      // Hits are remembered, empty answers (possibly a network error) are asked again.
      const calls = fetchMock.mock.calls.length;
      fireEvent.change(input, { target: { value: 'Bern' } });
      expect(await findResults()).toHaveLength(2);
      fireEvent.change(input, { target: { value: 'Xyz' } });
      expect(await screen.findByText(none)).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(calls + 1);
    });
  });

  describe('my location', () => {
    it('uses the device position with a coordinate label and the device time zone', () => {
      mockGeolocation({
        getCurrentPosition: (success: PositionCallback) =>
          success({
            coords: { latitude: 47.37692, longitude: 8.54169, accuracy: 25 },
          } as GeolocationPosition),
      });
      render(<LocationSection />);
      fireEvent.click(screen.getByRole('button', { name: 'Mein Standort' }));
      expect(location()).toMatchObject({
        name: '47.377° N, 8.542° E',
        latitude: 47.3769,
        longitude: 8.5417,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        elevation: DEFAULT_CONFIG.location.elevation,
      });
      expect(screen.getByText('Position übernommen (Genauigkeit ± 25 m).')).toBeInTheDocument();
    });

    it('explains a denied permission and keeps the location', () => {
      mockGeolocation({
        getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback | null) =>
          fail?.({ code: 1, message: 'denied' } as GeolocationPositionError),
      });
      render(<LocationSection />);
      fireEvent.click(screen.getByRole('button', { name: 'Mein Standort' }));
      expect(screen.getByText(/Zugriff auf den Standort wurde verweigert/)).toBeInTheDocument();
      expect(location()).toEqual(DEFAULT_CONFIG.location);
    });

    it('reports a browser without geolocation', () => {
      mockGeolocation(undefined);
      render(<LocationSection />);
      fireEvent.click(screen.getByRole('button', { name: 'Mein Standort' }));
      expect(screen.getByText('Dieser Browser kann den Standort nicht ermitteln.')).toBeInTheDocument();
    });
  });

  it('applies a preset', () => {
    render(<LocationSection />);
    const select = screen.getByRole('combobox', { name: 'Vorlage' });
    expect(select).toHaveValue(''); // default coordinates are no preset → "Eigener Standort"
    expect(screen.getByRole('group', { name: 'Schweiz' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'zuerich' } });
    expect(location()).toEqual({
      name: 'Zürich',
      latitude: 47.3667,
      longitude: 8.55,
      timezone: 'Europe/Zurich',
      elevation: 429,
    });
    expect(select).toHaveValue('zuerich');
  });

  it('keeps an automatic coordinate label in sync with edited coordinates', () => {
    render(<LocationSection />);
    const lat = screen.getByRole('textbox', { name: 'Breitengrad' });
    fireEvent.change(lat, { target: { value: '46,5' } });
    fireEvent.blur(lat);
    expect(location().latitude).toBe(46.5);
    expect(location().name).toBe('46.500° N, 7.450° E');

    act(() => useConfigStore.getState().patch('location', { name: 'Mein Balkon' }));
    const lon = screen.getByRole('textbox', { name: 'Längengrad' });
    fireEvent.change(lon, { target: { value: '8' } });
    fireEvent.keyDown(lon, { key: 'Enter' });
    expect(location()).toMatchObject({ longitude: 8, name: 'Mein Balkon' });
  });

  it('shows the automatic coordinate label in the UI language and stores it language-neutral', () => {
    const { container } = render(<LocationSection />);
    const name = screen.getByRole('textbox', { name: 'Bezeichnung' });
    expect(name).toHaveValue('47.100° N, 7.450° O');
    expect(container).toHaveTextContent(/Standort\s*47\.100° N, 7\.450° O/); // section summary

    fireEvent.change(name, { target: { value: 'Mein Balkon' } });
    fireEvent.blur(name);
    expect(location().name).toBe('Mein Balkon');
    // Typing the displayed label back restores the automatic label, which follows the coordinates again.
    fireEvent.change(name, { target: { value: '47.100° N, 7.450° O' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(location().name).toBe('47.100° N, 7.450° E');
    const lon = screen.getByRole('textbox', { name: 'Längengrad' });
    fireEvent.change(lon, { target: { value: '8' } });
    fireEvent.blur(lon);
    expect(location().name).toBe('47.100° N, 8.000° E');
    expect(name).toHaveValue('47.100° N, 8.000° O');

    act(() => useUiStore.getState().setLang('en'));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('47.100° N, 8.000° E');
  });

  it('validates the time zone and shows the UTC offset at the selected date', () => {
    render(<LocationSection />);
    const tz = screen.getByRole('combobox', { name: 'Zeitzone' });
    expect(screen.getByText(/Am 21\. Juni 2025: UTC\+2 \(MESZ\)/)).toBeInTheDocument();

    fireEvent.change(tz, { target: { value: 'Mars/Olympus' } });
    fireEvent.blur(tz);
    expect(tz).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Unbekannte Zeitzone/)).toBeInTheDocument();
    expect(location().timezone).toBe('Europe/Zurich');

    fireEvent.change(tz, { target: { value: 'America/New_York' } });
    expect(location().timezone).toBe('America/New_York');
    expect(tz).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText(/Am 21\. Juni 2025: UTC−4/)).toBeInTheDocument();
    expect(document.querySelector('datalist option[value="Europe/Vienna"]')).not.toBeNull();
  });

  it('offers the elevation of the terrain model', () => {
    useDataStore.getState().setTerrain({
      status: 'ready',
      profile: { stepDeg: 1, elevations: new Array<number>(360).fill(0) },
      siteElevation: 549.4,
    });
    render(<LocationSection />);
    expect(screen.getByText('Geländemodell: 549 m')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Höhe 549\s+m aus dem Geländemodell übernehmen$/ }));
    expect(location().elevation).toBe(549);
    expect(
      screen.queryByRole('button', { name: /aus dem Geländemodell übernehmen/ }),
    ).not.toBeInTheDocument();
  });

  it('renders in English', () => {
    useUiStore.getState().setLang('en');
    render(<LocationSection />);
    expect(screen.getByRole('combobox', { name: 'Search place' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My location' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Preset' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Switzerland' })).toBeInTheDocument();
  });
});
