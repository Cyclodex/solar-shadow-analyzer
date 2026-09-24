import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
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
    expect(row('Koordinaten')).toBe('47.1000° N, 7.4500° O');
  });

  it('keeps a chosen name and uses the English terms', () => {
    useConfigStore.getState().patch('location', { name: 'My balcony', latitude: -33.8688, longitude: -70.5 });
    useUiStore.getState().setLang('en');
    render(<PrintReport printedAt={Date.UTC(2025, 5, 21, 10)} />);
    expect(row('Name')).toBe('My balcony');
    expect(row('Coordinates')).toBe('33.8688° S, 70.5000° W');
    expect(row('Floor-to-floor height')).toMatch(/^280\scm$/);
  });

  it('gives the tilt from vertical with β = 90° − θ from horizontal (θ = 30°, where they differ)', () => {
    useConfigStore.getState().patch('panels', { tiltFromVertical: 30 });
    render(<PrintReport printedAt={Date.UTC(2025, 5, 21, 10)} />);
    expect(row('Neigung θ ab Senkrechte')).toBe('30° (β = 60° ab Horizontal)');
  });
});
