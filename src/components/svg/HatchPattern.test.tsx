import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { HatchPattern } from './HatchPattern';

function pattern(ui: ReactElement): SVGPatternElement {
  const { container } = render(<svg>{ui}</svg>);
  return container.querySelector('pattern')!;
}

describe('HatchPattern', () => {
  it('draws one line per tile in the given colour, rising to the right by default', () => {
    const p = pattern(<HatchPattern id="h" color="var(--text)" opacity={0.4} lineWidth={1.2} spacing={6} />);
    expect(p).toHaveAttribute('id', 'h');
    expect(p).toHaveAttribute('patternUnits', 'userSpaceOnUse');
    expect(p).toHaveAttribute('width', '6');
    expect(p).toHaveAttribute('patternTransform', 'rotate(45)');
    expect(p.querySelector('rect')).toBeNull();
    const line = p.querySelector('line')!;
    expect(line).toHaveAttribute('y2', '6');
    expect(line).toHaveAttribute('stroke', 'var(--text)');
    expect(line).toHaveAttribute('stroke-opacity', '0.4');
    expect(line).toHaveAttribute('stroke-width', '1.2');
  });

  it('can fall to the right and lay a wash of the colour under the lines', () => {
    const p = pattern(<HatchPattern id="h" color="var(--floor-1)" wash={0.22} angle={135} />);
    expect(p).toHaveAttribute('patternTransform', 'rotate(-45)');
    const wash = p.querySelector('rect')!;
    expect(wash).toHaveAttribute('fill', 'var(--floor-1)');
    expect(wash).toHaveAttribute('fill-opacity', '0.22');
  });
});
