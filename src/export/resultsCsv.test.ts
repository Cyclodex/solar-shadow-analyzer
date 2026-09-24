import { describe, expect, it } from 'vitest';
import type { FloorYield, HeatmapData, SimulationResult, TiltSweepPoint } from '../model/types';
import { HEATMAP_BEHIND, HEATMAP_HORIZON, HEATMAP_NIGHT } from '../model/analysis';
import { csvSeparator, heatmapCsv, monthlyResultsCsv, tiltSweepCsv } from './resultsCsv';
import { exportFilename } from './filenames';

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

const rows = (csv: string, sep: string): string[][] =>
  csv
    .trimEnd()
    .split('\r\n')
    .map((r) => r.split(sep));

describe('monthlyResultsCsv', () => {
  it('writes one row per month and a year row, per floor (bottom first) and in total', () => {
    const csv = monthlyResultsCsv(sim, 'de');
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

  it('uses English headers and a comma separator in English', () => {
    const r = rows(monthlyResultsCsv(sim, 'en'), ',');
    expect(r[0][0]).toBe('Month');
    expect(r[0][1]).toBe('Floor 1: yield (kWh)');
    expect(r[1][0]).toBe('January');
    expect(r[13][0]).toBe('Year');
    expect(csvSeparator('en')).toBe(',');
    expect(csvSeparator('de')).toBe(';');
  });
});

describe('tiltSweepCsv', () => {
  it('lists θ, β and the yield per floor and in total', () => {
    const points: TiltSweepPoint[] = [
      { tiltFromVertical: 0, floorsKwh: [100.004, 120], totalKwh: 220.004 },
      { tiltFromVertical: 45, floorsKwh: [150.5, 160.25], totalKwh: 310.75 },
    ];
    const r = rows(tiltSweepCsv(points, [1, 2], 'de'), ';');
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
    const r = rows(heatmapCsv(h, 'en'), ',');
    expect(r).toEqual([
      ['Date', '06:00', '12:00'],
      ['2025-01-01', '50', '0'],
      ['2025-01-02', '', '25'],
    ]);
  });
});

describe('exportFilename', () => {
  it('builds localised, safe file names', () => {
    expect(exportFilename('monthly', 'de', ['Zürich', 2025], 'csv')).toBe(
      'verschattung-monatsertrag-Zurich-2025.csv',
    );
    expect(exportFilename('config', 'en', ['47.100° N, 7.450° E'], 'json')).toBe(
      'shading-configuration-47.100-N-7.450-E.json',
    );
    expect(exportFilename('heatmap', 'de', ['', '1. OG'], 'csv')).toBe(
      'verschattung-schatten-heatmap-1.-OG.csv',
    );
  });
});
