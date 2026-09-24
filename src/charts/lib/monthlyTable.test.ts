import { describe, expect, it } from 'vitest';
import type { HeatmapStats } from '../../model/analysis';
import type { FloorYield, SimulationResult } from '../../model/types';
import { monthlyRows } from './monthlyTable';

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
