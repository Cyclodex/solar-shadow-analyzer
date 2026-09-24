import { describe, expect, it } from 'vitest';
import { floorToken } from '../../styles/tokens';
import { floorSceneToken, readPalette } from './palette';

describe('readPalette', () => {
  it('reads the design tokens and derives the scene colours', () => {
    const el = document.createElement('div');
    el.style.setProperty('--sun', '#ff8000');
    el.style.setProperty('--shade', 'rgb(0 0 0 / 0.5)');
    el.style.setProperty('--font-sans', 'Test Sans, sans-serif');
    document.body.append(el);
    try {
      const p = readPalette('test', el);
      expect(p.theme).toBe('test');
      expect(p.rgba.sun).toEqual({ r: 1, g: 128 / 255, b: 0, a: 1 });
      expect(p.rgba.shade.a).toBe(0.5);
      expect(p.css('sun')).toBe('rgb(255 128 0 / 1)');
      expect(p.css('sun', 0.25)).toBe('rgb(255 128 0 / 0.25)');
      // three.js colours are linear: sRGB 128/255 → ≈ 0.216
      expect(p.color('sun').g).toBeCloseTo(0.2158, 3);
      expect(p.color('sun')).toBe(p.color('sun')); // cached instance
      expect(p.font).toBe('Test Sans, sans-serif');
      // Missing tokens fall back to neutral grey instead of failing.
      expect(p.rgba.wall).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
    } finally {
      el.remove();
    }
  });
});

describe('floorSceneToken', () => {
  it('names the scene token of the shared floor colour, wrapping like the charts', () => {
    expect(floorSceneToken(0)).toBe('floor-0');
    expect(floorSceneToken(7)).toBe('floor-7');
    expect(floorSceneToken(8)).toBe('floor-0');
    expect(floorSceneToken(12)).toBe('floor-4');
    expect(floorSceneToken(-1)).toBe('floor-7');
    const palette = readPalette('test');
    for (let k = -3; k < 20; k++) {
      expect(`--${floorSceneToken(k)}`).toBe(floorToken(k));
      // Every floor colour is one of the tokens the palette reads.
      expect(palette.rgba[floorSceneToken(k)]).toBeDefined();
    }
  });
});
