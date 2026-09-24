import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CompassDial } from './CompassDial';

/** Controlled dial on a 100 × 100 px box (centre 50/50): east = (100, 50), south = (50, 100). */
function setup(initial = 202) {
  const onChange = vi.fn<(v: number) => void>();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <CompassDial
        value={value}
        onChange={(v) => {
          onChange(v);
          setValue(v);
        }}
        label="Dial"
        valueText={(v) => `${v}°`}
      />
    );
  }
  render(<Harness />);
  const dial = screen.getByRole('slider', { name: 'Dial' });
  vi.spyOn(dial, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    right: 100,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  const now = (): number => Number(dial.getAttribute('aria-valuenow'));
  return { dial, onChange, now };
}

const touch = { pointerId: 7, pointerType: 'touch', button: 0 } as const;

describe('CompassDial touch input', () => {
  it('leaves the value alone when a vertical swipe scrolls the page (pointercancel)', () => {
    const { dial, onChange, now } = setup();
    fireEvent.pointerDown(dial, { ...touch, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(dial, { ...touch, clientX: 102, clientY: 30 });
    fireEvent.pointerCancel(dial, { ...touch });
    expect(onChange).not.toHaveBeenCalled();
    expect(now()).toBe(202);
    expect(dial).not.toHaveFocus();
  });

  it('sets the direction on a tap (the click after a press without movement)', () => {
    const { dial, now } = setup();
    fireEvent.pointerDown(dial, { ...touch, clientX: 100, clientY: 50 });
    expect(now()).toBe(202); // nothing on touch-down: it may become a scroll
    fireEvent.pointerUp(dial, { ...touch, clientX: 101, clientY: 51 });
    fireEvent.click(dial, { clientX: 100, clientY: 50 });
    expect(now()).toBe(90);
    expect(dial).toHaveFocus();
  });

  it('ignores a click the browser sends without a preceding tap (e.g. after moving more than the slop)', () => {
    const { dial, now } = setup();
    fireEvent.pointerDown(dial, { ...touch, clientX: 50, clientY: 100 });
    fireEvent.pointerMove(dial, { ...touch, clientX: 52, clientY: 80 });
    fireEvent.pointerUp(dial, { ...touch, clientX: 52, clientY: 80 });
    fireEvent.click(dial, { clientX: 52, clientY: 80 });
    expect(now()).toBe(202);
  });

  it('turns with a drag that starts sideways', () => {
    const { dial, now } = setup();
    fireEvent.pointerDown(dial, { ...touch, clientX: 30, clientY: 0 });
    fireEvent.pointerMove(dial, { ...touch, clientX: 34, clientY: 1 }); // within the slop: no change
    expect(now()).toBe(202);
    fireEvent.pointerMove(dial, { ...touch, clientX: 50, clientY: 0 }); // north
    expect(now()).toBe(0);
    fireEvent.pointerMove(dial, { ...touch, clientX: 100, clientY: 50 }); // east, captured drag
    expect(now()).toBe(90);
    fireEvent.pointerUp(dial, { ...touch, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(dial, { ...touch, clientX: 50, clientY: 100 });
    expect(now()).toBe(90);
  });

  it('restores the value when the browser takes over a started drag for scrolling', () => {
    const { dial, now } = setup();
    fireEvent.pointerDown(dial, { ...touch, clientX: 30, clientY: 0 });
    fireEvent.pointerMove(dial, { ...touch, clientX: 50, clientY: 0 });
    expect(now()).toBe(0);
    fireEvent.pointerCancel(dial, { ...touch });
    expect(now()).toBe(202);
  });

  it('keeps the immediate press-and-drag for the mouse', () => {
    const { dial, now } = setup();
    fireEvent.pointerDown(dial, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 50 });
    expect(now()).toBe(90);
    fireEvent.pointerMove(dial, { pointerId: 1, pointerType: 'mouse', clientX: 50, clientY: 100 });
    expect(now()).toBe(180);
    fireEvent.pointerUp(dial, { pointerId: 1, pointerType: 'mouse', clientX: 50, clientY: 100 });
    fireEvent.click(dial, { clientX: 50, clientY: 100 });
    expect(now()).toBe(180);
  });
});
