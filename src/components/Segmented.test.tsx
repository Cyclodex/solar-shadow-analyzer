import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Segmented } from './Segmented';

function Demo({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('b');
  return (
    <Segmented
      label="Modus"
      value={value}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
      options={[
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
        { value: 'c', label: 'Gamma', disabled: true },
        { value: 'd', label: 'Delta' },
      ]}
    />
  );
}

describe('Segmented', () => {
  it('exposes radio-group semantics with a roving tab stop', () => {
    render(<Demo onChange={() => {}} />);
    const group = screen.getByRole('radiogroup', { name: 'Modus' });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'false');
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]);
  });

  it('selects by click and arrow keys (skipping disabled options, wrapping)', () => {
    const onChange = vi.fn();
    render(<Demo onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    expect(onChange).toHaveBeenLastCalledWith('a');
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true');

    const group = screen.getByRole('radiogroup');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('d'); // Gamma is disabled
    expect(screen.getByRole('radio', { name: 'Delta' })).toHaveFocus();
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('a'); // wraps
    fireEvent.keyDown(group, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('d');
    fireEvent.keyDown(group, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });
});
