import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getFormat } from '../i18n';
import { DEFAULT_CONFIG } from '../model/defaults';
import { useConfigStore } from '../state/configStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { EconomicsSection } from './EconomicsSection';

const economicsConfig = () => useConfigStore.getState().config.economics;

function commit(label: string | RegExp, value: string): void {
  const input = screen.getByRole('textbox', { name: label });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('EconomicsSection', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.getState().setSectionOpen('economics', true);
  });

  it('marks the values as examples and derives hints from the model', () => {
    render(<EconomicsSection />);
    expect(screen.getByRole('button', { name: /Wirtschaftlichkeit/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText(/^Beispielwerte – bitte an den eigenen Stromtarif/)).toBeInTheDocument();
    // 70 % × 0.30 + 30 % × 0.08 = 0.234 per kWh
    expect(screen.getByText(/Wert einer erzeugten kWh: CHF\s0.234/)).toBeInTheDocument();
    // 2 floors × 900
    const total = getFormat('de').currency(1800, 'CHF', 0).replace(/\s/g, ' ');
    expect(
      screen.getByText(`Module, Wechselrichter, Montage · total ${total} für 2 Stockwerke`),
    ).toBeInTheDocument();
  });

  it('offers CHF, EUR, USD and GBP and keeps a custom currency label', () => {
    render(<EconomicsSection />);
    const select = screen.getByRole('combobox', { name: 'Währung' });
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(['CHF', 'EUR', 'USD', 'GBP']);
    expect(screen.getByRole('option', { name: /^CHF – / })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'EUR' } });
    expect(economicsConfig().currency).toBe('EUR');
    expect(screen.getAllByText('EUR/kWh')).toHaveLength(2);

    act(() => useConfigStore.getState().patch('economics', { currency: 'Fr.' }));
    expect(screen.getByRole('option', { name: 'Fr. (eigene Angabe)' })).toBeInTheDocument();
    expect(select).toHaveValue('Fr.');
  });

  it('edits prices, shares, investment, degradation and period', () => {
    render(<EconomicsSection />);
    commit('Strompreis (Bezug)', '0.3214');
    commit('Einspeisevergütung', '0.12');
    commit('Eigenverbrauchsanteil', '55');
    commit('Investition je Stockwerk', '1250');
    commit('Degradation', '0.8');
    commit('Betrachtungsdauer', '99'); // clamped to the limit
    expect(economicsConfig()).toMatchObject({
      electricityPrice: 0.3214,
      feedInTariff: 0.12,
      selfConsumptionPct: 55,
      investmentPerFloor: 1250,
      degradationPct: 0.8,
      lifetimeYears: 40,
    });
  });

  it('restores the example values', () => {
    render(<EconomicsSection />);
    const restore = screen.getByRole('button', { name: 'Beispielwerte wiederherstellen' });
    expect(restore).toBeDisabled();
    commit('Eigenverbrauchsanteil', '40');
    expect(restore).toBeEnabled();
    fireEvent.click(restore);
    expect(economicsConfig()).toEqual(DEFAULT_CONFIG.economics);
    expect(restore).toBeDisabled();
  });

  it('is translated', () => {
    useUiStore.getState().setLang('en');
    render(<EconomicsSection />);
    expect(screen.getByRole('combobox', { name: 'Currency' })).toBeInTheDocument();
    expect(screen.getByText(/^Example values – please adjust/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Evaluation period' })).toHaveValue('25');
  });
});
