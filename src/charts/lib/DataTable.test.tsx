import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetStores } from '../../test/utils';
import { ChartDataTable } from './DataTable';

const columns = [
  { key: 'k', header: 'Monat' },
  { key: 'v', header: 'kWh', numeric: true },
];
const rows = [{ key: 'jan', cells: ['Januar', '12'] }];

function open(summary: HTMLElement): void {
  const details = summary.closest('details')!;
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
}

describe('ChartDataTable', () => {
  beforeEach(resetStores);

  it('names each scroll region by its caption and tells the disclosures apart', () => {
    render(
      <>
        <ChartDataTable caption="Leistung am 21. Juni" context="Tagesverlauf" columns={columns} rows={rows} />
        <ChartDataTable
          caption="Jahresertrag je Neigung"
          context="Neigungsvergleich"
          columns={columns}
          rows={rows}
        />
      </>,
    );
    const summaries = screen.getAllByText('Werte als Tabelle');
    expect(summaries.map((s) => s.textContent)).toEqual([
      'Werte als Tabelle: Tagesverlauf',
      'Werte als Tabelle: Neigungsvergleich',
    ]);
    summaries.forEach(open);
    const regions = screen.getAllByRole('region');
    expect(regions.map((r) => r.getAttribute('aria-labelledby'))).not.toContain(null);
    expect(screen.getByRole('region', { name: 'Leistung am 21. Juni' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('region', { name: 'Jahresertrag je Neigung' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Jahresertrag je Neigung' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Werte als Tabelle' })).not.toBeInTheDocument();
  });
});
