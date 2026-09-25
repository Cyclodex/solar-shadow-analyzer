import { describe, it, expect } from 'vitest';
import { h0Dynamisation, h0Quarter, h0Season, householdLoadW } from './loadProfile';
import { H0_QUARTER_HOURS } from './loadProfileData';
import { clearSkyYear } from './weather';

describe('H0 standard load profile (BDEW)', () => {
  it('has 96 quarter hours for every season and day type, values from the BDEW sheet', () => {
    for (const season of Object.values(H0_QUARTER_HOURS)) {
      for (const day of Object.values(season)) expect(day).toHaveLength(96);
    }
    // First rows of "Repräsentative Profile VDEW.xls", sheet H0 (00:00–00:15).
    expect(H0_QUARTER_HOURS.winter.workday[0]).toBe(67.6);
    expect(H0_QUARTER_HOURS.winter.saturday[0]).toBe(70.8);
    expect(H0_QUARTER_HOURS.winter.sunday[0]).toBe(87.5);
    expect(H0_QUARTER_HOURS.summer.saturday[0]).toBe(89.8);
    expect(H0_QUARTER_HOURS.transition.workday[1]).toBe(69.6);
  });

  it('dynamisation factor as printed in the BDEW step-by-step guide (F1, F202 minimum, F365)', () => {
    expect(h0Dynamisation(1)).toBe(1.242);
    expect(h0Dynamisation(202)).toBe(0.7847);
    expect(h0Dynamisation(365)).toBe(1.2572);
  });

  it('seasons: winter 1.11.–20.3., summer 15.5.–14.9., transition otherwise', () => {
    expect(h0Season(10, 1)).toBe('winter');
    expect(h0Season(2, 20)).toBe('winter');
    expect(h0Season(2, 21)).toBe('transition');
    expect(h0Season(4, 14)).toBe('transition');
    expect(h0Season(4, 15)).toBe('summer');
    expect(h0Season(8, 14)).toBe('summer');
    expect(h0Season(8, 15)).toBe('transition');
    expect(h0Season(9, 31)).toBe('transition');
  });

  it('the dynamised profile of 2026 sums to 997.1 kWh per 1000 kWh/a (hence the rescaling)', () => {
    let sum = 0;
    for (let d = 0; d < 365; d++) {
      const dt = new Date(Date.UTC(2026, 0, 1 + d));
      const F = h0Dynamisation(d + 1);
      const season = h0Season(dt.getUTCMonth(), dt.getUTCDate());
      for (let q = 0; q < 96; q++) sum += h0Quarter(season, dt.getUTCDay(), q) * F * 0.25;
    }
    // Wh for 1000 kWh/a, F rounded to 4 decimals as BDEW recommends (unrounded: 997 117.7 Wh).
    expect(sum).toBeCloseTo(997117.25, 1);
  });
});

describe('householdLoadW', () => {
  const w = clearSkyYear(47.1, 7.45, 2025);

  it('scales the year to the annual consumption, for H0 and flat', () => {
    for (const kind of ['h0', 'flat'] as const) {
      const load = householdLoadW(w.timesUtc, w.stepMinutes, w.year, 'Europe/Zurich', 4500, kind);
      let wh = 0;
      for (const x of load) wh += x * (w.stepMinutes / 60);
      expect(wh / 1000).toBeCloseTo(4500, 6);
    }
    const flat = householdLoadW(w.timesUtc, 60, 2025, 'Europe/Zurich', 8760, 'flat');
    expect(flat[0]).toBeCloseTo(1000, 9);
  });

  it('averages the four quarter hours of the local hour (CET: 00:00 UTC = 01:00 local)', () => {
    const load = householdLoadW(w.timesUtc, 60, 2025, 'Europe/Zurich', 1000, 'h0');
    // Step 0 = 00:00–01:00 UTC = 01:00–02:00 CET on Wed 1 Jan 2025 (winter workday; no holidays modelled).
    const q = H0_QUARTER_HOURS.winter.workday;
    const raw = ((q[4] + q[5] + q[6] + q[7]) / 4) * h0Dynamisation(1);
    // Scale of the year: 1000 kWh over the sum of the raw profile.
    let rawSum = 0;
    const unscaled = householdLoadW(w.timesUtc, 60, 2025, 'Europe/Zurich', 1000, 'h0');
    for (const x of unscaled) rawSum += x;
    expect(rawSum / 1000).toBeCloseTo(1000, 6);
    const ratio = load[0] / raw;
    // Same ratio at another hour: 12:00–13:00 CET on Sat 4 Jan 2025 (winter Saturday).
    const i = 3 * 24 + 11;
    const s = H0_QUARTER_HOURS.winter.saturday;
    const rawSat = ((s[48] + s[49] + s[50] + s[51]) / 4) * h0Dynamisation(4);
    expect(load[i] / rawSat).toBeCloseTo(ratio, 9);
    // The scale factor is 1000 kWh / (profile sum ≈ 997 kWh): close to 1.
    expect(ratio).toBeGreaterThan(0.99);
    expect(ratio).toBeLessThan(1.01);
  });

  it('returns zeros for no consumption', () => {
    const load = householdLoadW(w.timesUtc, 60, 2025, 'Europe/Zurich', 0, 'h0');
    expect(load.every((x) => x === 0)).toBe(true);
  });
});
