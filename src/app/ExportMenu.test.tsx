import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { configToJson, sanitizeConfig } from '../model/share';
import { clearSkyYear } from '../model/weather';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { ExportMenu } from './ExportMenu';

const series = clearSkyYear(DEFAULT_CONFIG.location.latitude, DEFAULT_CONFIG.location.longitude, 2025);

interface Download {
  name: string;
  blob: Blob;
}

function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

/** Captures downloads (object URL + anchor click) instead of navigating. */
function captureDownloads(): Download[] {
  const downloads: Download[] = [];
  const blobs = new Map<string, Blob>();
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
    const url = `blob:test-${blobs.size}`;
    blobs.set(url, b as Blob);
    return url;
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const blob = blobs.get(this.href);
    if (blob) downloads.push({ name: this.download, blob });
  });
  return downloads;
}

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  return screen.getByRole('menu', { name: 'Export und Import' });
}

function chooseFile(content: string, name = 'config.json'): void {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input missing');
  const file = new File([content], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
}

describe('ExportMenu', () => {
  let downloads: Download[];

  beforeEach(() => {
    resetStores();
    useConfigStore.getState().patch('horizon', { terrainEnabled: false });
    downloads = captureDownloads();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a keyboard-operable menu button', async () => {
    render(<ExportMenu />);
    const button = screen.getByRole('button', { name: 'Export' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', menu.id);
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Konfiguration speichern JSON',
      'Konfiguration laden … JSON',
      'Monatsertrag je Stockwerk wird berechnet … CSV',
      expect.stringMatching(/^Neigungsvergleich .*CSV$/),
      'Schatten-Heatmap 1. OG CSV',
      'Bericht drucken … auch als PDF',
    ]);
    await waitFor(() => expect(items[0]).toHaveFocus());

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(items[items.length - 1]).toHaveFocus(); // wraps around
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'n' }); // type-ahead
    expect(items[3]).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on outside clicks', () => {
    render(
      <>
        <ExportMenu />
        <p>outside</p>
      </>,
    );
    openMenu();
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('downloads the configuration as JSON', async () => {
    useConfigStore.getState().patch('location', { name: 'Bern' });
    render(<ExportMenu />);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /Konfiguration speichern/ }));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('verschattung-konfiguration-Bern.json');
    const json = JSON.parse(await readBlob(downloads[0].blob)) as { location: { name: string } };
    expect(json.location.name).toBe('Bern');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('imports a configuration file, and can undo it', async () => {
    render(<ExportMenu />);
    const before = useConfigStore.getState().config;
    const imported = sanitizeConfig({
      ...DEFAULT_CONFIG,
      location: { ...DEFAULT_CONFIG.location, name: 'Lausanne', latitude: 46.52, longitude: 6.63 },
      building: { ...DEFAULT_CONFIG.building, numFloors: 6 },
    });
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /Konfiguration laden/ }));
    expect(click).toHaveBeenCalledTimes(1);

    chooseFile(configToJson(imported));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Konfiguration «Lausanne» geladen.');
    expect(useConfigStore.getState().config).toEqual(imported);

    fireEvent.click(within(status).getByRole('button', { name: 'Rückgängig' }));
    expect(useConfigStore.getState().config).toEqual(before);
    expect(screen.getByRole('status')).toHaveTextContent('Vorherige Konfiguration wiederhergestellt.');
  });

  it('shows an error for invalid files and keeps the configuration', async () => {
    render(<ExportMenu />);
    const before = useConfigStore.getState().config;
    chooseFile('{"not": "a config"}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Die Datei enthält keine gültige Konfiguration dieser App (JSON).');
    expect(useConfigStore.getState().config).toBe(before);

    fireEvent.click(within(alert).getByRole('button', { name: 'Schliessen' }));
    expect(screen.queryByRole('alert')).toBeNull();

    chooseFile('');
    expect(await screen.findByRole('alert')).toHaveTextContent('Die Datei ist leer.');
  });

  it('disables result exports until the simulation exists, then exports monthly CSV', async () => {
    render(<ExportMenu />);
    let menu = openMenu();
    const monthly = within(menu).getByRole('menuitem', { name: /Monatsertrag je Stockwerk/ });
    expect(monthly).toHaveAttribute('aria-disabled', 'true');
    expect(monthly).toHaveTextContent('wird berechnet …');
    fireEvent.click(monthly);
    expect(downloads).toHaveLength(0);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(menu, { key: 'Escape' });

    act(() => useDataStore.getState().setWeather({ status: 'ready', series }));
    menu = openMenu();
    const enabled = within(menu).getByRole('menuitem', { name: /Monatsertrag je Stockwerk/ });
    expect(enabled).not.toHaveAttribute('aria-disabled');
    fireEvent.click(enabled);
    expect(downloads).toHaveLength(1);
    // The clear-sky series is marked in the file name.
    expect(downloads[0].name).toBe('verschattung-monatsertrag-47.100-N-7.450-E-2025-klarer-himmel.csv');
    // UTF-8 byte order mark for spreadsheet software.
    expect(Array.from((await readBytes(downloads[0].blob)).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const csv = await readBlob(downloads[0].blob);
    const lines = csv
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\r\n');
    expect(lines).toHaveLength(14);
    expect(lines[0].startsWith('Monat;1. OG: Ertrag (kWh)')).toBe(true);
    expect(lines[13].startsWith('Jahr;')).toBe(true);
  });

  it('exports the tilt comparison and the shade heatmap as CSV', async () => {
    useUiStore.getState().setLang('en');
    act(() => useDataStore.getState().setWeather({ status: 'ready', series }));
    render(<ExportMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const menu = screen.getByRole('menu', { name: 'Export and import' });
    const tilt = await within(menu).findByRole('menuitem', { name: /^Tilt comparison CSV$/ });
    fireEvent.click(tilt);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Shade heatmap Floor 1/ }));

    expect(downloads.map((d) => d.name)).toEqual([
      'shading-tilt-comparison-47.100-N-7.450-E-2025-clear-sky.csv',
      'shading-shade-heatmap-47.100-N-7.450-E-Floor-1-2025.csv',
    ]);
    const tiltCsv = (await readBlob(downloads[0].blob)).replace(/^\uFEFF/, '').split('\r\n');
    expect(tiltCsv[0]).toBe(
      'Tilt from vertical θ (°),Tilt from horizontal β (°),Floor 1: annual yield (kWh),Floor 2: annual yield (kWh),Total: annual yield (kWh)',
    );
    expect(tiltCsv).toHaveLength(21); // header + 19 tilts + final newline
    const heat = (await readBlob(downloads[1].blob))
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\r\n');
    expect(heat).toHaveLength(366);
    expect(heat[1].startsWith('2025-01-01,')).toBe(true);
  });

  it('prints a report in the light theme with an inputs appendix, then restores the theme', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    render(<ExportMenu />);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /Bericht drucken/ }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));

    expect(useUiStore.getState().theme).toBe('dark');
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(useUiStore.getState().theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement).toHaveClass('ssa-printing');
    const report = screen.getByRole('region', { name: 'Eingaben dieses Berichts' });
    expect(within(report).getByText('Fassadenausrichtung').nextSibling).toHaveTextContent('202° SSW');
    expect(within(report).getByText(/#c=/)).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(useUiStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement).not.toHaveClass('ssa-printing');
    expect(screen.queryByRole('region', { name: 'Eingaben dieses Berichts' })).toBeNull();
  });
});
