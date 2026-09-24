import { describe, expect, it } from 'vitest';
import { floorToken, parseCssColor, readPalette } from './palette';

describe('parseCssColor', () => {
  it('parses hex colours', () => {
    expect(parseCssColor('#ffffff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseCssColor(' #000 ')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseCssColor('#ff000080')).toEqual({ r: 1, g: 0, b: 0, a: 128 / 255 });
    expect(parseCssColor('#0f08')).toEqual({ r: 0, g: 1, b: 0, a: 136 / 255 });
  });

  it('parses rgb()/rgba() in comma and space syntax, with alpha', () => {
    expect(parseCssColor('rgb(255, 0, 51)')).toEqual({ r: 1, g: 0, b: 0.2, a: 1 });
    expect(parseCssColor('rgba(255, 0, 0, 0.5)')).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
    expect(parseCssColor('rgb(2 6 23 / 0.6)')).toEqual({ r: 2 / 255, g: 6 / 255, b: 23 / 255, a: 0.6 });
    expect(parseCssColor('rgb(100% 50% 0% / 25%)')).toEqual({ r: 1, g: 0.5, b: 0, a: 0.25 });
  });

  it('rejects anything else', () => {
    for (const bad of ['', 'red', '#12', '#12345', 'rgb(1, 2)', 'rgb(a, b, c)', 'hsl(0 0% 0%)', 'var(--x)']) {
      expect(parseCssColor(bad)).toBeNull();
    }
  });
});

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

describe('floorToken', () => {
  it('maps floor indices to the fixed floor colour order and wraps like the charts', () => {
    expect(floorToken(0)).toBe('floor-0');
    expect(floorToken(7)).toBe('floor-7');
    expect(floorToken(8)).toBe('floor-0');
    expect(floorToken(12)).toBe('floor-4');
    expect(floorToken(-1)).toBe('floor-7');
  });
});
