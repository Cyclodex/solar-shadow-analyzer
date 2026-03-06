import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProfileDiagram } from './ProfileDiagram';
import { DEFAULT_CONFIG } from '../constants';
import { seasonDays } from '../constants';

describe('ProfileDiagram', () => {
  it('renders without crashing with a valid profileAngle', () => {
    const { container } = render(
      <ProfileDiagram tilt={45} profileAngle={30} season={seasonDays[1]} cfg={DEFAULT_CONFIG} />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders without crashing with null profileAngle', () => {
    const { container } = render(
      <ProfileDiagram tilt={45} profileAngle={null} season={seasonDays[0]} cfg={DEFAULT_CONFIG} />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders without crashing with null season', () => {
    const { container } = render(
      <ProfileDiagram tilt={45} profileAngle={null} season={null} cfg={DEFAULT_CONFIG} />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('shows "Oberes Panel" and "Unteres Panel" labels', () => {
    const { container } = render(
      <ProfileDiagram tilt={45} profileAngle={30} season={seasonDays[1]} cfg={DEFAULT_CONFIG} />
    );
    const texts = container.querySelectorAll('text');
    const labels = Array.from(texts).map(t => t.textContent);
    expect(labels.some(l => l?.includes('Oberes Panel'))).toBe(true);
    expect(labels.some(l => l?.includes('Unteres Panel'))).toBe(true);
  });
});
