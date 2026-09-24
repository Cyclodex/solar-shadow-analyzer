import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConfigStore } from '../state/configStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { PanelSection } from './PanelSection';

const panels = () => useConfigStore.getState().config.panels;

/** Value cell (<dd>) of a derived value row. */
function derived(term: RegExp): string {
  const dt = screen.getByText(term, { selector: 'dt' });
  return dt.parentElement?.querySelector('dd')?.textContent?.replace(/\s/g, ' ') ?? '';
}

describe('PanelSection', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.setState({ openSections: { panels: true } });
  });

  it('shows the matching module preset and "Benutzerdefiniert" once the values differ', () => {
    render(<PanelSection />);
    const select = screen.getByRole('combobox', { name: 'Modultyp' });
    expect(select).toHaveValue('c144-1762x1134');
    const width = screen.getByRole('textbox', { name: 'Breite entlang des Geländers' });
    fireEvent.change(width, { target: { value: '170' } });
    fireEvent.blur(width);
    expect(panels().width).toBe(170);
    expect(select).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Benutzerdefiniert' })).toBeInTheDocument();
  });

  it('swaps length and width between landscape and portrait and keeps the orientation for presets', () => {
    render(<PanelSection />);
    const landscape = screen.getByRole('radio', { name: /^Querformat/ });
    const portrait = screen.getByRole('radio', { name: /^Hochformat/ });
    expect(landscape).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(portrait);
    expect(panels()).toMatchObject({ length: 176.2, width: 113.4 });
    expect(portrait).toHaveAttribute('aria-checked', 'true');
    // Still the same module: the preset matches in either orientation.
    expect(screen.getByRole('combobox', { name: 'Modultyp' })).toHaveValue('c144-1762x1134');

    fireEvent.change(screen.getByRole('combobox', { name: 'Modultyp' }), {
      target: { value: 'c108-1961x1134' },
    });
    expect(panels()).toMatchObject({ length: 196.1, width: 113.4, powerWp: 490 });

    fireEvent.click(landscape);
    expect(panels()).toMatchObject({ length: 113.4, width: 196.1 });
  });

  it('derives row width, power, extents, clearance and the critical profile angle', () => {
    render(<PanelSection />);
    expect(screen.getByText('Abgeleitete Werte bei θ = 45°')).toBeInTheDocument();
    expect(derived(/^Reihenbreite/)).toBe('3.54 m');
    expect(derived(/^Leistung je Stockwerk/)).toBe('860 Wp');
    expect(derived(/^Leistung gesamt \(2 Stockwerke\)/)).toBe('1.72 kWp');
    expect(derived(/^Vertikale Ausdehnung/)).toBe('80 cm');
    expect(derived(/^Ausladung/)).toBe('80 cm');
    expect(derived(/^Freiraum zur Reihe darunter/)).toBe('200 cm');
    expect(derived(/^Kritischer Profilwinkel/)).toBe('68.1°');
  });

  it('reports overlapping rows instead of a negative clearance', () => {
    act(() => {
      useConfigStore.getState().patch('building', { floorHeight: 200 });
      useConfigStore.getState().patch('panels', { length: 250, tiltFromVertical: 0 });
    });
    render(<PanelSection />);
    expect(derived(/^Überlappung/)).toBe('50 cm');
    expect(screen.queryByText(/^Freiraum/)).not.toBeInTheDocument();
    expect(derived(/^Kritischer Profilwinkel/)).toBe('–');
    expect(screen.getByRole('note')).toHaveTextContent('Die Reihen überlappen um 50');
  });

  it('says "nie" for vertical panels, like the KPI bar', () => {
    act(() => useConfigStore.getState().patch('panels', { tiltFromVertical: 0 }));
    render(<PanelSection />);
    expect(derived(/^Kritischer Profilwinkel/)).toBe('nie');
  });

  it('has no row above with a single floor', () => {
    act(() => useConfigStore.getState().patch('building', { numFloors: 1 }));
    render(<PanelSection />);
    expect(derived(/^Kritischer Profilwinkel/)).toBe('keine Reihe darüber');
    expect(derived(/^Leistung gesamt$/)).toBe('0.86 kWp');
    expect(screen.queryByText(/^Freiraum/)).not.toBeInTheDocument();
  });

  it('edits count, gap and power', () => {
    render(<PanelSection />);
    fireEvent.change(screen.getByRole('slider', { name: 'Module nebeneinander' }), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByRole('slider', { name: 'Abstand zwischen Modulen' }), {
      target: { value: '5' },
    });
    fireEvent.change(screen.getByRole('slider', { name: 'Nennleistung je Modul' }), {
      target: { value: '400' },
    });
    expect(panels()).toMatchObject({ count: 3, gap: 5, powerWp: 400 });
    expect(derived(/^Leistung je Stockwerk/)).toMatch(/^1.200 Wp$/); // grouping sign depends on the ICU version
  });

  it('renders in English', () => {
    useUiStore.getState().setLang('en');
    render(<PanelSection />);
    expect(screen.getByRole('radio', { name: /^Landscape/ })).toHaveAttribute('aria-checked', 'true');
    expect(derived(/^Critical profile angle/)).toBe('68.1°');
  });
});
