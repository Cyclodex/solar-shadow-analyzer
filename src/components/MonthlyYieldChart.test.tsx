import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MonthlyYieldChart } from './MonthlyYieldChart';
import { DEFAULT_CONFIG } from '../constants';

describe('MonthlyYieldChart', () => {
  it('renders without crashing', () => {
    render(<MonthlyYieldChart currentTilt={45} cfg={DEFAULT_CONFIG} />);
    expect(screen.getByText('Monatsvergleich Ertragspotential')).toBeInTheDocument();
  });

  it('shows month abbreviations in the chart', () => {
    const { container } = render(<MonthlyYieldChart currentTilt={45} cfg={DEFAULT_CONFIG} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Jan');
    expect(text).toContain('Jun');
    expect(text).toContain('Dez');
  });

  it('labels the current tilt as "(aktuell)"', () => {
    render(<MonthlyYieldChart currentTilt={45} cfg={DEFAULT_CONFIG} />);
    expect(screen.getByText(/45°.*aktuell/)).toBeInTheDocument();
  });
});
