import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetBuildingImport } from '../../hooks/useBuildingImport';
import type { BuildingFetchResult, BuildingPart } from '../../model/buildingSources';
import { DEFAULT_CONFIG } from '../../model/defaults';
import { surfaceSiteKey } from '../../model/dsmHorizon';
import { facadeTransform } from '../../model/enu';
import { ringArea } from '../../model/polygon';
import { MAX_BUILDINGS, sanitizeConfig } from '../../model/share';
import type { Building, Config } from '../../model/types';
import { requestBuildingFocus, useBuildingImportStore } from '../../state/buildingImportStore';
import { useConfigStore } from '../../state/configStore';
import { useDataStore } from '../../state/dataStore';
import { useUiStore } from '../../state/uiStore';
import { resetStores } from '../../test/utils';
import { BuildingList as BuildingListEntry } from './BuildingList';
import { BuildingListPanel as BuildingList, LIST_PAGE } from './BuildingListPanel';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../model/buildingSources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../model/buildingSources')>()),
  fetchSwisstopoBuildings: fetchMock,
}));

const SITE = { latitude: 46.958474, longitude: 7.45363 };
const GAMMA = 180; // facade faces south: u = (−cos γ, sin γ) = east, n = south

const square = (e: number, n: number, s = 10): [number, number][] => [
  [e, n],
  [e + s, n],
  [e + s, n + s],
  [e, n + s],
];

const b = (id: string, footprint: [number, number][], over: Partial<Building> = {}): Building => ({
  id,
  name: '',
  footprint,
  base: 0,
  height: 12,
  source: 'swisstopo',
  ...over,
});

/** Own building north of the location (the facade faces south), neighbours to the south. */
const BUILDINGS: Building[] = [
  b('b1', square(-5, 0.2, 10), { height: 18 }), // own: contains the probe 0.5 m behind (north of) the site
  b('b2', square(-5, -40), { height: 15 }), // 30 m south
  b('b3', square(-5, -25), { height: 9 }), // 15 m south
  b('b4', square(30, -20), { source: 'manual', name: 'Neubau' }),
];

function setConfig(over: Partial<Config['horizon']> = {}, building: Partial<Config['building']> = {}): void {
  useConfigStore.getState().replace(
    sanitizeConfig({
      ...DEFAULT_CONFIG,
      location: { ...DEFAULT_CONFIG.location, ...SITE },
      building: { ...DEFAULT_CONFIG.building, facadeAzimuth: GAMMA, ...building },
      horizon: { ...DEFAULT_CONFIG.horizon, ...over },
    }),
  );
}

const horizon = () => useConfigStore.getState().config.horizon;

function openList(name = /^Liste \(/): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name }));
  return screen.getByRole('list');
}

function itemToggle(name: string): HTMLElement {
  const toggle = screen
    .getAllByRole('button', { name: new RegExp(`^${name}`) })
    .find((el) => el.hasAttribute('aria-expanded'));
  if (!toggle) throw new Error(`no toggle for ${name}`);
  return toggle;
}

const part = (e: number, n: number, s: number, height: number): BuildingPart => ({
  footprint: square(e, n, s),
  height,
  minHeight: 0,
  kind: null,
});

const okResult = (over: Partial<Extract<BuildingFetchResult, { ok: true }>> = {}): BuildingFetchResult => ({
  ok: true,
  parts: [part(-6, -6, 12, 18), part(-6, -30, 12, 14), part(20, -30, 8, 10)],
  attribution: '© swisstopo',
  tileCount: 1,
  bytes: 200_000,
  covered: true,
  coverage: 1,
  mergedPieces: 0,
  ...over,
});

describe('BuildingList', () => {
  beforeEach(() => {
    resetStores();
    resetBuildingImport();
    fetchMock.mockReset();
  });
  afterEach(() => resetBuildingImport());

  it('the entry loads the list (its own chunk) on first use', async () => {
    setConfig();
    render(<BuildingListEntry />);
    expect(await screen.findByRole('heading', { name: 'Umgebungsgebäude' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gebäude laden' })).toBeInTheDocument();
  });

  it('empty state explains the address search and offers load and manual entry', () => {
    setConfig();
    render(<BuildingList />);
    expect(screen.getByText(/Noch keine Gebäude/)).toHaveTextContent(
      /Adresse in der Schweiz oder in Liechtenstein/,
    );
    expect(screen.getByRole('button', { name: 'Gebäude laden' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gebäude hinzufügen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Liste/ })).not.toBeInTheDocument();
  });

  it('summary: count, manual ones, source and date; attribution', () => {
    setConfig({ buildings: BUILDINGS, buildingImport: { ...SITE, radius: 300, date: '2026-09-25' } });
    render(<BuildingList />);
    expect(
      screen.getByText(/4 Gebäude, davon 1 von Hand · Quelle swisstopo, Stand 25\. September 2026/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Gebäudegrundrisse und -höhen: © swisstopo/)).toBeInTheDocument();
    expect(screen.getByText(/Prismen mit flachem Dach/)).toBeInTheDocument();
  });

  it('says the imported buildings are in the laser scan while it is active', () => {
    setConfig({
      buildings: BUILDINGS,
      buildingImport: { ...SITE, radius: 300, date: '2026-09-25' },
      surfaceModel: { enabled: true, trees: true, radius: 300 },
    });
    const config = useConfigStore.getState().config;
    act(() =>
      useDataStore.getState().setSurface({ status: 'ready', horizons: {}, siteKey: surfaceSiteKey(config) }),
    );
    render(<BuildingList />);
    expect(screen.getByText(/Laserscan enthält die importierten Gebäude bereits/)).toBeInTheDocument();
  });

  it('list: own building first, then by distance from the balcony, with height and direction', () => {
    setConfig({ buildings: BUILDINGS, buildingImport: { ...SITE, radius: 300, date: '2026-09-25' } });
    render(<BuildingList />);
    const list = openList();
    const items = within(list).getAllByRole('listitem');
    // Units are joined with a no-break space (\s matches it).
    expect(items.map((li) => within(li).getAllByRole('button')[0].textContent)).toEqual([
      expect.stringMatching(/^Gebäude 1Eigenes Gebäude18\sm hoch$/),
      expect.stringMatching(/^Gebäude 39\sm hoch · 15\sm entfernt, S$/),
      expect.stringMatching(/^Gebäude 215\sm hoch · 30\sm entfernt, S$/),
      expect.stringMatching(/^Neubauvon Hand12\sm hoch · 32\sm entfernt, OSO$/),
    ]);
  });

  it('«In der Liste bearbeiten» of the site plan opens the list at that building and focuses it', () => {
    setConfig({ buildings: BUILDINGS, buildingImport: { ...SITE, radius: 300, date: '2026-09-25' } });
    render(<BuildingList />);
    expect(screen.queryByRole('list')).toBeNull();
    act(() => requestBuildingFocus('b2'));
    expect(useUiStore.getState().openSections.horizon).toBe(true);
    const toggle = itemToggle('Gebäude 2');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Höhe über der Basis' })).toHaveValue('15');
    expect(useBuildingImportStore.getState().buildingFocus).toBeNull();
  });

  it('editing the height marks an imported building as edited', () => {
    setConfig({ buildings: BUILDINGS, buildingImport: { ...SITE, radius: 300, date: '2026-09-25' } });
    render(<BuildingList />);
    openList();
    fireEvent.click(itemToggle('Gebäude 3'));
    const field = screen.getByRole('textbox', { name: 'Höhe über der Basis' });
    fireEvent.change(field, { target: { value: '21.5' } });
    fireEvent.blur(field);
    const b3 = horizon().buildings.find((x) => x.id === 'b3')!;
    expect(b3.height).toBe(21.5);
    expect(b3.edited).toBe(true);
    expect(screen.getByText('bearbeitet')).toBeInTheDocument();
    // Manual buildings are never marked edited.
    fireEvent.click(itemToggle('Neubau'));
    const base = screen.getAllByRole('textbox', { name: 'Basis über dem Boden am Standort' })[1];
    fireEvent.change(base, { target: { value: '-2' } });
    fireEvent.blur(base);
    const b4 = horizon().buildings.find((x) => x.id === 'b4')!;
    expect(b4.base).toBe(-2);
    expect(b4.edited).toBeUndefined();
  });

  it('delete: imported → removed and restorable (focus stays), manual → gone', () => {
    setConfig({ buildings: BUILDINGS, buildingImport: { ...SITE, radius: 300, date: '2026-09-25' } });
    render(<BuildingList />);
    openList();
    const remove = screen.getByRole('button', { name: 'Gebäude 3 entfernen' });
    remove.focus();
    fireEvent.click(remove);
    expect(horizon().buildings.find((x) => x.id === 'b3')!.removed).toBe(true);
    const restore = screen.getByRole('button', { name: 'Gebäude 3 wiederherstellen' });
    expect(restore).toBe(remove);
    expect(document.activeElement).toBe(restore);
    expect(screen.getByRole('status')).toHaveTextContent('Gebäude 3 entfernt.');
    expect(screen.getByText(/1 entfernt/)).toBeInTheDocument();
    fireEvent.click(restore);
    expect(horizon().buildings.find((x) => x.id === 'b3')!.removed).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Neubau entfernen' }));
    expect(horizon().buildings.some((x) => x.id === 'b4')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Gebäude hinzufügen' }));
  });

  it('adds a manual building from a rectangle in the facade frame (anchor created when missing)', () => {
    setConfig();
    render(<BuildingList />);
    fireEvent.click(screen.getByRole('button', { name: 'Gebäude hinzufügen' }));
    const form = screen.getByRole('group', { name: 'Gebäude von Hand erfassen' });
    const set = (label: string, value: string): void => {
      const input = within(form).getByRole('textbox', { name: label });
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    };
    expect(document.activeElement).toBe(form);
    set('Abstand zur Fassade', '8');
    set('Breite (entlang der Fassade)', '12');
    set('Tiefe (von der Fassade weg)', '6');
    set('Versatz entlang der Fassade', '2');
    set('Höhe', '16');
    fireEvent.click(within(form).getByRole('button', { name: 'Hinzufügen' }));
    const h = horizon();
    expect(h.buildingImport).toEqual({ ...SITE, radius: 0, date: '' });
    expect(h.buildings).toHaveLength(1);
    const [added] = h.buildings;
    expect(added).toMatchObject({ source: 'manual', height: 16, base: 0, id: 'b1' });
    expect(ringArea(added.footprint)).toBeCloseTo(72, 6);
    // In the facade frame: u from −4 to 8, n from 8 to 14.
    const t = facadeTransform(h.buildingImport!, useConfigStore.getState().config.location, GAMMA);
    const uv = added.footprint.map((p) => t.toFacade(p));
    expect(Math.min(...uv.map((p) => p[0]))).toBeCloseTo(-4, 1);
    expect(Math.max(...uv.map((p) => p[0]))).toBeCloseTo(8, 1);
    expect(Math.min(...uv.map((p) => p[1]))).toBeCloseTo(8, 1);
    expect(Math.max(...uv.map((p) => p[1]))).toBeCloseTo(14, 1);
    expect(screen.queryByRole('group', { name: 'Gebäude von Hand erfassen' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Gebäude 1 hinzugefügt.');
    expect(document.activeElement).toBe(itemToggle('Gebäude 1'));
  });

  it('another site (location over 2 km from the anchor): says so, and adding by hand explains instead of failing', () => {
    // Imported at Breitenrainstrasse 10 in Bern, then the location set to Zürich by the coordinate fields.
    setConfig({ buildings: BUILDINGS, buildingImport: { ...SITE, radius: 300, date: '2026-09-25' } });
    useConfigStore.getState().patch('location', { latitude: 47.3769, longitude: 8.5417 });
    render(<BuildingList />);
    expect(screen.getByTestId('other-site')).toHaveTextContent(
      /gehören zu einem anderen Ort: Sie liegen 9\d\.\d km vom Standort entfernt\. Für diesen Standort «Neu laden» wählen\./,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gebäude hinzufügen' }));
    const form = screen.getByRole('group', { name: 'Gebäude von Hand erfassen' });
    fireEvent.click(within(form).getByRole('button', { name: 'Hinzufügen' }));
    // Nothing written (a clamped rectangle collapsed to one vertex and vanished before), no «added».
    expect(horizon().buildings).toHaveLength(BUILDINGS.length);
    expect(within(form).getByRole('alert')).toHaveTextContent(/nicht hinzufügen.*Zuerst «Neu laden» wählen/);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('adding by hand with nothing stored moves an anchor that is too far away to the location', () => {
    setConfig({ buildings: [], buildingImport: { ...SITE, radius: 300, date: '2026-09-25' } });
    const zurich = { latitude: 47.3769, longitude: 8.5417 };
    useConfigStore.getState().patch('location', zurich);
    render(<BuildingList />);
    expect(screen.queryByTestId('other-site')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Gebäude hinzufügen' }));
    const form = screen.getByRole('group', { name: 'Gebäude von Hand erfassen' });
    fireEvent.click(within(form).getByRole('button', { name: 'Hinzufügen' }));
    expect(horizon().buildingImport).toEqual({ ...zurich, radius: 0, date: '' });
    expect(horizon().buildings).toHaveLength(1);
    expect(ringArea(horizon().buildings[0].footprint)).toBeCloseTo(150, 6);
    expect(screen.getByRole('status')).toHaveTextContent('Gebäude 1 hinzugefügt.');
  });

  it('manual entry is unavailable at the building cap', () => {
    const many = Array.from({ length: MAX_BUILDINGS }, (_, i) =>
      b(`b${i + 1}`, square(20 * (i % 20), 20 + 20 * Math.floor(i / 20), 3)),
    );
    setConfig({ buildings: many, buildingImport: { ...SITE, radius: 300, date: '2026-09-25' } });
    render(<BuildingList />);
    const add = screen.getByRole('button', { name: 'Gebäude hinzufügen' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(add);
    expect(screen.queryByRole('group', { name: 'Gebäude von Hand erfassen' })).not.toBeInTheDocument();
    expect(screen.getByText(`Maximal ${MAX_BUILDINGS} Gebäude.`)).toBeInTheDocument();
    openList();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(LIST_PAGE);
    fireEvent.click(screen.getByRole('button', { name: `Alle ${MAX_BUILDINGS} anzeigen` }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(MAX_BUILDINGS);
  });

  it('«Gebäude laden»: progress with abort, then the result', async () => {
    setConfig();
    let release: (r: BuildingFetchResult) => void = () => {};
    fetchMock.mockImplementation(
      (
        _lat: number,
        _lon: number,
        _r: number,
        opts: { onProgress?: (d: number, t: number, b: number) => void },
      ) => {
        opts.onProgress?.(1, 4, 250_000);
        return new Promise<BuildingFetchResult>((resolve) => (release = resolve));
      },
    );
    render(<BuildingList />);
    fireEvent.click(screen.getByRole('button', { name: 'Gebäude laden' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(SITE.latitude, SITE.longitude, 300, expect.any(Object)),
    );
    expect(await screen.findByText('Gebäude werden geladen … 1 von 4 Kacheln, 0.3 MB')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Fortschritt Gebäude-Import' })).toHaveAttribute(
      'aria-valuenow',
      '13',
    );
    await act(async () => release(okResult()));
    await waitFor(() => expect(useBuildingImportStore.getState().status).toBe('ready'));
    expect(
      screen.getByText(/3 Gebäudeteile im Umkreis von 300 m gefunden, \d+ übernommen/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu laden' })).toBeInTheDocument();
    expect(horizon().buildings.length).toBeGreaterThan(0);
  });

  it('abort during loading keeps everything as it was', async () => {
    setConfig();
    fetchMock.mockImplementation(
      (_lat: number, _lon: number, _r: number, opts: { signal: AbortSignal }) =>
        new Promise<BuildingFetchResult>((resolve) =>
          opts.signal.addEventListener('abort', () =>
            resolve({ ok: false, error: { kind: 'aborted', message: 'aborted' }, tileCount: 1, bytes: 0 }),
          ),
        ),
    );
    render(<BuildingList />);
    fireEvent.click(screen.getByRole('button', { name: 'Gebäude laden' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' })));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(useBuildingImportStore.getState().status).toBe('idle');
    expect(horizon().buildings).toEqual([]);
  });

  it('error with the cause and retry; outside CH/FL; border note', async () => {
    setConfig();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'network', message: 'Failed to fetch' },
      tileCount: 1,
      bytes: 0,
    });
    render(<BuildingList />);
    fireEvent.click(screen.getByRole('button', { name: 'Gebäude laden' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Die Gebäude konnten nicht geladen werden.');
    expect(alert).toHaveTextContent('Keine Verbindung zum Server');
    fetchMock.mockResolvedValueOnce(okResult({ covered: false, coverage: 0, parts: [] }));
    await act(async () => fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' })));
    expect(await screen.findByText(/nur in der Schweiz und in Liechtenstein/)).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(okResult({ coverage: 0.77 }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Gebäude laden' })));
    expect(
      await screen.findByText('Gebäude ausserhalb der Schweiz und Liechtensteins fehlen.'),
    ).toBeInTheDocument();
  });

  it('asks before a re-import discards changes; «Behalten» keeps them', async () => {
    setConfig({
      buildings: [b('b1', square(-5, -40), { removed: true })],
      buildingImport: { ...SITE, radius: 300, date: '2026-09-25' },
    });
    fetchMock.mockResolvedValue(okResult());
    render(<BuildingList />);
    fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
    const dialog = screen.getByRole('group', { name: 'Gebäude neu laden?' });
    expect(dialog).toHaveTextContent('Die Änderungen an 1 importierten Gebäude');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Neu laden' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Behalten' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(horizon().buildings[0].removed).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
    await act(async () =>
      fireEvent.click(
        within(screen.getByRole('group', { name: 'Gebäude neu laden?' })).getByRole('button', {
          name: 'Neu laden',
        }),
      ),
    );
    await waitFor(() => expect(useBuildingImportStore.getState().status).toBe('ready'));
    expect(horizon().buildings.some((x) => x.removed)).toBe(false);
  });

  it('English', () => {
    useUiStore.setState({ lang: 'en' });
    setConfig({ buildings: BUILDINGS, buildingImport: { ...SITE, radius: 300, date: '2026-09-25' } });
    render(<BuildingList />);
    expect(
      screen.getByText(/4 buildings, 1 entered by hand · source swisstopo, as of 25 September 2026/),
    ).toBeInTheDocument();
    openList(/^List \(/);
    expect(screen.getByText('Own building')).toBeInTheDocument();
  });
});
