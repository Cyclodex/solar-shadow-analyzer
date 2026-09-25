import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { KpiBar } from '../app/KpiBar';
import { useBattery, useBatteryEconomics } from '../hooks/useModel';
import { getFormat } from '../i18n';
import { DEFAULT_CONFIG } from '../model/defaults';
import { clearSkyYear } from '../model/weather';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useTimeStore } from '../state/timeStore';
import { resetStores } from '../test/utils';
import { BatteryDayChart } from './BatteryDayChart';
import { BatteryMonthlyChart } from './BatteryMonthlyChart';
import { EconomicsCard } from './EconomicsCard';

const series = clearSkyYear(DEFAULT_CONFIG.location.latitude, DEFAULT_CONFIG.location.longitude, 2025);
const f = getFormat('de');
const n = (s: string): string => s.replace(/\s+/g, ' ');

function withWeather(): void {
  act(() => {
    useConfigStore.getState().patch('horizon', { terrainEnabled: false });
    useConfigStore.getState().patch('battery', { enabled: true });
    useDataStore.getState().setWeather({ status: 'ready', series });
  });
}

describe('battery results in the UI', () => {
  beforeEach(() => resetStores());

  it('the hooks are null while the storage is off', () => {
    act(() => useDataStore.getState().setWeather({ status: 'ready', series }));
    const { result } = renderHook(() => [useBattery(), useBatteryEconomics()]);
    expect(result.current).toEqual([null, null]);
  });

  it('KPIs show the extra yield, self-consumption, self-sufficiency and cycles of the model', () => {
    withWeather();
    const { result } = renderHook(() => useBattery());
    const r = result.current!;
    render(<KpiBar />);
    const group = screen.getByRole('heading', { name: 'Batterie 2025' }).parentElement!;
    expect(group).toHaveTextContent(n(`+${f.num(r.extraOutputKwh)} kWh`));
    expect(group).toHaveTextContent(n(f.pct(r.selfConsumptionPct)));
    expect(group).toHaveTextContent(n(`ohne Batterie ${f.pct(r.baselineAutarkyPct)}`));
    expect(group).toHaveTextContent(n(`${f.num(r.cycles)} pro Jahr`));
    expect(group).toHaveTextContent(n('Speicher 7.68 kWh'));
  });

  it('the monthly chart describes the flows and switches to the comparison without battery', () => {
    withWeather();
    render(<BatteryMonthlyChart />);
    const card = screen.getByRole('region', { name: 'Energiefluss mit Batterie' });
    expect(within(card).getByRole('img', { name: 'Energiefluss mit Batterie' })).toBeInTheDocument();
    const slider = within(card).getByRole('slider', { name: 'Monat im Diagramm' });
    expect(slider.getAttribute('aria-valuetext')).toMatch(/^Januar: Speicherverluste/);
    fireEvent.click(within(card).getByRole('radio', { name: 'Ohne Batterie' }));
    expect(within(card).getByText('Autarkie').parentElement).toBeInTheDocument();
  });

  it('the day chart shows the selected date in the weather year with hourly readouts', () => {
    withWeather();
    act(() => useTimeStore.getState().setDate('2026-06-21'));
    render(<BatteryDayChart />);
    const card = screen.getByRole('region', { name: 'Tagesverlauf mit Batterie' });
    expect(card).toHaveTextContent('21. Juni 2025');
    const slider = within(card).getByRole('slider', { name: 'Stunde im Diagramm' });
    expect(slider).toHaveAttribute('aria-valuemax', '23');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider.getAttribute('aria-valuetext')).toMatch(/00:00–01:00: Solarleistung 0\sW/);
  });

  it('economics compares with and without battery (same flows as the model)', () => {
    withWeather();
    const { result } = renderHook(() => useBatteryEconomics());
    const e = result.current!;
    render(<EconomicsCard />);
    const table = screen.getByRole('table', { name: 'Wirtschaftlichkeit mit und ohne Batterie' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Ohne Batterie');
    expect(rows[1]).toHaveTextContent(n(f.num(e.withoutBattery.annualSavings)));
    expect(rows[2]).toHaveTextContent('Mit Batterie');
    expect(rows[2]).toHaveTextContent(n(f.currency(1800 + 2998, 'CHF', 0)));
    expect(e.withBattery.investment).toBe(1800 + 2998);
    expect(e.cashFlowWith[0]).toBe(-(1800 + 2998));
    expect(e.cashFlowWith.at(-1)).toBeCloseTo(e.withBattery.lifetimeNet, 9);
    expect(screen.getByText(/beide Varianten mit derselben AC-Grenze \(600\sW\)/)).toBeInTheDocument();
  });

  it('with battery, the investment drops by what the storage replaces', () => {
    withWeather();
    act(() => useConfigStore.getState().patch('battery', { replacedInvestment: 500 }));
    const { result } = renderHook(() => useBatteryEconomics());
    expect(result.current!.withBattery.investment).toBe(1800 - 500 + 2998);
    expect(result.current!.withoutBattery.investment).toBe(1800);
  });
});
