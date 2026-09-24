import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('exports the table as CSV', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    render(<MonthlyTable />);
    fireEvent.click(screen.getByRole('button', { name: 'Monatstabelle als CSV herunterladen' }));
    expect(downloadText).toHaveBeenCalledTimes(1);
    const [csv, filename, mime, opts] = vi.mocked(downloadText).mock.calls[0];
    expect(filename).toBe('monatstabelle-47.100-N-7.450-E-2025.csv');
    expect(mime).toBe('text/csv;charset=utf-8');
    expect(opts).toEqual({ bom: true });
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(14);
    expect(lines[0]).toBe(
      'Monat,1. OG (kWh),2. OG (kWh),Total (kWh),Verlust (kWh),Verlust (%),Verschattete Stunden 1. OG (h)',
    );
    expect(lines[1]).toMatch(/^Januar,\d+(\.\d)?,\d+(\.\d)?,\d+(\.\d)?,\d+(\.\d)?,\d+(\.\d)?,\d+(\.\d)?$/);
    // Year row: total = sum of the floors (rounded to 0.1 kWh).
    const year = lines[13].split(',');
    expect(year[0]).toBe('Jahr');
    expect(Number(year[3])).toBeCloseTo(Number(year[1]) + Number(year[2]), 0);
  });

  it('English CSV headers; a single floor has no loss columns', () => {
    useDataStore.getState().setWeather({ status: 'ready', series });
    act(() => {
      useUiStore.getState().setLang('en');
      useConfigStore.getState().patch('building', { numFloors: 1 });
    });
    render(<MonthlyTable />);
    expect(screen.getByText(/Single floor: no shading by panels\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download the monthly table as CSV' }));
    const [csv, filename] = vi.mocked(downloadText).mock.calls[0];
    expect(filename).toBe('monthly-table-47.100-N-7.450-E-2025.csv');
    expect(csv.split('\r\n')[0]).toBe('Month,Floor 1 (kWh)');
  });
});
