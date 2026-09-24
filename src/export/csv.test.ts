import { describe, expect, it } from 'vitest';
import { csvFormatForLocale, spreadsheetLocale, toCsv } from './csv';
import { safeFilename } from './download';

describe('toCsv', () => {
  it('quotes fields per RFC 4180 and ends lines with CRLF', () => {
    const csv = toCsv([
      ['Monat', 'kWh', 'Notiz'],
      ['Jan', 12.5, 'a,b'],
      ['Feb', NaN, 'say "hi"'],
      ['Mär', null, ' x'],
    ]);
    expect(csv).toBe('Monat,kWh,Notiz\r\nJan,12.5,"a,b"\r\nFeb,,"say ""hi"""\r\nMär,," x"\r\n');
  });

  it('supports other separators', () => {
    expect(toCsv([['a;b', 1.5]], { separator: ';', newline: '\n' })).toBe('"a;b";1.5\n');
  });

  it('writes decimal commas unquoted with a semicolon separator', () => {
    expect(toCsv([['März', 1.07, 12.3, 5, -0.5, NaN, '1.5']], { separator: ';', decimal: ',' })).toBe(
      'März;1,07;12,3;5;-0,5;;1.5\r\n',
    );
  });
});

describe('csvFormatForLocale', () => {
  it('matches the list separator and decimal mark of spreadsheet regional settings', () => {
    expect(csvFormatForLocale('de-CH')).toEqual({ separator: ';', decimal: '.' });
    expect(csvFormatForLocale('it-CH')).toEqual({ separator: ';', decimal: '.' });
    expect(csvFormatForLocale('de-DE')).toEqual({ separator: ';', decimal: ',' });
    expect(csvFormatForLocale('de-AT')).toEqual({ separator: ';', decimal: ',' });
    expect(csvFormatForLocale('fr-CH')).toEqual({ separator: ';', decimal: ',' });
    expect(csvFormatForLocale('en-US')).toEqual({ separator: ',', decimal: '.' });
    expect(csvFormatForLocale('en-GB')).toEqual({ separator: ',', decimal: '.' });
    expect(csvFormatForLocale('not a locale')).toEqual({ separator: ',', decimal: '.' });
  });
});

describe('spreadsheetLocale', () => {
  it('takes the first browser language, with a region from later entries or the fallback', () => {
    expect(spreadsheetLocale(['de-AT', 'de-CH'], 'de-CH')).toBe('de-AT');
    expect(spreadsheetLocale(['de', 'en-US', 'de-DE'], 'de-CH')).toBe('de-DE');
    expect(spreadsheetLocale(['de', 'en'], 'de-CH')).toBe('de-CH');
    expect(spreadsheetLocale(['fr'], 'de-CH')).toBe('fr');
    expect(spreadsheetLocale([], 'en-GB')).toBe('en-GB');
  });
});

describe('safeFilename', () => {
  it('keeps safe ASCII characters', () => {
    expect(safeFilename('Zürich · 2 OG/Test')).toBe('Zurich-2-OG-Test');
    expect(safeFilename('···')).toBe('export');
  });
});
