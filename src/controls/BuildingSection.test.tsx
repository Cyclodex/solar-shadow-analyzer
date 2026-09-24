import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfigStore } from '../state/configStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { BuildingSection } from './BuildingSection';

const building = () => useConfigStore.getState().config.building;

function dial(): HTMLElement {
  return screen.getByRole('slider', { name: 'Fassadenausrichtung' });
}

describe('BuildingSection', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.setState({ openSections: { building: true } });
  });

  it('exposes the compass as a slider with the compass point as value text', () => {
    render(<BuildingSection />);
    const d = dial();
    expect(d).toHaveAttribute('aria-valuenow', '202');
    expect(d).toHaveAttribute('aria-valuemin', '0');
    expect(d).toHaveAttribute('aria-valuemax', '359');
    expect(d).toHaveAttribute('aria-valuetext', '202° SSW');
    expect(d).toHaveAccessibleDescription(/Pfeile ±1°/);
    expect(screen.getByText('Die Fassade schaut nach SSW.')).toBeInTheDocument();
  });

  it('turns the compass with the keyboard (±1°, Shift ±10°, 45° pages, wrap-around)', () => {
    render(<BuildingSection />);
    const d = dial();
    const press = (key: string, shiftKey = false): number => {
      fireEvent.keyDown(d, { key, shiftKey });
      return building().facadeAzimuth;
    };
    expect(press('ArrowRight')).toBe(203);
    expect(press('ArrowUp')).toBe(204);
    expect(press('ArrowLeft', true)).toBe(194);
    expect(press('ArrowDown')).toBe(193);
    expect(press('PageUp')).toBe(225);
    expect(press('PageUp')).toBe(270);
    expect(press('PageDown')).toBe(225);
    expect(press('Home')).toBe(0);
    expect(press('ArrowLeft')).toBe(359);
    expect(press('ArrowRight')).toBe(0);
    expect(press('End')).toBe(359);
    expect(press('PageUp')).toBe(0);
    expect(dial()).toHaveAttribute('aria-valuetext', '0° N');
  });

  it('turns the compass by clicking and dragging', () => {
    render(<BuildingSection />);
    const d = dial();
    vi.spyOn(d, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(d, { button: 0, pointerId: 1, clientX: 100, clientY: 50 }); // east
    expect(building().facadeAzimuth).toBe(90);
    expect(d).toHaveFocus();
    fireEvent.pointerMove(d, { pointerId: 1, clientX: 50, clientY: 100 }); // south
    expect(building().facadeAzimuth).toBe(180);
    fireEvent.pointerMove(d, { pointerId: 1, clientX: 0, clientY: 0 }); // north-west
    expect(building().facadeAzimuth).toBe(315);
    fireEvent.pointerUp(d, { pointerId: 1 });
    fireEvent.pointerMove(d, { pointerId: 1, clientX: 100, clientY: 50 }); // not dragging any more
    expect(building().facadeAzimuth).toBe(315);
  });

  it('keeps the number field and the compass in sync', () => {
    render(<BuildingSection />);
    const field = screen.getByRole('textbox', { name: 'Fassadenazimut' });
    fireEvent.change(field, { target: { value: '95' } });
    fireEvent.blur(field);
    expect(building().facadeAzimuth).toBe(95);
    expect(dial()).toHaveAttribute('aria-valuetext', '95° O');
  });

  it('previews the storeys that carry panels', () => {
    render(<BuildingSection />);
    expect(screen.getByText('Panels: 1. OG bis 2. OG')).toBeInTheDocument();
    const lowest = screen.getByRole('textbox', { name: 'Unterstes Panel-Stockwerk' });
    fireEvent.change(lowest, { target: { value: '0' } });
    fireEvent.blur(lowest);
    const floors = screen.getByRole('textbox', { name: 'Stockwerke mit Panels' });
    fireEvent.change(floors, { target: { value: '1' } });
    fireEvent.blur(floors);
    expect(building()).toMatchObject({ lowestFloor: 0, numFloors: 1 });
    expect(screen.getByText('Panels: EG')).toBeInTheDocument();
  });

  it('edits the balcony geometry', () => {
    render(<BuildingSection />);
    fireEvent.change(screen.getByRole('slider', { name: 'Geländerhöhe' }), { target: { value: '110' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Balkontiefe' }), { target: { value: '200' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Stockwerkhöhe' }), { target: { value: '300' } });
    expect(building()).toMatchObject({ railingHeight: 110, balconyDepth: 200, floorHeight: 300 });
  });

  it('renders in English', () => {
    useUiStore.getState().setLang('en');
    render(<BuildingSection />);
    expect(screen.getByRole('slider', { name: 'Facade orientation' })).toHaveAttribute(
      'aria-valuetext',
      '202° SSW',
    );
    expect(screen.getByText('Panels: Floor 1 to Floor 2')).toBeInTheDocument();
  });
});
