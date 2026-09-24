import { describe, expect, it } from 'vitest';
import type { HeatmapStats } from '../../model/analysis';
import type { FloorYield, SimulationResult } from '../../model/types';
import { monthlyCsv, monthlyRows } from './monthlyTable';

function floor(k: number, monthly: number, unshaded: number): FloorYield {
  return {
    floor: k,
    storey: k + 1,
    monthlyKwh: Array(12).fill(monthly),
    annualKwh: monthly * 12,
    monthlyUnshadedKwh: Array(12).fill(unshaded),
    annualUnshadedKwh: unshaded * 12,
    shadingLossKwh: (unshaded - monthly) * 12,
    shadingLossPct: unshaded > 0 ? ((unshaded - monthly) / unshaded) * 100 : 0,
    poaKwhPerM2: 0,
    clippedKwh: 0,
    specificYield: 0,
    skyViewFactor: 1,
  };
}

const sim: SimulationResult = {
  source: 'clear-sky',
  year: 2025,
  floors: [floor(0, 90, 100), floor(1, 110, 110)],
  totalAnnualKwh: 2400,
  totalMonthlyKwh: Array(12).fill(200),
  totalShadingLossKwh: 120,
};

const stats: HeatmapStats = {
  litHours: 1000,
  shadedHours: 120,
  shadedPct: 12,
  monthly: Array.from({ length: 12 }, (_, month) => ({
    month,
    litHours: 80,
    shadedHours: 10,
    maxShade: 0.5,
  })),
};

const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

describe('monthlyRows', () => {
  it('sums floors, loss and loss share per month and for the year', () => {
    const { months: rows, year } = monthlyRows(sim, stats);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({
      month: 0,
      floorsKwh: [90, 110],
      totalKwh: 200,
      lossKwh: 10,
      lossPct: (10 / 210) * 100,
      shadedHours: 10,
    });
    expect(year.totalKwh).toBe(2400);
    expect(year.lossKwh).toBe(120);
    expect(year.lossPct).toBeCloseTo((120 / 2520) * 100, 9);
    expect(year.shadedHours).toBe(120);
    expect(monthlyRows(sim, null).year.shadedHours).toBeNull();
  });
});

describe('monthlyCsv', () => {
  it('writes a header, 12 months and the year with machine-readable numbers', () => {
    const csv = monthlyCsv(monthlyRows(sim, stats), {
      month: 'Monat',
      floors: ['1. OG (kWh)', '2. OG (kWh)'],
      total: 'Total (kWh)',
      lossKwh: 'Verlust (kWh)',
      lossPct: 'Verlust (%)',
      shadedHours: 'Verschattete Stunden 1. OG (h)',
      monthNames: months,
      year: 'Jahr',
    });
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(14);
    expect(lines[0]).toBe(
      'Monat,1. OG (kWh),2. OG (kWh),Total (kWh),Verlust (kWh),Verlust (%),Verschattete Stunden 1. OG (h)',
    );
    expect(lines[1]).toBe('Jan,90,110,200,10,4.76,10');
    expect(lines[13]).toBe('Jahr,1080,1320,2400,120,4.76,120');
  });

  it('uses the given separator and rounds kWh to 2 decimals', () => {
    const odd: SimulationResult = {
      ...sim,
      floors: [floor(0, 90.123456, 100.5), floor(1, 110, 110)],
    };
    const csv = monthlyCsv(
      monthlyRows(odd, stats),
      {
        month: 'Monat',
        floors: ['1. OG (kWh)', '2. OG (kWh)'],
        total: 'Total (kWh)',
        lossKwh: 'Verlust (kWh)',
        lossPct: 'Verlust (%)',
        shadedHours: 'Verschattete Stunden 1. OG (h)',
        monthNames: months,
        year: 'Jahr',
      },
      { separator: ';' },
    );
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Monat;1. OG (kWh);2. OG (kWh);Total (kWh);Verlust (kWh);Verlust (%);Verschattete Stunden 1. OG (h)',
    );
    expect(lines[1]).toBe('Jan;90.12;110;200.12;10.38;4.93;10');
  });

  it('drops the total and loss columns for a single floor', () => {
    const single: SimulationResult = { ...sim, floors: [floor(0, 100, 100)], totalShadingLossKwh: 0 };
    const csv = monthlyCsv(monthlyRows(single, null), {
      month: 'Month',
      floors: ['Floor 1 (kWh)'],
      total: 'Total (kWh)',
      lossKwh: null,
      lossPct: null,
      shadedHours: null,
      monthNames: months,
      year: 'Year',
    });
    expect(csv.split('\r\n')[0]).toBe('Month,Floor 1 (kWh)');
    expect(csv.split('\r\n')[1]).toBe('Jan,100');
  });
});
