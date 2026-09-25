import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import fixtures from '../model/geocode.fixtures.json';
import { clearGeocodeCaches } from '../model/geocode';
import { lv95ToWgs84 } from '../model/lv95';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useAddressPointStore } from '../state/addressPointStore';
import { useBuildingImportStore } from '../state/buildingImportStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { LocationSection } from './LocationSection';
import { resetAddressSession } from './location/addressSession';

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

const SEARCH = fixtures.search as Record<string, unknown>;
const GWR = fixtures.gwr as Record<string, { status: number; body: unknown }>;

interface Routes {
  /** Open-Meteo geocoding body for a query. */
  places?: (name: string) => unknown;
  /** SearchServer response for a searchText (default: the recorded fixture of that text, else none). */
  search?: (text: string) => Response;
  height?: () => Response;
  gwr?: (featureId: string) => Response;
  identify?: () => Response | Promise<Response>;
}

/** fetch stub routing the app's services (geo.admin.ch answers from the recorded fixtures). */
function stubServices(routes: Routes = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      return jsonResponse(routes.places?.(url.searchParams.get('name') ?? '') ?? { results: [] });
    }
    if (url.pathname.endsWith('/SearchServer')) {
      const text = url.searchParams.get('searchText') ?? '';
      return routes.search?.(text) ?? jsonResponse(SEARCH[text] ?? { results: [] });
    }
    if (url.pathname.includes('/ch.bfs.gebaeude_wohnungs_register/')) {
      const id = url.pathname.split('/').pop() ?? '';
      const f = GWR[id] ?? { status: 404, body: { status: 'error', code: 404 } };
      return routes.gwr?.(id) ?? jsonResponse(f.body, f.status);
    }
    if (url.pathname.endsWith('/height')) {
      return routes.height?.() ?? jsonResponse(fixtures.height.kramgasse49.body);
    }
    if (url.pathname.endsWith('/identify')) {
      return routes.identify?.() ?? jsonResponse(fixtures.identify.breitenrain.body);
    }
    throw new TypeError(`unexpected request ${url.href}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const calls = (part: string): string[] =>
    fetchMock.mock.calls.map((c) => String((c as unknown[])[0])).filter((u) => u.includes(part));
  return { fetchMock, calls };
}

const location = () => useConfigStore.getState().config.location;

function searchInput(): HTMLInputElement {
  return screen.getByRole('combobox', { name: 'Adresse oder Ort suchen' });
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

/** Types an address and applies its first result with the keyboard. */
async function pickAddress(text: string, input: HTMLElement = searchInput()): Promise<void> {
  fireEvent.change(input, { target: { value: text } });
  const list = await screen.findByRole('listbox', { name: /^(Suchergebnisse|Search results)$/ });
  await within(list).findByRole('group', { name: /^(Adressen|Addresses)/ });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('LocationSection', () => {
  beforeEach(() => {
    resetStores();
    clearGeocodeCaches();
    resetAddressSession();
    useUiStore.setState({ openSections: { location: true } });
  });

  afterEach(() => {
    resetAddressSession();
    // jsdom has no geolocation: remove the own property again.
    delete (navigator as unknown as Record<string, unknown>).geolocation;
  });

  describe('place search', () => {
    it('debounces the requests and applies a place chosen with the keyboard', async () => {
      const { fetchMock, calls } = stubServices({ places: () => GEOCODING });
      render(<LocationSection />);
      const input = searchInput();
      expect(input).toHaveAttribute('aria-expanded', 'false');

      fireEvent.change(input, { target: { value: 'Be' } });
      fireEvent.change(input, { target: { value: 'Ber' } });
      fireEvent.change(input, { target: { value: 'Bern' } });
      expect(screen.getByText('Suche läuft …')).toBeInTheDocument();

      const options = await findResults();
      await waitFor(() => expect(screen.queryByText('Suche läuft …')).not.toBeInTheDocument());
      // One request per source for the last query only.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [places] = calls('open-meteo');
      expect(places).toContain('name=Bern');
      expect(places).toContain('language=de');
      expect(places).toContain('count=6');
      const [addresses] = calls('SearchServer');
      expect(addresses).toContain('searchText=Bern');
      expect(addresses).toContain('origins=address');
      expect(options).toHaveLength(2);
      expect(within(screen.getByRole('listbox')).getByRole('group', { name: /Orte/ })).toBeInTheDocument();
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
      // A place keeps today's behaviour: no laser scan, no surroundings import, no building block.
      expect(useConfigStore.getState().config.horizon.surfaceModel.enabled).toBe(false);
      expect(useUiStore.getState().surroundingsImport).toBeNull();
      expect(screen.queryByRole('region', { name: 'Gebäude an der Adresse' })).not.toBeInTheDocument();
    });

    it('aborts the running requests when the query changes', async () => {
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
      await waitFor(() => expect(signals).toHaveLength(2)); // addresses and places
      fireEvent.change(searchInput(), { target: { value: 'Züri' } });
      expect(signals.every((s) => s.aborted)).toBe(true);
    });

    it('selects with the mouse, closes with Escape and reports empty results', async () => {
      const { fetchMock } = stubServices({
        places: (name) => (name === 'Xyz' ? { results: [] } : GEOCODING),
      });
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
      // A pick by mouse keeps the focus in the search; by touch the input lets go (the keyboard closes).
      input.focus();
      fireEvent.change(input, { target: { value: 'Bern' } });
      const [again] = await findResults();
      fireEvent.pointerDown(again, { pointerType: 'mouse' });
      fireEvent.click(again);
      expect(input).toHaveFocus();
      fireEvent.change(input, { target: { value: 'Bern' } });
      const [byTouch] = await findResults();
      fireEvent.pointerDown(byTouch, { pointerType: 'touch' });
      fireEvent.click(byTouch);
      expect(input).not.toHaveFocus();

      fireEvent.change(input, { target: { value: 'Xyz' } });
      const none = 'Keine Treffer für «Xyz» – oder die Suche ist nicht erreichbar.';
      expect(await screen.findByText(none)).toBeInTheDocument();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      fireEvent.change(input, { target: { value: 'X' } });
      expect(screen.getByText('Mindestens 2 Zeichen eingeben.')).toBeInTheDocument();

      // Hits are remembered (also an empty address list); empty place answers are asked again.
      const calls = fetchMock.mock.calls.length;
      fireEvent.change(input, { target: { value: 'Bern' } });
      expect(await findResults()).toHaveLength(2);
      fireEvent.change(input, { target: { value: 'Xyz' } });
      expect(await screen.findByText(none)).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(calls + 1);
    });
  });

  describe('address search', () => {
    it('applies an address: location to 1e-6°, laser scan on, surroundings import, height, building data', async () => {
      const { calls } = stubServices();
      useConfigStore.getState().patch('horizon', {
        surfaceModel: { enabled: false, trees: false, radius: 250 },
      });
      render(<LocationSection />);
      const input = searchInput();
      fireEvent.change(input, { target: { value: 'Kramgasse 49 Bern' } });
      const [option] = await findResults();
      const group = within(screen.getByRole('listbox')).getByRole('group', { name: /Adressen/ });
      expect(group).toHaveTextContent('swisstopo');
      expect(option).toHaveTextContent('Kramgasse 49, 3011 Bern');
      expect(option).toHaveTextContent('Gebäudeadresse · Schweiz');
      expect(screen.queryByRole('group', { name: /Orte/ })).not.toBeInTheDocument();

      fireEvent.keyDown(input, { key: 'Enter' }); // no active option: the first one
      expect(location()).toEqual({
        name: 'Kramgasse 49, 3011 Bern',
        latitude: 46.947847,
        longitude: 7.449979,
        timezone: 'Europe/Zurich',
        elevation: DEFAULT_CONFIG.location.elevation,
      });
      expect(useConfigStore.getState().config.horizon.surfaceModel).toEqual({
        enabled: true,
        trees: false,
        radius: 250,
      });
      expect(useUiStore.getState().surroundingsImport).toMatchObject({
        latitude: 46.947847,
        longitude: 7.449979,
      });
      expect(screen.getByText('Übernommen: Kramgasse 49, 3011 Bern')).toBeInTheDocument();
      // The address point is remembered (persisted) until the site plan places the balcony: the laser scan
      // waits whatever becomes of the import. The import's progress shows below the search.
      expect(useAddressPointStore.getState().point).toEqual({
        latitude: 46.947847,
        longitude: 7.449979,
        importPending: true,
      });
      act(() =>
        useBuildingImportStore.setState({
          status: 'loading',
          request: { latitude: 46.947847, longitude: 7.449979, reason: 'address' },
        }),
      );
      expect(
        screen.getByText(/^Gebäude der Umgebung werden geladen … Danach öffnet sich der Lageplan/),
      ).toBeInTheDocument();
      act(() =>
        useBuildingImportStore.setState({ status: 'error', error: { kind: 'network', message: 'offline' } }),
      );
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/Die Gebäude der Umgebung konnten nicht geladen werden/);
      expect(alert).toHaveTextContent(/Koordinaten & Zeitzone/);
      act(() => {
        useUiStore.getState().consumeSurroundingsImport();
      });
      fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
      expect(useUiStore.getState().surroundingsImport).toMatchObject({ latitude: 46.947847 });
      act(() => useBuildingImportStore.setState({ status: 'idle', error: null }));

      // Height service → elevation (537.7 m → 538 m).
      await waitFor(() => expect(location().elevation).toBe(538));
      expect(calls('/height')[0]).toContain('easting=2600863.76&northing=1199640.37&sr=2056');

      // Building register (read-only).
      const block = await screen.findByRole('region', { name: 'Gebäude an der Adresse' });
      expect(within(block).getByText('Kramgasse 49, 3011 Bern')).toBeInTheDocument();
      expect(block).toHaveTextContent('Schweiz · EGID 1230393');
      const value = (term: string): string | null =>
        within(block).getByText(term).closest('div')?.querySelector('dd')?.textContent ?? null;
      await waitFor(() => expect(value('Geschosse')).toBe('5'));
      expect(value('Baujahr')).toBe('vor 1919 (Bauperiode)');
      expect(value('Grundfläche')).toBe('147\u00a0m²');
      expect(value('Gebäudekategorie')).toBe('Andere Wohngebäude (Wohngebäude mit Nebennutzung)');
      expect(calls('gebaeude_wohnungs_register/1230393_0')).toHaveLength(1);

      // Coordinates with 6 decimals; the address in the section summary.
      expect(screen.getByRole('textbox', { name: 'Breitengrad' })).toHaveValue('46.947847');
      expect(screen.getByRole('textbox', { name: 'Längengrad' })).toHaveValue('7.449979');
      expect(screen.getByRole('button', { name: /^Standort/ })).toHaveTextContent('Kramgasse 49, 3011 Bern');

      // Another location (a preset): the building block goes away.
      fireEvent.change(screen.getByRole('combobox', { name: 'Vorlage' }), { target: { value: 'zuerich' } });
      expect(screen.queryByRole('region', { name: 'Gebäude an der Adresse' })).not.toBeInTheDocument();
    });

    it('puts addresses first when the query has a number, places first otherwise', async () => {
      stubServices({
        places: () => GEOCODING,
        search: (text) => jsonResponse(SEARCH[text === 'Bern' ? 'Kramgasse 4' : text] ?? { results: [] }),
      });
      render(<LocationSection />);
      const input = searchInput();
      fireEvent.change(input, { target: { value: 'Kramgasse 4' } });
      await waitFor(async () => expect(await findResults()).toHaveLength(8));
      const groups = within(screen.getByRole('listbox')).getAllByRole('group');
      expect(groups).toHaveLength(2);
      expect(groups[0]).toHaveAccessibleName('Adressen swisstopo, CH und FL');
      expect(groups[1]).toHaveAccessibleName('Orte Open-Meteo');
      // Exact hits first within the addresses; the arrow keys run across both groups.
      const options = await findResults();
      expect(options[0]).toHaveTextContent('Kramgasse 4, 3506 Grosshöchstetten');
      expect(options[2]).toHaveTextContent('Kramgasse 4a');
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(input).toHaveAttribute('aria-activedescendant', options[7].id);
      expect(options[7]).toHaveTextContent('Bernau bei Berlin');
      expect(screen.getByText(/6 Adressen und 2 Orte gefunden/)).toBeInTheDocument();

      fireEvent.change(input, { target: { value: 'Bern' } });
      await waitFor(async () => expect(await findResults()).toHaveLength(8));
      const [first] = within(screen.getByRole('listbox')).getAllByRole('group');
      expect(first).toHaveAccessibleName(/^Orte/);
    });

    it('marks similar spellings and keeps them only with the typed house number and a similar street', async () => {
      stubServices();
      render(<LocationSection />);
      fireEvent.change(searchInput(), { target: { value: 'Kramgase 49 Bern' } });
      const options = await findResults();
      // Recorded: also Bernstrasse 49, Kramgasse 1 and Kramgasse 2 (fuzzy; other street or number).
      expect(options.map((o) => o.textContent)).toEqual([
        'Kramgasse 49, 3011 BernGebäudeadresse · Schweiz · ähnliche Schreibweise',
      ]);
      // Foreign street addresses: SearchServer's fuzzy Swiss look-alikes (Wien-Strasse 2, Via Milano 1 …) are dropped.
      for (const text of ['Stephansplatz 1 Wien', 'Via Roma 1 Milano']) {
        fireEvent.change(searchInput(), { target: { value: text } });
        expect(
          await screen.findByText(`Keine Treffer für «${text}» – oder die Suche ist nicht erreichbar.`),
        ).toBeInTheDocument();
      }
    });

    it('Liechtenstein: Europe/Vaduz, no building register record', async () => {
      stubServices({ height: () => jsonResponse({ height: '457.1' }) });
      render(<LocationSection />);
      await pickAddress('Städtle 1 Vaduz');
      expect(location()).toMatchObject({
        name: 'Städtle 1, 9490 Vaduz',
        latitude: 47.141187,
        longitude: 9.521306,
        timezone: 'Europe/Vaduz',
      });
      const block = await screen.findByRole('region', { name: 'Gebäude an der Adresse' });
      expect(
        await within(block).findByText(
          'Für Liechtenstein gibt es keine Angaben im eidgenössischen Gebäude- und Wohnungsregister.',
        ),
      ).toBeInTheDocument();
      expect(block).toHaveTextContent('Liechtenstein · EGID 299001764');
      await waitFor(() => expect(location().elevation).toBe(457));
    });

    it('reports an unreachable address search and still offers places', async () => {
      stubServices({
        places: () => GEOCODING,
        search: () => jsonResponse({ error: { code: 400 } }, 400),
      });
      render(<LocationSection />);
      fireEvent.change(searchInput(), { target: { value: 'Bern' } });
      expect(await findResults()).toHaveLength(2);
      expect(
        await screen.findByText('Die Adresssuche (swisstopo) ist gerade nicht erreichbar.'),
      ).toBeInTheDocument();
    });

    it('keeps the elevation when the height service fails; retries the building register', async () => {
      let gwrFails = true;
      stubServices({
        height: () => jsonResponse({ error: { code: 400 } }, 400),
        gwr: (id) => (gwrFails ? jsonResponse({}, 403) : jsonResponse(GWR[id].body)),
      });
      render(<LocationSection />);
      await pickAddress('Kramgasse 49 Bern');
      const block = await screen.findByRole('region', { name: 'Gebäude an der Adresse' });
      expect(await within(block).findByRole('alert')).toHaveTextContent(
        'Die Gebäudeangaben konnten nicht geladen werden.',
      );
      expect(location().elevation).toBe(DEFAULT_CONFIG.location.elevation);
      gwrFails = false;
      fireEvent.click(within(block).getByRole('button', { name: 'Erneut versuchen' }));
      expect(await within(block).findByText('5')).toBeInTheDocument();
      expect(within(block).queryByRole('alert')).not.toBeInTheDocument();
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
        // Coordinates are kept to 1e-6° (share.ts ROUNDING_OVERRIDES).
        latitude: 47.37692,
        longitude: 8.54169,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        elevation: DEFAULT_CONFIG.location.elevation,
      });
      expect(screen.getByText('Position übernommen (Genauigkeit ± 25 m).')).toBeInTheDocument();
    });

    it('offers the nearest address of the device position', async () => {
      const { calls } = stubServices();
      const f = fixtures.identify.breitenrain;
      const fix = lv95ToWgs84(f.easting, f.northing);
      mockGeolocation({
        getCurrentPosition: (success: PositionCallback) =>
          success({ coords: { ...fix, accuracy: 12 } } as GeolocationPosition),
      });
      render(<LocationSection />);
      expect(screen.queryByRole('button', { name: 'Nächste Adresse übernehmen' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Mein Standort' }));
      expect(calls('geo.admin.ch')).toHaveLength(0); // nothing is sent without the second click
      const offer = screen.getByRole('button', { name: 'Nächste Adresse übernehmen' });
      offer.focus();
      fireEvent.click(offer);
      expect(screen.getByText('Nächste Adresse wird gesucht …')).toBeInTheDocument();
      expect(
        await screen.findByText('Übernommen: Breitenrainplatz 42, 3014 Bern (7 m von der Position).'),
      ).toBeInTheDocument();
      // The offer is gone with the new location; the focus stays in the group.
      expect(screen.getByRole('button', { name: 'Mein Standort' })).toHaveFocus();
      expect(location()).toMatchObject({ name: 'Breitenrainplatz 42, 3014 Bern', timezone: 'Europe/Zurich' });
      expect(useUiStore.getState().surroundingsImport).not.toBeNull();
      expect(useConfigStore.getState().config.horizon.surfaceModel.enabled).toBe(true);
      expect(screen.queryByRole('button', { name: 'Nächste Adresse übernehmen' })).not.toBeInTheDocument();
      const [identify] = calls('/identify');
      expect(identify).toContain('tolerance=50');
      expect(identify).toContain('layers=all%3Ach.swisstopo.amtliches-gebaeudeadressverzeichnis');
    });

    describe('another location while the nearest address is looked up', () => {
      const f = fixtures.identify.breitenrain;

      /** Device fix at Breitenrain; the first identify reply waits for `release`, later ones answer at once. */
      function setup() {
        let release: () => void = () => {};
        let held = 0;
        const { fetchMock } = stubServices({
          identify: () => {
            if (held++ > 0) return jsonResponse(f.body);
            return new Promise<Response>((resolve) => {
              release = () => resolve(jsonResponse(f.body));
            });
          },
        });
        const fix = lv95ToWgs84(f.easting, f.northing);
        mockGeolocation({
          getCurrentPosition: (success: PositionCallback) =>
            success({ coords: { ...fix, accuracy: 12 } } as GeolocationPosition),
        });
        render(<LocationSection />);
        fireEvent.click(screen.getByRole('button', { name: 'Mein Standort' }));
        fireEvent.click(screen.getByRole('button', { name: 'Nächste Adresse übernehmen' }));
        expect(screen.getByText('Nächste Adresse wird gesucht …')).toBeInTheDocument();
        const identifySignal = (): AbortSignal | undefined => {
          const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/identify'));
          return (
            (call as unknown as [unknown, RequestInit | undefined] | undefined)?.[1]?.signal ?? undefined
          );
        };
        return { release: () => release(), identifySignal };
      }

      /** Waits until the identify request is on its way (after the request budget). */
      async function inFlight(identifySignal: () => AbortSignal | undefined): Promise<void> {
        await waitFor(() => expect(identifySignal()).toBeDefined());
        expect(identifySignal()?.aborted).toBe(false);
      }

      /** Lets the held reply through and waits for the promise chain to settle. */
      async function releaseReply(release: () => void): Promise<void> {
        await act(async () => {
          release();
          await new Promise((r) => setTimeout(r, 20));
        });
      }

      it('a preset: the late reply does not overwrite it; the offer works again afterwards', async () => {
        const { release, identifySignal } = setup();
        await inFlight(identifySignal);
        fireEvent.change(screen.getByRole('combobox', { name: 'Vorlage' }), { target: { value: 'zuerich' } });
        expect(location().name).toBe('Zürich');
        // The lookup is aborted with the location change, its message goes away.
        expect(identifySignal()?.aborted).toBe(true);
        await waitFor(() =>
          expect(screen.queryByText('Nächste Adresse wird gesucht …')).not.toBeInTheDocument(),
        );
        await releaseReply(release);
        expect(location()).toMatchObject({ name: 'Zürich', latitude: 47.3667, longitude: 8.55 });
        expect(useConfigStore.getState().config.horizon.surfaceModel.enabled).toBe(false);
        expect(useUiStore.getState().surroundingsImport).toBeNull();
        expect(screen.queryByText(/^Übernommen: Breitenrainplatz/)).not.toBeInTheDocument();
        // Nothing is stuck: the device position and its nearest address can be used again.
        fireEvent.click(screen.getByRole('button', { name: 'Mein Standort' }));
        fireEvent.click(screen.getByRole('button', { name: 'Nächste Adresse übernehmen' }));
        expect(
          await screen.findByText('Übernommen: Breitenrainplatz 42, 3014 Bern (7 m von der Position).'),
        ).toBeInTheDocument();
        expect(location().name).toBe('Breitenrainplatz 42, 3014 Bern');
      });

      it('a searched address: it stays, with its own surroundings import', async () => {
        const { release, identifySignal } = setup();
        await inFlight(identifySignal);
        await pickAddress('Kramgasse 49 Bern');
        expect(location().name).toBe('Kramgasse 49, 3011 Bern');
        expect(identifySignal()?.aborted).toBe(true);
        await releaseReply(release);
        expect(location()).toMatchObject({
          name: 'Kramgasse 49, 3011 Bern',
          latitude: 46.947847,
          longitude: 7.449979,
        });
        expect(useUiStore.getState().surroundingsImport).toMatchObject({
          latitude: 46.947847,
          longitude: 7.449979,
        });
        expect(screen.queryByText(/^Übernommen: Breitenrainplatz/)).not.toBeInTheDocument();
      });
    });

    it('says so when there is no address nearby', async () => {
      stubServices({ identify: () => jsonResponse({ results: [] }) });
      mockGeolocation({
        getCurrentPosition: (success: PositionCallback) =>
          success({ coords: { latitude: 48.2082, longitude: 16.3738, accuracy: 30 } } as GeolocationPosition),
      });
      render(<LocationSection />);
      fireEvent.click(screen.getByRole('button', { name: 'Mein Standort' }));
      fireEvent.click(screen.getByRole('button', { name: 'Nächste Adresse übernehmen' }));
      expect(
        await screen.findByText('Keine Gebäudeadresse im Umkreis von 50 m (nur Schweiz und Liechtenstein).'),
      ).toBeInTheDocument();
      expect(location().name).toBe('48.208° N, 16.374° E');
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

  it('keeps an automatic coordinate label in sync with edited coordinates (6 decimals)', () => {
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

    // Typed digits beyond 1e-6° are rounded (≤ 0.07 m); the field shows all six decimals.
    fireEvent.change(lat, { target: { value: '46.9478475' } });
    fireEvent.blur(lat);
    expect(location().latitude).toBe(46.947848);
    expect(lat).toHaveValue('46.947848');
    fireEvent.change(lon, { target: { value: '−122.4194123' } });
    fireEvent.blur(lon);
    expect(location().longitude).toBe(-122.419412);
    expect(lon).toHaveValue('-122.419412');
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

  it('renders in English', async () => {
    stubServices();
    useUiStore.getState().setLang('en');
    render(<LocationSection />);
    expect(screen.getByRole('combobox', { name: 'Search address or place' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My location' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Preset' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Switzerland' })).toBeInTheDocument();
    await pickAddress('Kramgasse 49 Bern', screen.getByRole('combobox', { name: 'Search address or place' }));
    const block = await screen.findByRole('region', { name: 'Building at the address' });
    expect(await within(block).findByText('before 1919 (period)')).toBeInTheDocument();
    expect(within(block).getByText('Other residential building (with secondary use)')).toBeInTheDocument();
  });
});
