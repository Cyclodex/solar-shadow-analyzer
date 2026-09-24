import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FloorYield, HeatmapData, SimulationResult, TiltSweepPoint } from '../model/types';
import { HEATMAP_BEHIND, HEATMAP_HORIZON, HEATMAP_NIGHT } from '../model/analysis';
import type { CsvFormat } from './csv';
import { heatmapCsv, monthlyResultsCsv, tiltSweepCsv, userCsvFormat } from './resultsCsv';

function floor(k: number, monthly: number[], unshaded: number[]): FloorYield {
  const annualKwh = monthly.reduce((a, b) => a + b, 0);
  const annualUnshadedKwh = unshaded.reduce((a, b) => a + b, 0);
  return {
    floor: k,
    storey: 1 + k,
    monthlyKwh: monthly,
    annualKwh,
    monthlyUnshadedKwh: unshaded,
    annualUnshadedKwh,
    shadingLossKwh: annualUnshadedKwh - annualKwh,
    shadingLossPct: ((annualUnshadedKwh - annualKwh) / annualUnshadedKwh) * 100,
    poaKwhPerM2: 0,
    clippedKwh: 0,
    specificYield: 0,
    skyViewFactor: 1,
  };
}

const lower = floor(
  0,
  Array.from({ length: 12 }, (_, m) => 10 + m),
  Array.from({ length: 12 }, (_, m) => 12 + m),
);
const upper = floor(
  1,
  Array.from({ length: 12 }, () => 20.123),
  Array.from({ length: 12 }, () => 20.123),
);
const sim: SimulationResult = {
  source: 'open-meteo',
  year: 2025,
  floors: [lower, upper],
  totalAnnualKwh: lower.annualKwh + upper.annualKwh,
  totalMonthlyKwh: lower.monthlyKwh.map((v, m) => v + upper.monthlyKwh[m]),
  totalShadingLossKwh: lower.shadingLossKwh + upper.shadingLossKwh,
};

/** Excel with Swiss (de-CH), German/Austrian (de-DE, de-AT) and English regional settings. */
const CH: CsvFormat = { separator: ';', decimal: '.' };
const DE: CsvFormat = { separator: ';', decimal: ',' };
const INTL: CsvFormat = { separator: ',', decimal: '.' };

const rows = (csv: string, sep: string): string[][] =>
  csv
    .trimEnd()
    .split('\r\n')
    .map((r) => r.split(sep));

describe('monthlyResultsCsv', () => {
  it('writes one row per month and a year row, per floor (bottom first) and in total', () => {
    const csv = monthlyResultsCsv(sim, 'de', CH);
    const r = rows(csv, ';');
    expect(r).toHaveLength(14);
    expect(r[0]).toEqual([
      'Monat',
      '1. OG: Ertrag (kWh)',
      '1. OG: ohne Verschattung (kWh)',
      '1. OG: Verschattungsverlust (kWh)',
      '2. OG: Ertrag (kWh)',
      '2. OG: ohne Verschattung (kWh)',
      '2. OG: Verschattungsverlust (kWh)',
      'Total: Ertrag (kWh)',
      'Total: ohne Verschattung (kWh)',
      'Total: Verschattungsverlust (kWh)',
      'Total: Verschattungsverlust (%)',
    ]);
    // January: lower 10 / 12 / 2, upper 20.12 / 20.12 / 0, total 30.12 / 32.12 / 2 / 6.23 %
    expect(r[1]).toEqual(['Januar', '10', '12', '2', '20.12', '20.12', '0', '30.12', '32.12', '2', '6.23']);
    expect(r[12][0]).toBe('Dezember');
    // Year row uses the model totals.
    expect(r[13]).toEqual([
      'Jahr',
      String(lower.annualKwh),
      String(lower.annualUnshadedKwh),
      '24',
      '241.48',
      '241.48',
      '0',
      String(Number(sim.totalAnnualKwh.toFixed(2))),
      String(Number((lower.annualUnshadedKwh + upper.annualUnshadedKwh).toFixed(2))),
      '24',
      String(Number(((24 / (lower.annualUnshadedKwh + upper.annualUnshadedKwh)) * 100).toFixed(2))),
    ]);
  });

  it('uses English headers in English', () => {
    const r = rows(monthlyResultsCsv(sim, 'en', INTL), ',');
    expect(r[0][0]).toBe('Month');
    expect(r[0][1]).toBe('Floor 1: yield (kWh)');
    expect(r[1][0]).toBe('January');
    expect(r[13][0]).toBe('Year');
  });

  it('writes decimal commas for regional settings with a decimal comma', () => {
    const r = rows(monthlyResultsCsv(sim, 'de', DE), ';');
    expect(r[1]).toEqual(['Januar', '10', '12', '2', '20,12', '20,12', '0', '30,12', '32,12', '2', '6,23']);
  });

  it('appends the shaded hours of one floor as a last column (1 decimal) on request', () => {
    const shadedHours = {
      floor: '1. OG',
      monthly: Array.from({ length: 12 }, (_, m) => 10.04 + m),
      year: 197.46,
    };
    const r = rows(monthlyResultsCsv(sim, 'de', DE, { shadedHours }), ';');
    expect(r[0]).toHaveLength(12);
    expect(r[0][11]).toBe('1. OG: verschattete Stunden (h)');
    expect(r[1].slice(-2)).toEqual(['6,23', '10']);
    expect(r[2][11]).toBe('11');
    expect(r[13][11]).toBe('197,5');
    expect(rows(monthlyResultsCsv(sim, 'en', INTL, { shadedHours }), ',')[0][11]).toBe(
      '1. OG: shaded hours (h)',
    );
  });
});

describe('tiltSweepCsv', () => {
  it('lists θ, β and the yield per floor and in total', () => {
    const points: TiltSweepPoint[] = [
      { tiltFromVertical: 0, floorsKwh: [100.004, 120], totalKwh: 220.004 },
      { tiltFromVertical: 45, floorsKwh: [150.5, 160.25], totalKwh: 310.75 },
    ];
    const r = rows(tiltSweepCsv(points, [1, 2], 'de', CH), ';');
    expect(r).toEqual([
      [
        'Neigung ab Senkrechte θ (°)',
        'Neigung ab Horizontal β (°)',
        '1. OG: Jahresertrag (kWh)',
        '2. OG: Jahresertrag (kWh)',
        'Total: Jahresertrag (kWh)',
      ],
      ['0', '90', '100', '120', '220'],
      ['45', '45', '150.5', '160.25', '310.75'],
    ]);
  });
});

describe('heatmapCsv', () => {
  it('writes shaded % per day and slot, empty without direct sun, and drops slots that are never lit', () => {
    const N = HEATMAP_NIGHT;
    const h: HeatmapData = {
      year: 2025,
      days: 2,
      slotsPerDay: 4,
      slotMinutes: 360,
      floor: 0,
      values: new Float32Array([N, 0.5, 0, HEATMAP_BEHIND, N, HEATMAP_HORIZON, 0.25, N]),
    };
    const r = rows(heatmapCsv(h, 'en', INTL), ',');
    expect(r).toEqual([
      ['Date', '06:00', '12:00'],
      ['2025-01-01', '50', '0'],
      ['2025-01-02', '', '25'],
    ]);
  });
});

describe('userCsvFormat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const browserLanguages = (languages: string[]): void => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(languages[0] ?? '');
  };

  it('follows the browser locale, not the UI language', () => {
    browserLanguages(['de-CH', 'de', 'en']);
    expect(userCsvFormat('de')).toEqual(CH);
    expect(userCsvFormat('en')).toEqual(CH);
    browserLanguages(['de-AT']);
    expect(userCsvFormat('de')).toEqual(DE);
    browserLanguages(['en-US', 'de-CH']);
    expect(userCsvFormat('de')).toEqual(INTL);
  });

  it("uses the app's locale for the UI language without browser languages or regions", () => {
    browserLanguages([]);
    expect(userCsvFormat('de')).toEqual(CH);
    expect(userCsvFormat('en')).toEqual(INTL);
    browserLanguages(['de']);
    expect(userCsvFormat('de')).toEqual(CH);
  });
});
