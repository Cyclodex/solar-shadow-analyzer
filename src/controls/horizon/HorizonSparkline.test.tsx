import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConfigStore } from '../../state/configStore';
import { resetStores } from '../../test/utils';
import { HorizonSparkline } from './HorizonSparkline';

function setup(facadeAzimuth: number) {
  act(() => {
    useConfigStore.getState().patch('building', { facadeAzimuth });
    useConfigStore.getState().patch('horizon', {
      terrainEnabled: false,
      manual: [
        { azimuth: 150, elevation: 8 },
        { azimuth: 250, elevation: 14 },
      ],
    });
  });
  return render(<HorizonSparkline />);
}

/** Compass tick label (not the bold facade label) by its text. */
const tick = (label: string): Element | null =>
  [...document.querySelectorAll('svg text')].find((t) => t.textContent === label)?.parentElement ?? null;

describe('HorizonSparkline', () => {
  beforeEach(() => resetStores());

  it('marks the compass ticks next to the facade label (hidden on phones and tablets by CSS)', () => {
    setup(211);
    // SW is 14° from the facade: its label would touch "211°" at the larger phone font.
    expect(tick('SW')?.getAttribute('class')).toMatch(/xNear/);
    expect(tick('S')?.getAttribute('class') ?? '').not.toMatch(/xNear/);
    expect(tick('W')?.getAttribute('class') ?? '').not.toMatch(/xNear/);
    expect(screen.getByText('211°')).toBeInTheDocument();
  });

  it('drops the crosshair when the browser takes a touch for scrolling', () => {
    const { container } = setup(202);
    const svg = container.querySelector('svg')!;
    svg.getBoundingClientRect = () => DOMRect.fromRect({ width: 300, height: 132 });
    fireEvent.pointerDown(svg, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    expect(screen.getByText(/^Bei /)).toBeInTheDocument();
    fireEvent.pointerCancel(svg, { pointerId: 1, pointerType: 'touch' });
    expect(screen.queryByText(/^Bei /)).not.toBeInTheDocument();
    expect(screen.getByText('Höchstwerte im Bereich')).toBeInTheDocument();
  });
});
