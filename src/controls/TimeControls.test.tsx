import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetStores } from '../test/utils';
import { TimeControls } from './TimeControls';

describe('TimeControls', () => {
  beforeEach(() => {
    resetStores();
  });

  it('shows the clock without a live region (the slider value text carries the time)', () => {
    const { container } = render(<TimeControls />);
    const slider = screen.getByRole('slider', { name: 'Uhrzeit (Ortszeit)' });
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/^12:00 /));
    expect(screen.getByText('12:00')).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: '725' } });
    expect(screen.getByText('12:05')).toBeInTheDocument();
    // <output> would be an implicit polite status region announcing every animation step.
    expect(container.querySelector('output, [role="status"], [aria-live]')).toBeNull();
  });
});
