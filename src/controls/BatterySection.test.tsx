import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { useConfigStore } from '../state/configStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { BatterySection } from './BatterySection';

const battery = () => useConfigStore.getState().config.battery;

function commit(label: string | RegExp, value: string): void {
  const input = screen.getByRole('textbox', { name: label });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('BatterySection', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.getState().setSectionOpen('battery', true);
  });

  it('is off by default and shows the device settings once switched on', () => {
    render(<BatterySection />);
    const toggle = screen.getByRole('switch', { name: 'Batteriespeicher berechnen' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('combobox', { name: 'Gerät' })).toBeNull();
    fireEvent.click(toggle);
    expect(battery().enabled).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Gerät' })).toHaveValue('ecoflow-stream-ultra-x');
    expect(screen.getByRole('link', { name: 'Herstellerangaben' })).toHaveAttribute(
      'href',
      'https://eu.ecoflow.com/products/stream-ultra-x',
    );
    // 2 × 3840 Wh
    expect(screen.getByText(/Speicher total 7.68\skWh · höchstens 6 laut Hersteller/)).toBeInTheDocument();
  });

  it('scales a preset with the number of units and leaves it when a device value is edited', () => {
    useConfigStore.getState().patch('battery', { enabled: true });
    render(<BatterySection />);
    commit('Anzahl Einheiten', '3');
    expect(battery()).toMatchObject({ units: 3, pvInputW: 6000, chargeW: 4500, dischargeW: 3600 });
    commit('Max. Ladeleistung je System', '2000');
    expect(battery().preset).toBe('custom');
    expect(screen.getByRole('combobox', { name: 'Gerät' })).toHaveValue('custom');
  });

  it('applies another preset and hides the base load in self-consumption mode', () => {
    useConfigStore.getState().patch('battery', { enabled: true });
    render(<BatterySection />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Gerät' }), {
      target: { value: 'zendure-solarflow-800-pro' },
    });
    expect(battery()).toMatchObject({ unitCapacityWh: 1920, pvInputW: 2640, chargeW: 2000, minSocPct: 5 });
    expect(screen.getByRole('textbox', { name: 'Grundlast (Abgabe) je System' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Betriebsart' }), {
      target: { value: 'self-consumption' },
    });
    expect(battery().strategy).toBe('self-consumption');
    expect(screen.queryByRole('textbox', { name: 'Grundlast (Abgabe) je System' })).toBeNull();
  });

  it('offers the layout only for several floors and restores the defaults', () => {
    useConfigStore.getState().patch('battery', { enabled: true, acLimitW: 800 });
    const { rerender } = render(<BatterySection />);
    expect(screen.getByRole('radiogroup', { name: 'Aufbau' })).toBeInTheDocument();
    useConfigStore.getState().patch('building', { numFloors: 1 });
    rerender(<BatterySection />);
    expect(screen.queryByRole('radiogroup', { name: 'Aufbau' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Standardwerte wiederherstellen' }));
    expect(battery()).toEqual({ ...DEFAULT_CONFIG.battery, enabled: true });
  });
});
