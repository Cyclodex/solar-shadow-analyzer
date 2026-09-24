import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { useDismissOnOutsidePointer, useKeepInViewport } from './usePopover';

function Popover({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useKeepInViewport(ref, active);
  return <div ref={ref} data-testid="popover" />;
}

/** Lays out every element at `left` with `width` (jsdom does no layout). */
function layOut(left: number, width: number): void {
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
  rect.mockReturnValue(new DOMRect(left, 0, width, 100));
  onTestFinished(() => rect.mockRestore());
}

describe('useKeepInViewport', () => {
  // jsdom: the viewport is window.innerWidth (1024 px) wide.
  it.each([
    [100, 200, '0px'],
    [2, 200, '6px'],
    [-40, 200, '48px'],
    [900, 200, '-84px'],
  ])('left %i, width %i: --shift %s (8 px margin)', (left, width, shift) => {
    layOut(left, width);
    render(<Popover />);
    expect(screen.getByTestId('popover').style.getPropertyValue('--shift')).toBe(shift);
  });

  it('does nothing while inactive', () => {
    layOut(-40, 200);
    render(<Popover active={false} />);
    expect(screen.getByTestId('popover').style.getPropertyValue('--shift')).toBe('');
  });
});

function Dismissable({ onDismiss }: { onDismiss: (count: number) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  const [count, setCount] = useState(0);
  // The latest callback is called (here: with the latest count), without re-subscribing.
  useDismissOnOutsidePointer(rootRef, open, () => onDismiss(count));
  return (
    <>
      <div ref={rootRef}>
        <button type="button" onClick={() => setCount((c) => c + 1)}>
          inside
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)}>
          toggle
        </button>
      </div>
      <p>outside</p>
    </>
  );
}

describe('useDismissOnOutsidePointer', () => {
  it('calls the latest callback on presses outside the root while active', () => {
    const onDismiss = vi.fn();
    render(<Dismissable onDismiss={onDismiss} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'inside' }));
    fireEvent.click(screen.getByRole('button', { name: 'inside' }));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith(1);

    fireEvent.click(screen.getByRole('button', { name: 'toggle' })); // inactive
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
