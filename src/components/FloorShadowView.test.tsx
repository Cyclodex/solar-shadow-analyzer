import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FloorShadowView } from './FloorShadowView';
import { DEFAULT_CONFIG, seasonDays } from '../constants';

describe('FloorShadowView', () => {
  it('renders an SVG', () => {
    const { container } = render(
      <FloorShadowView tilt={45} hour={12} season={seasonDays[1]} cfg={DEFAULT_CONFIG} />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders the title label', () => {
    const { container } = render(
      <FloorShadowView tilt={45} hour={12} season={seasonDays[1]} cfg={DEFAULT_CONFIG} />
    );
    const texts = container.querySelectorAll('text');
    const labels = Array.from(texts).map(t => t.textContent);
    expect(labels.some(l => l?.includes('Stockwerkansicht'))).toBe(true);
  });

  it('shows upper and lower panel labels', () => {
    const { container } = render(
      <FloorShadowView tilt={45} hour={12} season={seasonDays[1]} cfg={DEFAULT_CONFIG} />
    );
    const texts = container.querySelectorAll('text');
    const labels = Array.from(texts).map(t => t.textContent);
    expect(labels.some(l => l?.includes('Oberes Panel'))).toBe(true);
    expect(labels.some(l => l?.includes('Unteres Panel'))).toBe(true);
  });

  it('renders without shadow when numFloors is 1', () => {
    const cfg = { ...DEFAULT_CONFIG, numFloors: 1 };
    const { container } = render(
      <FloorShadowView tilt={45} hour={12} season={seasonDays[1]} cfg={cfg} />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
    const texts = container.querySelectorAll('text');
    const labels = Array.from(texts).map(t => t.textContent);
    expect(labels.some(l => l?.includes('Etagen'))).toBe(true);
  });

  it('renders at winter solstice', () => {
    const { container } = render(
      <FloorShadowView tilt={45} hour={12} season={seasonDays[0]} cfg={DEFAULT_CONFIG} />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders at night (hour=2)', () => {
    const { container } = render(
      <FloorShadowView tilt={45} hour={2} season={seasonDays[1]} cfg={DEFAULT_CONFIG} />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
