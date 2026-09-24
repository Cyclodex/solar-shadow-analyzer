import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../model/defaults';
import { floorHorizons } from '../../model/horizon';
import { simulateYear } from '../../model/simulation';
import type { Config } from '../../model/types';
import { clearSkyYear } from '../../model/weather';
import { shadingTotals } from './shadingTotals';

const config: Config = {
  ...DEFAULT_CONFIG,
  building: { ...DEFAULT_CONFIG.building, numFloors: 3 },
  horizon: { ...DEFAULT_CONFIG.horizon, terrainEnabled: false },
};
const { latitude, longitude } = config.location;
const sim = simulateYear(config, clearSkyYear(latitude, longitude, 2025), floorHorizons(config, null));

describe('shadingTotals', () => {
  it('sums the loss of all floors for the year (equal to the simulation total)', () => {
    const year = shadingTotals(sim);
    const unshaded = sim.floors.reduce((s, fl) => s + fl.annualUnshadedKwh, 0);
    expect(year.unshadedKwh).toBeCloseTo(unshaded, 9);
    expect(year.lossKwh).toBe(sim.totalShadingLossKwh);
    expect(year.lossKwh).toBeGreaterThan(0);
    expect(year.lossPct).toBeCloseTo((sim.totalShadingLossKwh / unshaded) * 100, 9);
  });

  it('sums the loss per month, never negative per floor', () => {
    const june = shadingTotals(sim, 5);
    const expected = sim.floors.reduce(
      (s, fl) => s + Math.max(0, fl.monthlyUnshadedKwh[5] - fl.monthlyKwh[5]),
      0,
    );
    expect(june.lossKwh).toBeCloseTo(expected, 9);
    const months = Array.from({ length: 12 }, (_, m) => shadingTotals(sim, m).lossKwh);
    expect(months.reduce((a, b) => a + b, 0)).toBeCloseTo(sim.totalShadingLossKwh, 6);

    const gain = { ...sim.floors[0], monthlyKwh: sim.floors[0].monthlyUnshadedKwh.map((v) => v + 1) };
    expect(shadingTotals({ ...sim, floors: [gain] }, 5).lossKwh).toBe(0);
  });

  it('is 0 % without any unshaded yield', () => {
    expect(shadingTotals({ ...sim, floors: [] })).toEqual({ unshadedKwh: 0, lossKwh: 0, lossPct: 0 });
  });
});
