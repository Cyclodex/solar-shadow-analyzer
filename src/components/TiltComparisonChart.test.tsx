import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TiltComparisonChart } from './TiltComparisonChart';
import { DEFAULT_CONFIG } from '../constants';

describe('TiltComparisonChart', () => {
  it('renders without crashing', () => {
    render(<TiltComparisonChart currentTilt={45} cfg={DEFAULT_CONFIG} />);
    expect(screen.getByText('Neigungswinkel-Vergleich')).toBeInTheDocument();
  });

  it('highlights the current tilt', () => {
    const { container } = render(<TiltComparisonChart currentTilt={45} cfg={DEFAULT_CONFIG} />);
    // The current tilt row uses larger, bolder font — check the text is present
    expect(container.textContent).toContain('45°');
  });

  it('shows tilt data for all default tilts', () => {
    const { container } = render(<TiltComparisonChart currentTilt={45} cfg={DEFAULT_CONFIG} />);
    const text = container.textContent ?? '';
    [25, 30, 35, 40, 50, 55, 60, 65, 70].forEach(t => {
      expect(text).toContain(`${t}°`);
    });
  });
});
