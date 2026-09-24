import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getFormat } from '../i18n';
import { DEFAULT_CONFIG } from '../model/defaults';
import { economics } from '../model/economics';
import { clearSkyYear } from '../model/weather';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { useSimulation } from '../hooks/useModel';
import { EconomicsCard } from './EconomicsCard';

const series = clearSkyYear(DEFAULT_CONFIG.location.latitude, DEFAULT_CONFIG.location.longitude, 2025);
const f = getFormat('de');
/** Formatted values contain non-breaking spaces; toHaveTextContent compares normalised whitespace. */
const n = (s: string): string => s.replace(/\s+/g, ' ');

/** The annual yield the card works with (shared model cache). */
function simulatedKwh(): { total: number; floors: number[] } {
  const { result } = renderHook(() => useSimulation());
  const sim = result.current;
  if (!sim) throw new Error('no simulation');
  return { total: sim.totalAnnualKwh, floors: sim.floors.map((fl) => fl.annualKwh) };
}

function figure(label: string): HTMLElement {
  return screen.getByText(label, { selector: 'dt' }).parentElement as HTMLElement;
}

describe('EconomicsCard', () => {
  beforeEach(() => {
    resetStores();
    useConfigStore.getState().patch('horizon', { terrainEnabled: false });
  });

  it('shows a busy state until a simulation exists', () => {
    render(<EconomicsCard />);
    expect(screen.getByRole('heading', { name: 'Wirtschaftlichkeit' })).toBeInTheDocument();
    expect(screen.getByText('Wirtschaftlichkeit wird berechnet …')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('shows savings, payback and balance per floor and in total, from the model', () => {
    act(() => useDataStore.getState().setWeather({ status: 'ready', series }));
    const kwh = simulatedKwh();
    const e = DEFAULT_CONFIG.economics;
    const total = economics(kwh.total, 2, e);
    render(<EconomicsCard />);

    expect(figure('Ersparnis pro Jahr')).toHaveTextContent(n(f.currency(total.annualSavings, 'CHF', 0)));
    expect(figure('Amortisationsdauer')).toHaveTextContent(`${f.num(total.paybackYears, 1)} Jahre`);
    expect(figure('Amortisationsdauer')).toHaveTextContent(n(`Investition ${f.currency(1800, 'CHF', 0)}`));
    expect(figure('Bilanz nach 25 Jahren')).toHaveTextContent(n(f.currency(total.lifetimeNet, 'CHF', 0)));

    const table = screen.getByRole('table', { name: 'Wirtschaftlichkeit je Stockwerk' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4); // header, 2 floors (top first), total
    const upper = economics(kwh.floors[1], 1, e);
    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('2. OG');
    expect(
      within(rows[1])
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual([f.num(upper.annualSavings), f.num(upper.paybackYears, 1), f.num(upper.lifetimeNet)]);
    expect(within(rows[3]).getByRole('rowheader')).toHaveTextContent('Total');
    expect(within(rows[3]).getAllByRole('cell')[2]).toHaveTextContent(f.num(total.lifetimeNet));

    // Assumptions are named as such, with the values in use.
    const footer = screen.getByText(/^Annahmen – Beispielwerte/);
    expect(footer).toHaveTextContent(n(`Strompreis ${f.currency(0.3, 'CHF')}/kWh`));
    expect(footer).toHaveTextContent(n(`Eigenverbrauch ${f.pct(70)}`));
    expect(footer).toHaveTextContent('Konstante Preise, ohne Diskontierung und ohne laufende Kosten.');
    expect(footer).toHaveTextContent('Theoretisches Maximum bei klarem Himmel');
  });

  it('charts the cumulative balance with a break-even marker and a keyboard year cursor', () => {
    act(() => useDataStore.getState().setWeather({ status: 'ready', series }));
    const kwh = simulatedKwh();
    const e = DEFAULT_CONFIG.economics;
    const total = economics(kwh.total, 2, e);
    const after = (years: number): number =>
      economics(kwh.total, 2, { ...e, lifetimeYears: years }).lifetimeNet;
    render(<EconomicsCard />);

    expect(screen.getByText(`Amortisation nach ${f.num(total.paybackYears, 1)} Jahren`)).toBeInTheDocument();
    const cursor = screen.getByRole('slider', { name: /Kumulierte Bilanz über 25 Jahre/ });
    expect(cursor).toHaveAttribute('aria-valuemax', '25');
    expect(cursor).toHaveAttribute('aria-valuetext', `Jahr 25: ${f.currency(total.lifetimeNet, 'CHF', 0)}`);

    fireEvent.keyDown(cursor, { key: 'Home' });
    expect(cursor).toHaveAttribute('aria-valuetext', `Jahr 0: ${f.currency(-1800, 'CHF', 0)}`);
    fireEvent.keyDown(cursor, { key: 'ArrowRight' });
    fireEvent.keyDown(cursor, { key: 'PageUp' });
    expect(cursor).toHaveAttribute('aria-valuenow', '6');
    expect(cursor).toHaveAttribute('aria-valuetext', `Jahr 6: ${f.currency(after(6), 'CHF', 0)}`);
    fireEvent.keyDown(cursor, { key: 'End' });
    fireEvent.keyDown(cursor, { key: 'ArrowRight' }); // clamped
    expect(cursor).toHaveAttribute('aria-valuenow', '25');
  });

  it('handles payback beyond the evaluation period and never', () => {
    act(() => useDataStore.getState().setWeather({ status: 'ready', series }));
    useConfigStore.getState().patch('economics', { investmentPerFloor: 20000, lifetimeYears: 10 });
    const { unmount } = render(<EconomicsCard />);
    expect(figure('Amortisationsdauer')).toHaveTextContent('länger als die Betrachtungsdauer (10 Jahre)');
    expect(screen.queryByText(/^Amortisation nach/)).toBeNull();
    expect(figure('Bilanz nach 10 Jahren').textContent).toMatch(/−/);
    unmount();

    act(() => useConfigStore.getState().patch('economics', { electricityPrice: 0, feedInTariff: 0 }));
    render(<EconomicsCard />);
    expect(figure('Amortisationsdauer')).toHaveTextContent('nie');
  });

  it('renders in English with the configured currency', () => {
    act(() => useDataStore.getState().setWeather({ status: 'ready', series }));
    useUiStore.getState().setLang('en');
    useConfigStore.getState().patch('economics', { currency: 'EUR', lifetimeYears: 1 });
    render(<EconomicsCard />);
    expect(screen.getByRole('heading', { name: 'Economics' })).toBeInTheDocument();
    expect(screen.getByText('Savings, payback and balance over 1 year')).toBeInTheDocument();
    expect(figure('Balance after 1 year').textContent).toContain('EUR');
    expect(screen.getByRole('columnheader', { name: 'Savings per year EUR' })).toBeInTheDocument();
    expect(screen.getByText(/^Assumptions – example values/)).toHaveTextContent(
      n(`electricity price ${getFormat('en').currency(0.3, 'EUR')}/kWh`),
    );
  });
});
