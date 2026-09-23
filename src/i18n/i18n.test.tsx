import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  compassPoint,
  floorLabel,
  getFormat,
  monthNames,
  useFormat,
  useMessages,
  type Messages,
} from './index';
import { useCommon } from './common';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';

/** Normalises the grouping apostrophe (ICU versions differ between ' and ’) and non-breaking spaces. */
const norm = (s: string): string => s.replace(/[\u2019']/g, "'").replace(/[\u00a0\u202f]/g, ' ');

describe('getFormat', () => {
  const de = getFormat('de');
  const en = getFormat('en');

  it('formats numbers with fixed digits and locale grouping', () => {
    expect(norm(de.num(1234.567, 1))).toBe("1'234.6");
    expect(en.num(1234.567, 1)).toBe('1,234.6');
    expect(de.int(2.5)).toBe('3');
    expect(de.num(-0.004, 2)).toBe('0.00'); // no "-0.00"
    expect(de.num(-3, 0)).toBe('\u22123'); // typographic minus
    expect(de.num(NaN)).toBe('–');
    expect(de.num(Infinity)).toBe('∞');
  });

  it('formats units, percent, degrees', () => {
    expect(norm(de.kwh(2855.2))).toBe("2'855 kWh");
    expect(en.kwh(12.34, 1)).toBe('12.3\u00a0kWh');
    expect(norm(de.pct(12.34, 1))).toBe('12.3 %');
    expect(en.pct(12.34, 1)).toBe('12.3%');
    expect(de.deg(44.6)).toBe('45°');
    expect(norm(de.unit(280, 'cm'))).toBe('280 cm');
  });

  it('formats clock times and dates', () => {
    expect(de.time(0)).toBe('00:00');
    expect(de.time(727.4)).toBe('12:07');
    expect(de.time(1440)).toBe('24:00');
    expect(de.date('2025-06-21')).toBe('21. Juni 2025');
    expect(en.date('2025-06-21')).toBe('21 June 2025');
    expect(de.dateShort('2025-12-21')).toMatch(/^21\. Dez/);
    expect(en.dateShort('2025-12-21')).toBe('21 Dec');
    expect(de.date('not a date')).toBe('not a date');
  });

  it('formats currencies (ISO codes via Intl, other labels appended)', () => {
    expect(norm(de.currency(1234.5, 'CHF'))).toBe("CHF 1'234.50");
    expect(norm(en.currency(1234.5, 'EUR'))).toBe('EUR 1,234.50');
    expect(norm(de.currency(12, 'Fr.'))).toBe('12.00 Fr.');
  });

  it('formats UTC offsets and zone names', () => {
    expect(de.utcOffset(120)).toBe('UTC+2');
    expect(de.utcOffset(330)).toBe('UTC+5:30');
    expect(de.utcOffset(-180)).toBe('UTC\u22123');
    expect(de.utcOffset(0)).toBe('UTC');
    const summer = Date.UTC(2025, 6, 1);
    expect(de.tzName('Europe/Zurich', summer)).toBe('MESZ');
    expect(en.tzName('Europe/Zurich', summer)).toBe('CEST');
  });
});

describe('labels', () => {
  it('labels storeys (German and English)', () => {
    expect(floorLabel(0, 'de')).toBe('EG');
    expect(floorLabel(1, 'de')).toBe('1. OG');
    expect(floorLabel(0, 'en')).toBe('Ground floor');
    expect(floorLabel(3, 'en')).toBe('Floor 3');
  });

  it('names months and compass points', () => {
    expect(monthNames('de')[2]).toBe('Mär');
    expect(monthNames('en', 'long')[11]).toBe('December');
    expect(compassPoint(202, 'de')).toBe('SSW');
    expect(compassPoint(90, 'de')).toBe('O');
    expect(compassPoint(90, 'en')).toBe('E');
    expect(compassPoint(359, 'en')).toBe('N');
  });
});

describe('hooks', () => {
  beforeEach(resetStores);

  it('useMessages / useFormat follow the UI language', () => {
    const messages: Messages<{ hello: (n: number) => string }> = {
      de: { hello: (n) => `Hallo ${n}` },
      en: { hello: (n) => `Hello ${n}` },
    };
    const { result } = renderHook(() => ({ t: useMessages(messages), f: useFormat(), c: useCommon() }));
    expect(result.current.t.hello(2)).toBe('Hallo 2');
    expect(result.current.f.locale).toBe('de-CH');
    expect(result.current.c.appTitle).toBe('Verschattungsanalyse');
    act(() => useUiStore.getState().setLang('en'));
    expect(result.current.t.hello(2)).toBe('Hello 2');
    expect(result.current.f.locale).toBe('en-GB');
    expect(result.current.c.appTitle).toBe('Shading analysis');
  });
});
