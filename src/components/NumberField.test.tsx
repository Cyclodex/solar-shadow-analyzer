import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStores } from '../test/utils';
import { NumberField } from './NumberField';
import { digitsOf, parseNumberInput } from './numberInput';

function Controlled({ onChange, initial = 280 }: { onChange: (v: number) => void; initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <NumberField
      label="Stockwerkhöhe"
      value={value}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
      limit={{ min: 200, max: 500, step: 1 }}
      unit="cm"
    />
  );
}

describe('NumberField', () => {
  beforeEach(resetStores);

  it('keeps a draft while typing and commits clamped on blur', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Stockwerkhöhe' });
    fireEvent.change(input, { target: { value: '1' } }); // on the way to 150 → below min, not rejected
    expect(input).toHaveValue('1');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.change(input, { target: { value: '150' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(200);
    expect(input).toHaveValue('200');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('commits on Enter, accepts a decimal comma and clamps to max', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Stockwerkhöhe' });
    fireEvent.change(input, { target: { value: '310,5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(310.5);
    fireEvent.change(input, { target: { value: '9999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(500);
  });

  it('Escape and invalid text discard the draft', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Stockwerkhöhe' });
    fireEvent.change(input, { target: { value: '321' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('280');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('280');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ArrowUp/Down step the value', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Stockwerkhöhe' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(281);
    fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(271);
  });

  it('the slider commits live and exposes the unit in aria-valuetext', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: 'Stockwerkhöhe' });
    expect(slider).toHaveAttribute('aria-valuetext', '280 cm');
    expect(slider).toHaveAttribute('min', '200');
    expect(slider).toHaveAttribute('max', '500');
    fireEvent.change(slider, { target: { value: '300' } });
    expect(onChange).toHaveBeenCalledWith(300);
    expect(slider).toHaveAttribute('aria-valuetext', '300 cm');
  });
});

describe('number input helpers', () => {
  it('parses localized input', () => {
    expect(parseNumberInput(' 1’234,5 ')).toBe(1234.5);
    expect(parseNumberInput('\u22120.35')).toBe(-0.35);
    expect(parseNumberInput('-')).toBeNull();
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('1e3')).toBe(1000);
  });

  it('derives decimals from the step', () => {
    expect(digitsOf(1)).toBe(0);
    expect(digitsOf(0.1)).toBe(1);
    expect(digitsOf(0.005)).toBe(3);
    expect(digitsOf(1e-7)).toBe(7);
  });
});
