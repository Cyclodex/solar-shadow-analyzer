import { describe, expect, it } from 'vitest';
import { HEATMAP_BEHIND, HEATMAP_HORIZON, HEATMAP_NIGHT } from '../../model/analysis';
import type { DailyProfilePoint, HeatmapData } from '../../model/types';
import { CELL, cellClass, shadeStep } from './colors';
import {
  cellAt,
  classifyCells,
  layoutHeatmap,
  mix,
  monthStartDays,
  sameDayIn,
  visibleSlots,
} from './heatmap';
import {
  daylightWindow,
  hourTickStep,
  maxShadePerPoint,
  peakIndex,
  shadeRuns,
  shadedPeriods,
} from './timeAxis';

/** 2 days × 24 hourly slots: sun from 06:00 to 17:59 on day 0, 08:00–15:59 on day 1. */
function fakeHeatmap(): HeatmapData {
  const days = 2;
  const slotsPerDay = 24;
  const values = new Float32Array(days * slotsPerDay).fill(HEATMAP_NIGHT);
  for (let s = 6; s < 18; s++) values[s] = 0;
  for (let s = 8; s < 16; s++) values[slotsPerDay + s] = 0.5;
  values[6] = HEATMAP_BEHIND;
  values[7] = HEATMAP_HORIZON;
  return { year: 2025, days, slotsPerDay, slotMinutes: 60, values, floor: 0 };
}

describe('colours', () => {
  it('bins the shaded fraction with the heatmapStats threshold', () => {
    expect(shadeStep(0)).toBe(-1);
    expect(shadeStep(0.01)).toBe(-1);
    expect(shadeStep(0.011)).toBe(0);
    expect(shadeStep(0.2)).toBe(0);
    expect(shadeStep(0.21)).toBe(1);
    expect(shadeStep(1)).toBe(4);
  });

  it('classifies heatmap cells', () => {
    expect(cellClass(HEATMAP_NIGHT)).toBe(CELL.night);
    expect(cellClass(HEATMAP_BEHIND)).toBe(CELL.behind);
    expect(cellClass(HEATMAP_HORIZON)).toBe(CELL.horizon);
    expect(cellClass(0)).toBe(CELL.sun);
    expect(cellClass(0.9)).toBe(CELL.shade + 4);
  });

  it('mixes canvas colours', () => {
    expect(mix([0, 0, 0, 255], [200, 100, 50, 255], 0.5)).toEqual([100, 50, 25, 255]);
  });
});

describe('heatmap data prep', () => {
  it('keeps the slots with sun on any day plus an hour on both sides', () => {
    expect(visibleSlots(fakeHeatmap())).toEqual({ first: 5, count: 14 });
    const allNight = { ...fakeHeatmap(), values: new Float32Array(48).fill(HEATMAP_NIGHT) };
    expect(visibleSlots(allNight)).toEqual({ first: 0, count: 24 });
  });

  it('classifies the visible cells row-major per day', () => {
    const h = fakeHeatmap();
    const range = visibleSlots(h);
    const cells = classifyCells(h, range);
    expect(cells).toHaveLength(2 * range.count);
    expect(cells[0]).toBe(CELL.night); // 05:00
    expect(cells[1]).toBe(CELL.behind); // 06:00
    expect(cells[2]).toBe(CELL.horizon); // 07:00
    expect(cells[3]).toBe(CELL.sun); // 08:00
    expect(cells[range.count + 3]).toBe(CELL.shade + 2); // day 1, 08:00, 50 %
  });

  it('lists month starts (leap years included)', () => {
    const starts = monthStartDays(2024);
    expect(starts).toHaveLength(13);
    expect(starts[0]).toBe(0);
    expect(starts[2]).toBe(60);
    expect(starts[12]).toBe(366);
    expect(monthStartDays(2025)[12]).toBe(365);
  });

  it('maps a date onto the heatmap year by month and day (not by day of the year)', () => {
    expect(sameDayIn(2024, '2026-09-24')).toBe('2024-09-24');
    expect(sameDayIn(2024, '2026-03-01')).toBe('2024-03-01');
    expect(sameDayIn(2024, '2026-12-31')).toBe('2024-12-31');
    expect(sameDayIn(2025, '2028-09-24')).toBe('2025-09-24');
    expect(sameDayIn(2025, '2028-02-29')).toBe('2025-02-28');
    expect(sameDayIn(2024, '2028-02-29')).toBe('2024-02-29');
  });

  it('lays out plot and legend, and finds cells under the pointer', () => {
    const text = { night: 'Nacht', behind: 'Fassade', horizon: 'Horizont', sun: 'Sonne', shaded: 'Anteil' };
    const measure = (s: string): number => s.length * 7;
    const wide = layoutHeatmap(600, text, true, measure);
    expect(wide.plot.w).toBe(600 - 44 - 8);
    expect(wide.ramp).not.toBeNull();
    expect(wide.height).toBeGreaterThan(wide.plot.y + wide.plot.h);
    const narrow = layoutHeatmap(300, text, false, measure);
    expect(narrow.ramp).toBeNull();
    expect(narrow.entries.at(-1)!.y).toBeGreaterThan(narrow.entries[0].y); // wrapped
    expect(cellAt(wide, 365, 100, 0, 0)).toEqual({ day: 0, row: 0 });
    expect(cellAt(wide, 365, 100, wide.plot.w - 0.01, wide.plot.h - 0.01)).toEqual({ day: 364, row: 99 });
    expect(cellAt(wide, 365, 100, -1, 5)).toBeNull();
  });
});

describe('daily profile helpers', () => {
  const pt = (minutes: number, w: number[], shade: number[]): DailyProfilePoint => ({
    minutes,
    altitude: 30,
    azimuth: 180,
    floorsW: w,
    floorsShade: shade,
  });
  const points = [
    pt(600, [100, 100], [0, 0]),
    pt(610, [80, 120], [0.3, 0]),
    pt(620, [70, 130], [0.35, 0]),
    pt(630, [60, 140], [0.7, 0]),
    pt(640, [150, 150], [0, 0]),
  ];

  it('crops the day to sunrise − 1 h … sunset + 1 h on whole hours', () => {
    expect(daylightWindow({ sunrise: 335, solarNoon: 810, sunset: 1289, polar: null })).toEqual({
      start: 240,
      end: 1380,
    });
    expect(daylightWindow({ sunrise: null, solarNoon: 720, sunset: null, polar: 'day' })).toEqual({
      start: 0,
      end: 1440,
    });
    expect(daylightWindow({ sunrise: -20, solarNoon: 720, sunset: 1500, polar: null })).toEqual({
      start: 0,
      end: 1440,
    });
  });

  it('chooses readable hour ticks', () => {
    expect(hourTickStep(1)).toBe(60);
    expect(hourTickStep(0.5)).toBe(120);
    expect(hourTickStep(0.2)).toBe(240);
  });

  it('finds shaded periods, shade runs and peaks', () => {
    expect(shadedPeriods(points, 0)).toEqual([[610, 630]]);
    expect(shadedPeriods(points, 1)).toEqual([]);
    const runs = shadeRuns(points, maxShadePerPoint(points));
    expect(runs).toEqual([
      { from: 610, to: 620, step: 1 },
      { from: 630, to: 630, step: 3 },
    ]);
    expect(peakIndex(points, 0)).toBe(4);
    expect(peakIndex([pt(0, [0], [0])], 0)).toBe(-1);
  });
});
