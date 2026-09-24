import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Slider, TOUCH_DRAG_SLOP } from './Slider';

function Controlled({ onChange }: { onChange: (v: number) => void }) {
  const [value, setValue] = useState(45);
  return (
    <Slider
      aria-label="Neigung"
      value={value}
      min={0}
      max={90}
      step={1}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
    />
  );
}

const touch = { pointerType: 'touch', pointerId: 7 };

describe('Slider', () => {
  it('mouse and keyboard change the value immediately', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: 'Neigung' });
    fireEvent.pointerDown(slider, { pointerType: 'mouse', pointerId: 1, clientX: 100, clientY: 10 });
    fireEvent.change(slider, { target: { value: '60' } });
    expect(onChange).toHaveBeenLastCalledWith(60);
    fireEvent.pointerUp(slider, { pointerType: 'mouse', pointerId: 1 });
    // Keyboard / assistive technology: no pointer at all.
    fireEvent.change(slider, { target: { value: '61' } });
    expect(onChange).toHaveBeenLastCalledWith(61);
    expect(slider).toHaveValue('61');
  });

  it('a touch that turns into a page scroll leaves the value unchanged', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: 'Neigung' });
    fireEvent.pointerDown(slider, { ...touch, clientX: 200, clientY: 300 });
    // Blink moves the thumb to the finger on touchstart …
    fireEvent.change(slider, { target: { value: '73' } });
    fireEvent.pointerMove(slider, { ...touch, clientX: 201, clientY: 290 });
    // … and cancels the pointer once it scrolls.
    fireEvent.pointerCancel(slider, touch);
    expect(onChange).not.toHaveBeenCalled();
    expect(slider).toHaveValue('45');
  });

  it('a horizontal touch drag changes the value live', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: 'Neigung' });
    fireEvent.pointerDown(slider, { ...touch, clientX: 200, clientY: 300 });
    fireEvent.change(slider, { target: { value: '40' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerMove(slider, { ...touch, clientX: 200 - TOUCH_DRAG_SLOP - 1, clientY: 302 });
    expect(onChange).toHaveBeenLastCalledWith(40);
    fireEvent.change(slider, { target: { value: '35' } });
    expect(onChange).toHaveBeenLastCalledWith(35);
    fireEvent.pointerUp(slider, touch);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(slider).toHaveValue('35');
  });

  it('a tap on the track sets the value on release', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: 'Neigung' });
    fireEvent.pointerDown(slider, { ...touch, clientX: 200, clientY: 300 });
    fireEvent.change(slider, { target: { value: '64' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider, touch);
    expect(onChange).toHaveBeenCalledWith(64);
    expect(slider).toHaveValue('64');
  });
});
