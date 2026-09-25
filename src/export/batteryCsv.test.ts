import { describe, expect, it } from 'vitest';
import { pvPowerMatrix, simulateBattery } from '../model/battery';
import { DEFAULT_CONFIG } from '../model/defaults';
import { emptyHorizon } from '../model/horizon';
import { householdLoadW } from '../model/loadProfile';
import { createFloorModel, stepMonths, sunTrack } from '../model/simulation';
import { clearSkyYear } from '../model/weather';
import type { CsvFormat } from './csv';
import { batteryHourlyCsv, batteryMonthlyCsv } from './resultsCsv';

const FMT: CsvFormat = { separator: ';', decimal: '.' };

function result() {
  const config = DEFAULT_CONFIG;
  const weather = clearSkyYear(47.1, 7.45, 2025);
  const model = createFloorModel(config, [emptyHorizon(1), emptyHorizon(1)]);
  const pv = pvPowerMatrix(model, weather, sunTrack(config, weather));
  const load = householdLoadW(weather.timesUtc, 60, 2025, 'Europe/Zurich', 2500, 'h0');
  const months = stepMonths(weather.timesUtc, 2025, 'Europe/Zurich');
  return simulateBattery({ ...config.battery, enabled: true }, 2, weather, pv, load, months);
}

describe('battery CSV', () => {
  const r = result();

  it('monthly: 12 months and the year, flows in kWh, the year row closes with the stored change', () => {
    const lines = batteryMonthlyCsv(r, 'de', FMT).trim().split(/\r?\n/);
    expect(lines).toHaveLength(14);
    const header = lines[0].split(';');
    expect(header[0]).toBe('Monat');
    expect(header).toContain('Direkt verbraucht (kWh)');
    expect(header).toContain('Ohne Batterie: abgeregelt (kWh)');
    const year = lines[13].split(';');
    expect(year[0]).toBe('Jahr');
    expect(Number(year[1])).toBeCloseTo(r.annual.pv, 2);
    expect(Number(year[header.indexOf('Verbrauch (kWh)')])).toBeCloseTo(2500, 2);
    expect(lines[1].split(';')[header.indexOf('Änderung Speicherinhalt (kWh)')]).toBe('');
  });

  it('hourly: one row per weather step in local time, W and SoC in %', () => {
    const lines = batteryHourlyCsv(r, 'Europe/Zurich', 'en', FMT).trim().split(/\r?\n/);
    expect(lines).toHaveLength(8761);
    expect(lines[0]).toBe(
      'Local time (interval start);Solar (W);Solar output directly (W);Charging (W);Discharging (W);Consumption (W);Feed-in (W);Grid purchase (W);State of charge (%)',
    );
    // First step 00:00–01:00 UTC = 01:00 CET.
    expect(lines[1].startsWith('2025-01-01 01:00;0;')).toBe(true);
  });
});
