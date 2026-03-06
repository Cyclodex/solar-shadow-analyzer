import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FrontalView } from './FrontalView';
import { DEFAULT_CONFIG } from '../constants';
import { seasonDays } from '../constants';

describe('FrontalView', () => {
  it('renders an SVG', () => {
    const { container } = render(
      <FrontalView tilt={45} hour={12} season={seasonDays[1]} allSeasons={seasonDays} cfg={DEFAULT_CONFIG} />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders "Frontalansicht" label', () => {
    const { container } = render(
      <FrontalView tilt={45} hour={12} season={seasonDays[1]} allSeasons={seasonDays} cfg={DEFAULT_CONFIG} />
    );
    const texts = container.querySelectorAll('text');
    const labels = Array.from(texts).map(t => t.textContent);
    expect(labels.some(l => l?.includes('Frontalansicht'))).toBe(true);
  });
});
