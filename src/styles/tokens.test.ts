import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FLOOR_COLOR_COUNT, cssVar, floorColor, floorToken, parseCssColor, useThemeKey } from './tokens';

describe('floor colours', () => {
  it('follow the floor index and wrap after the last colour', () => {
    expect(FLOOR_COLOR_COUNT).toBe(8);
    expect(floorToken(0)).toBe('--floor-0');
    expect(floorToken(7)).toBe('--floor-7');
    expect(floorToken(8)).toBe('--floor-0');
    expect(floorToken(9)).toBe('--floor-1');
    expect(floorToken(12)).toBe('--floor-4');
    expect(floorToken(-1)).toBe('--floor-7');
    expect(floorColor(3)).toBe('var(--floor-3)');
    expect(floorColor(11)).toBe('var(--floor-3)');
  });
});

describe('parseCssColor', () => {
  it('parses hex colours', () => {
    expect(parseCssColor('#fbbf24')).toEqual([251, 191, 36, 255]);
    expect(parseCssColor('#ffffff')).toEqual([255, 255, 255, 255]);
    expect(parseCssColor(' #000 ')).toEqual([0, 0, 0, 255]);
    expect(parseCssColor('#ff000080')).toEqual([255, 0, 0, 128]);
    expect(parseCssColor('#0f08')).toEqual([0, 255, 0, 136]);
  });

  it('parses rgb()/rgba() in comma and space syntax, with alpha as a number or %', () => {
    expect(parseCssColor('rgb(255, 0, 51)')).toEqual([255, 0, 51, 255]);
    expect(parseCssColor('rgba(255, 0, 0, 0.5)')).toEqual([255, 0, 0, 127.5]);
    // Canvas normalises fillStyle with alpha < 1 to this form.
    expect(parseCssColor('rgba(2, 6, 23, 0.6)')).toEqual([2, 6, 23, 153]);
    expect(parseCssColor('rgb(2 6 23 / 0.6)')).toEqual([2, 6, 23, 153]);
    expect(parseCssColor('rgb(2 6 23 / 50%)')).toEqual([2, 6, 23, 127.5]);
    expect(parseCssColor('rgb(100% 50% 0% / 25%)')).toEqual([255, 127.5, 0, 63.75]);
  });

  it('clamps channels to 0…255', () => {
    expect(parseCssColor('rgb(300, -5, 20, 2)')).toEqual([255, 0, 20, 255]);
  });

  it('rejects anything else', () => {
    for (const bad of [
      '',
      'red',
      '#12',
      '#12345',
      'rgb(1, 2)',
      'rgb(a, b, c)',
      'rgb(1 2 3 / 0.5 / 1)',
      'rgb(1, 2, 3, 4, 5)',
      'hsl(0 0% 0%)',
      'var(--x)',
    ]) {
      expect(parseCssColor(bad)).toBeNull();
    }
  });
});

describe('cssVar', () => {
  it('reads a custom property inherited from an ancestor, trimmed', () => {
    const parent = document.createElement('div');
    parent.style.setProperty('--probe', '  #123456 ');
    const child = document.createElement('span');
    parent.append(child);
    document.body.append(parent);
    try {
      expect(cssVar(child, '--probe')).toBe('#123456');
      expect(cssVar(child, '--missing')).toBe('');
    } finally {
      parent.remove();
    }
  });
});

describe('useThemeKey', () => {
  afterEach(() => document.documentElement.removeAttribute('data-theme'));

  it('follows the data-theme attribute of <html>', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { result } = renderHook(() => useThemeKey());
    expect(result.current).toBe('dark');
    // The MutationObserver reports asynchronously (microtask).
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'light');
      await Promise.resolve();
    });
    expect(result.current).toBe('light');
  });
});
