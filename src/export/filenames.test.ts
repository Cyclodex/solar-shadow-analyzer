import { describe, expect, it } from 'vitest';
import { clearSkyParts, exportFilename, instantParts } from './filenames';

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

  it('names the PNG exports of the views and charts and the monthly table CSV', () => {
    const parts = ['Bern', ...instantParts('2025-06-21', 12 * 60 + 30)];
    expect(exportFilename('scene3d', 'de', parts, 'png')).toBe(
      'verschattung-3d-ansicht-Bern-2025-06-21-1230.png',
    );
    expect(exportFilename('scene3d', 'en', parts, 'png')).toBe('shading-3d-view-Bern-2025-06-21-1230.png');
    expect(exportFilename('frontal', 'en', parts, 'png')).toBe('shading-front-view-Bern-2025-06-21-1230.png');
    expect(exportFilename('profile', 'de', parts, 'png')).toBe(
      'verschattung-seitenansicht-Bern-2025-06-21-1230.png',
    );
    expect(exportFilename('sunPath', 'en', parts, 'png')).toBe('shading-sun-path-Bern-2025-06-21-1230.png');
    expect(exportFilename('panelShadow', 'de', ['Bern', '1. OG'], 'png')).toBe(
      'verschattung-panel-schatten-Bern-1.-OG.png',
    );
    expect(exportFilename('daily', 'en', ['Bern', '2025-06-21'], 'png')).toBe(
      'shading-daily-profile-Bern-2025-06-21.png',
    );
    expect(exportFilename('monthlyTable', 'de', ['Bern', 2025], 'csv')).toBe(
      'verschattung-monatstabelle-Bern-2025.csv',
    );
  });
});

describe('instantParts', () => {
  it('gives the date and the clock time without a colon', () => {
    expect(instantParts('2025-12-21', 7 * 60 + 5)).toEqual(['2025-12-21', '0705']);
  });
});

describe('clearSkyParts', () => {
  it('tags clear-sky results only', () => {
    expect(clearSkyParts('clear-sky', 'de')).toEqual(['klarer-himmel']);
    expect(clearSkyParts('clear-sky', 'en')).toEqual(['clear-sky']);
    expect(clearSkyParts('open-meteo', 'de')).toEqual([]);
  });
});
