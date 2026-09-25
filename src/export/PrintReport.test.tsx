import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Building } from '../model/types';
import { useConfigStore } from '../state/configStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { PrintReport } from './PrintReport';

/** Value of the row with the given term. */
const row = (term: string): string | null =>
  screen.getByText(term, { selector: 'dt' }).nextElementSibling?.textContent ?? null;

describe('PrintReport', () => {
  beforeEach(() => {
    resetStores();
  });

  it('lists the automatic coordinate label and the coordinates in the report language', () => {
    render(<PrintReport printedAt={Date.UTC(2025, 5, 21, 10)} />);
    expect(row('Name')).toBe('47.100° N, 7.450° O');
    expect(row('Koordinaten')).toBe('47.100000° N, 7.450000° O');
  });

  it('keeps a chosen name and uses the English terms', () => {
    useConfigStore.getState().patch('location', { name: 'My balcony', latitude: -33.8688, longitude: -70.5 });
    useUiStore.getState().setLang('en');
    render(<PrintReport printedAt={Date.UTC(2025, 5, 21, 10)} />);
    expect(row('Name')).toBe('My balcony');
    expect(row('Coordinates')).toBe('33.868800° S, 70.500000° W');
    expect(row('Floor-to-floor height')).toMatch(/^280\scm$/);
  });

  it('gives the tilt from vertical with β = 90° − θ from horizontal (θ = 30°, where they differ)', () => {
    useConfigStore.getState().patch('panels', { tiltFromVertical: 30 });
    render(<PrintReport printedAt={Date.UTC(2025, 5, 21, 10)} />);
    expect(row('Neigung θ ab Senkrechte')).toBe('30° (β = 60° ab Horizontal)');
  });

  it('without surroundings: no position row and no surroundings group', () => {
    render(<PrintReport printedAt={Date.UTC(2025, 5, 21, 10)} />);
    expect(screen.queryByText('Lage am Gebäude')).toBeNull();
    expect(screen.queryByText('Umgebung')).toBeNull();
  });

  it('surroundings: position on the building, buildings, import, laser scan and sources', () => {
    const anchor = { latitude: 47.1, longitude: 7.45, radius: 300, date: '2026-09-25' };
    const box = (e0: number, n0: number, e1: number, n1: number): [number, number][] => [
      [e0, n0],
      [e1, n0],
      [e1, n1],
      [e0, n1],
    ];
    const b = (id: string, footprint: [number, number][], over: Partial<Building> = {}): Building => ({
      id,
      name: '',
      footprint,
      base: 0,
      height: 12,
      source: 'swisstopo',
      ...over,
    });
    useConfigStore.getState().patch('building', { facadeAzimuth: 180 });
    useConfigStore.getState().patch('horizon', {
      buildingImport: anchor,
      buildings: [
        b('b1', box(-8, 0, 8, 12)), // own: the location (the anchor) lies on its south wall
        b('b2', box(-8, -30, 8, -20), { edited: true }),
        b('b3', box(20, -30, 30, -20), { removed: true }),
        b('b4', box(-30, -30, -20, -20), { source: 'manual' }),
      ],
      surfaceModel: { enabled: true, trees: false, radius: 250 },
    });
    const { unmount } = render(<PrintReport printedAt={Date.UTC(2025, 5, 21, 10)} />);
    expect(row('Lage am Gebäude')).toBe(
      'Balkon auf der Fassade 180° S, im Lageplan gesetzt; Koordinaten auf 0.000001° (höchstens 0.07 m)',
    );
    expect(row('Umgebungsgebäude')).toBe('3 (1 von Hand, 1 bearbeitet, 1 entfernt)');
    expect(row('Gebäude-Import')).toMatch(/^swisstopo, Stand 25\. September 2026, Umkreis 300\sm$/);
    expect(row('Laserscan (swissSURFACE3D)')).toMatch(/^ein, nur Gebäude, Umkreis 250\sm$/);
    expect(row('Datenquellen')).toBe('© swisstopo');
    unmount();

    // Not on a facade (e.g. the address point inside the building), laser scan off, English.
    useConfigStore.getState().patch('building', { facadeAzimuth: 90 });
    useConfigStore.getState().patch('horizon', {
      surfaceModel: { enabled: false, trees: true, radius: 300 },
    });
    useUiStore.getState().setLang('en');
    render(<PrintReport printedAt={Date.UTC(2025, 5, 21, 10)} />);
    expect(row('Position on the building')).toBe('not confirmed in the site plan');
    expect(row('Laser scan (swissSURFACE3D)')).toBe('off');
    expect(row('Data sources')).toBe('© swisstopo');
  });

  it('no position row with only buildings entered by hand, or with the buildings of another site', () => {
    // Outside CH/FL: one building entered by hand 20 m in front of the facade (the nearest within 25 m).
    const manual: Building = {
      id: 'b1',
      name: '',
      footprint: [
        [-7.5, -30],
        [7.5, -30],
        [7.5, -20],
        [-7.5, -20],
      ],
      base: 0,
      height: 12,
      source: 'manual',
    };
    useConfigStore.getState().patch('location', { latitude: 48.137, longitude: 11.575 }); // München
    useConfigStore.getState().patch('building', { facadeAzimuth: 180 });
    useConfigStore.getState().patch('horizon', {
      buildingImport: { latitude: 48.137, longitude: 11.575, radius: 0, date: '' },
      buildings: [manual],
    });
    const { unmount } = render(<PrintReport printedAt={Date.UTC(2025, 5, 21, 10)} />);
    expect(screen.queryByText('Lage am Gebäude')).toBeNull();
    expect(row('Umgebungsgebäude')).toBe('1 (1 von Hand)');
    unmount();
    // Imported in Bern, the location then moved to Zürich.
    useConfigStore.getState().patch('horizon', {
      buildingImport: { latitude: 46.958474, longitude: 7.45363, radius: 300, date: '2026-09-25' },
      buildings: [{ ...manual, source: 'swisstopo' }],
    });
    useConfigStore.getState().patch('location', { latitude: 47.3769, longitude: 8.5417 });
    render(<PrintReport printedAt={Date.UTC(2025, 5, 21, 10)} />);
    expect(screen.queryByText('Lage am Gebäude')).toBeNull();
  });
});
