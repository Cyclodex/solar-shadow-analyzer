import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, onTestFinished } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { clearSkyYear } from '../model/weather';
import { downloadText } from '../export/download';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { MonthlyTable } from './MonthlyTable';

vi.mock('../export/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../export/download')>()),
  downloadText: vi.fn(),
}));

const series = clearSkyYear(DEFAULT_CONFIG.location.latitude, DEFAULT_CONFIG.location.longitude, 2025);

describe('MonthlyTable', () => {
  beforeEach(() => {
    resetStores();
    vi.mocked(downloadText).mockClear();
    useConfigStore.getState().patch('horizon', { terrainEnabled: false });
  });

  it('waits for the simulation; the CSV button is disabled', () => {
    render(<MonthlyTable />);
    expect(screen.getByText('Die Monatswerte werden berechnet …')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Monatstabelle als CSV herunterladen' })).toBeDisabled();
  });

  it('is busy and exports nothing while an annual input still loads', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    act(() => {
      useConfigStore.getState().patch('horizon', { terrainEnabled: true });
      useDataStore.getState().setTerrain({ status: 'loading' });
    });
    const { container } = render(<MonthlyTable />);
    const csv = screen.getByRole('button', { name: 'Monatstabelle als CSV herunterladen' });
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(csv).toBeDisabled();
    fireEvent.click(csv);
    expect(downloadText).not.toHaveBeenCalled();

    act(() => useDataStore.getState().setTerrain({ status: 'error' }));
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(csv).toBeEnabled();
  });

  it('lists 12 months and the year per floor with loss and shaded hours', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    render(<MonthlyTable />);
    const table = screen.getByRole('table', { name: 'Monatswerte 2025' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'Monat',
      '1. OGkWh',
      '2. OGkWh',
      'TotalkWh',
      'VerlustkWh',
      'Verlust%',
      'Verschattet 1. OGh',
    ]);
    const [head, body, foot] = within(table).getAllByRole('rowgroup');
    expect(head).toBeDefined();
    expect(within(body).getAllByRole('row')).toHaveLength(12);
    expect(within(foot).getByRole('rowheader')).toHaveTextContent('Jahr');
    // The month of the selected date (21 June) is marked.
    const june = within(body).getByRole('rowheader', { name: 'Juni' }).closest('tr')!;
    expect(june).toHaveAttribute('aria-current', 'true');
    expect(
      screen.getByText(/Verschattete Stunden: Stunden mit direkter Sonne auf 1\. OG/),
    ).toBeInTheDocument();
  });

  it('names the scroll region by the table caption, not by the card title', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    render(<MonthlyTable />);
    const region = screen.getByRole('region', { name: 'Monatswerte 2025' });
    expect(region.tagName).toBe('DIV');
    expect(within(region).getByRole('table', { name: 'Monatswerte 2025' })).toBeInTheDocument();
    // Only the card itself is called "Monatstabelle".
    expect(screen.getAllByRole('region', { name: 'Monatstabelle' })).toHaveLength(1);
  });

  it("exports the export menu's monthly CSV plus the shaded hours (Swiss spreadsheet: semicolons)", () => {
    // The CSV dialect follows the browser's regional preference (see userCsvFormat).
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-CH']);
    onTestFinished(() => languages.mockRestore());
    useDataStore.getState().setWeather({ status: 'ready', series });
    render(<MonthlyTable />);
    fireEvent.click(screen.getByRole('button', { name: 'Monatstabelle als CSV herunterladen' }));
    expect(downloadText).toHaveBeenCalledTimes(1);
    const [csv, filename, mime, opts] = vi.mocked(downloadText).mock.calls[0];
    expect(filename).toBe('verschattung-monatstabelle-47.100-N-7.450-E-2025-klarer-himmel.csv');
    expect(mime).toBe('text/csv;charset=utf-8');
    expect(opts).toEqual({ bom: true });
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(14);
    expect(lines[0].split(';')).toEqual([
      'Monat',
      '1. OG: Ertrag (kWh)',
      '1. OG: ohne Verschattung (kWh)',
      '1. OG: Verschattungsverlust (kWh)',
      '2. OG: Ertrag (kWh)',
      '2. OG: ohne Verschattung (kWh)',
      '2. OG: Verschattungsverlust (kWh)',
      'Total: Ertrag (kWh)',
      'Total: ohne Verschattung (kWh)',
      'Total: Verschattungsverlust (kWh)',
      'Total: Verschattungsverlust (%)',
      '1. OG: verschattete Stunden (h)',
    ]);
    expect(lines[1]).toMatch(/^Januar(;\d+(\.\d{1,2})?){11}$/);
    // Year row: total = sum of the floors (rounded to 0.01 kWh); shaded hours as in the table.
    const year = lines[13].split(';');
    expect(year[0]).toBe('Jahr');
    expect(Number(year[7])).toBeCloseTo(Number(year[1]) + Number(year[4]), 1);
    const tableYear = within(screen.getByRole('table')).getAllByRole('row').at(-1)!;
    const tableHours = within(tableYear).getAllByRole('cell').at(-1)!.textContent.replace(/\D/g, '');
    expect(Number(tableHours)).toBe(Math.round(Number(year[11])));
  });

  it('English CSV headers; a single floor has no shaded-hours column', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    act(() => {
      useUiStore.getState().setLang('en');
      useConfigStore.getState().patch('building', { numFloors: 1 });
    });
    render(<MonthlyTable />);
    expect(screen.getByText(/Single floor: no shading by panels\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download the monthly table as CSV' }));
    const [csv, filename] = vi.mocked(downloadText).mock.calls[0];
    expect(filename).toBe('shading-monthly-table-47.100-N-7.450-E-2025-clear-sky.csv');
    expect(csv.split('\r\n')[0]).toBe(
      'Month,Floor 1: yield (kWh),Floor 1: without shading (kWh),Floor 1: shading loss (kWh),' +
        'Total: yield (kWh),Total: without shading (kWh),Total: shading loss (kWh),Total: shading loss (%)',
    );
  });
});
