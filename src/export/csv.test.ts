import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';
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
});

describe('safeFilename', () => {
  it('keeps safe ASCII characters', () => {
    expect(safeFilename('Zürich · 2 OG/Test')).toBe('Zurich-2-OG-Test');
    expect(safeFilename('···')).toBe('export');
  });
});
