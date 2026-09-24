import { describe, expect, it } from 'vitest';
import { stepValue } from './sliderKeys';

const TIME = { step: 10, page: 60, min: 240, max: 1380 };

describe('stepValue', () => {
  it('snaps arrow keys to the step grid', () => {
    expect(stepValue('ArrowRight', 723, TIME)).toBe(730);
    expect(stepValue('ArrowUp', 720, TIME)).toBe(730);
    expect(stepValue('ArrowLeft', 723, TIME)).toBe(720);
    expect(stepValue('ArrowDown', 720, TIME)).toBe(710);
    expect(stepValue('ArrowLeft', 45, { step: 5, min: 0, max: 90 })).toBe(40);
    expect(stepValue('ArrowRight', 47, { step: 5, min: 0, max: 90 })).toBe(50);
  });

  it('pages without snapping, jumps with Home/End and clamps to the range', () => {
    expect(stepValue('PageUp', 723, TIME)).toBe(783);
    expect(stepValue('PageDown', 723, TIME)).toBe(663);
    expect(stepValue('Home', 723, TIME)).toBe(240);
    expect(stepValue('End', 723, TIME)).toBe(1380);
    expect(stepValue('ArrowRight', 1380, TIME)).toBe(1380);
    expect(stepValue('ArrowLeft', 240, TIME)).toBe(240);
    expect(stepValue('PageDown', 250, TIME)).toBe(240);
  });

  it('ignores other keys, and Page Up/Down without a page step', () => {
    expect(stepValue('Enter', 5, { step: 1, min: 0, max: 11 })).toBeNull();
    expect(stepValue('Escape', 5, TIME)).toBeNull();
    expect(stepValue('PageUp', 5, { step: 1, min: 0, max: 11 })).toBeNull();
  });
});
