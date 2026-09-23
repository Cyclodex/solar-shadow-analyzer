import { describe, it, expect } from 'vitest';
import { toRad, toDeg, cmToM, mToCm, clamp, normalizeDeg, angleDiff, roundToStep } from './units';

describe('units', () => {
  it('converts degrees and radians', () => {
    expect(toRad(180)).toBeCloseTo(Math.PI, 12);
    expect(toDeg(Math.PI / 2)).toBeCloseTo(90, 12);
  });

  it('converts cm and m', () => {
    expect(cmToM(280)).toBe(2.8);
    expect(mToCm(1.134)).toBeCloseTo(113.4, 10);
  });

  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('normalizes angles to [0, 360)', () => {
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(725)).toBe(5);
  });

  it('computes signed angle differences in (−180, 180]', () => {
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(350, 10)).toBe(-20);
    expect(angleDiff(180, 0)).toBe(180);
    expect(angleDiff(0, 180)).toBe(180);
  });

  it('rounds to step without float noise', () => {
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundToStep(113.44, 0.1)).toBe(113.4);
    expect(roundToStep(47, 5)).toBe(45);
  });
});
