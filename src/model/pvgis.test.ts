import { describe, it, expect } from 'vitest';
import { isPvgisHorizon, parsePvgisHorizon, pvgisHorizonUrl, pvgisToNorthAzimuth } from './pvgis';

// Trimmed verbatim copies of the PVGIS 5.3 printhorizon response for lat=46.62, lon=8.04 (Grindelwald),
// fetched 2026-09-23 from https://re.jrc.ec.europa.eu/api/v5_3/printhorizon?lat=46.62&lon=8.04&outputformat=…
// (only 7 of the 49 rows and 1 of the solstice rows kept).
const JSON_RESPONSE = `{"inputs":{"location":{"latitude":46.62,"longitude":8.04,"elevation":968.0},"horizon_db":"DEM-calculated"},"outputs":{"horizon_profile":[{"A":-180.0,"H_hor":16.8},{"A":-172.5,"H_hor":14.1},{"A":-90.0,"H_hor":24.1},{"A":0.0,"H_hor":32.8},{"A":90.0,"H_hor":9.9},{"A":172.5,"H_hor":17.6},{"A":180.0,"H_hor":16.8}],"winter_solstice":[{"A_sun(w)":-180.0,"H_sun(w)":0.0}],"summer_solstice":[{"A_sun(s)":-180.0,"H_sun(s)":0.0}]},"meta":{"outputs":{"horizon_profile":{"type":"series","description":"Horizon profile","variables":{"A":{"description":"Azimuth (0 = S, 90 = W, -90 = E)","units":"degree"},"H_hor":{"description":"Horizon height","units":"degree"}}}}}}`;

const CSV_RESPONSE =
  'Latitude (deg.): 46.620\r\nLongitude (deg.): 8.040\r\n\r\nA\t\tH_hor\t\tA_sun(w)\t\tH_sun(w)\t\tA_sun(s)\t\tH_sun(s)\r\n' +
  '-180.0\t\t16.8\t\t-180.0\t\t0.0\t\t-180.0\t\t0.0\r\n-172.5\t\t14.1\t\t-162.8\t\t0.0\t\t-172.7\t\t0.0\r\n' +
  '-90.0\t\t24.1\t\t-73.4\t\t0.0\t\t-106.6\t\t16.8\r\n0.0\t\t32.8\t\t0.0\t\t19.9\t\t0.0\t\t66.8\r\n' +
  '90.0\t\t9.9\t\t73.4\t\t0.0\t\t106.6\t\t16.8\r\n172.5\t\t17.6\t\t162.8\t\t0.0\t\t172.7\t\t0.0\r\n' +
  '180.0\t\t16.8\t\t180.0\t\t0.0\t\t180.0\t\t0.0\r\n\r\n' +
  'A: Azimuth (0 = S, 90 = W, -90 = E) (degree)\r\nH_hor: Horizon height (degree)\r\n' +
  'A_sun(w): Sun azimuth in the winter solstice (Dec 21) (0 = S, 90 = W, -90 = E) (degree)\r\n' +
  'H_sun(w): Sun height in the winter solstice (Dec 21) (degree)\r\n' +
  'A_sun(s): Sun azimuth in the summer solstice (June 21) (0 = S, 90 = W, -90 = E) (degree)\r\n' +
  'H_sun(s): Sun height in the summer solstice (June 21) (degree)\r\n\r\nPVGIS (c) European Union, 2001-2026';

// outputformat=basic: the same rows without any header or legend.
const BASIC_RESPONSE = CSV_RESPONSE.split('\r\n')
  .filter((l) => /^-?\d/.test(l))
  .join('\r\n');

// North-based azimuth = A + 180 (PVGIS: 0 = S, 90 = W, −90 = E); A = ±180 both map to north.
const EXPECTED = [
  { azimuth: 0, elevation: 16.8 },
  { azimuth: 7.5, elevation: 14.1 },
  { azimuth: 90, elevation: 24.1 }, // A = −90 (east)
  { azimuth: 180, elevation: 32.8 }, // A = 0 (south)
  { azimuth: 270, elevation: 9.9 }, // A = 90 (west)
  { azimuth: 352.5, elevation: 17.6 },
];

describe('pvgisToNorthAzimuth', () => {
  it('rotates the PVGIS convention (0 = S, 90 = W, −90 = E) to north-based', () => {
    expect(pvgisToNorthAzimuth(0)).toBe(180);
    expect(pvgisToNorthAzimuth(90)).toBe(270);
    expect(pvgisToNorthAzimuth(-90)).toBe(90);
    expect(pvgisToNorthAzimuth(-180)).toBe(0);
    expect(pvgisToNorthAzimuth(180)).toBe(0);
    expect(pvgisToNorthAzimuth(-172.5)).toBe(7.5);
  });
});

describe('parsePvgisHorizon', () => {
  it('parses the JSON output', () => {
    expect(parsePvgisHorizon(JSON_RESPONSE)).toEqual(EXPECTED);
  });

  it('parses the CSV output (header, CRLF, legend and footer lines)', () => {
    expect(parsePvgisHorizon(CSV_RESPONSE)).toEqual(EXPECTED);
  });

  it('parses the basic output (no header)', () => {
    expect(BASIC_RESPONSE.split('\r\n')).toHaveLength(7);
    expect(parsePvgisHorizon(BASIC_RESPONSE)).toEqual(EXPECTED);
  });

  it('accepts a bare JSON array and a BOM, ignores invalid rows', () => {
    const text = '\uFEFF[{"A":0,"H_hor":5},{"A":"x","H_hor":1},{"A":-45,"H_hor":2.5},null]';
    expect(parsePvgisHorizon(text)).toEqual([
      { azimuth: 135, elevation: 2.5 },
      { azimuth: 180, elevation: 5 },
    ]);
  });

  it('accepts decimal commas with ; or tab separators (regression: "-172,5;14,1" gave A = −172, H = 5)', () => {
    // Same rows as JSON_RESPONSE, re-saved by a spreadsheet with a German locale.
    const semicolon = 'A;H_hor\n-180,0;16,8\n-172,5;14,1\n-90,0;24,1\n0,0;32,8\n90,0;9,9\n172,5;17,6\n180,0;16,8\n';
    expect(parsePvgisHorizon(semicolon)).toEqual(EXPECTED);
    expect(parsePvgisHorizon(semicolon.replace(/;/g, '\t'))).toEqual(EXPECTED);
  });

  it('keeps the higher value when −180 and 180 disagree', () => {
    expect(parsePvgisHorizon('A\tH_hor\n-180\t3\n180\t4\n')).toEqual([{ azimuth: 0, elevation: 4 }]);
  });

  it('returns [] for unrecognized input', () => {
    expect(parsePvgisHorizon('')).toEqual([]);
    expect(parsePvgisHorizon('{"outputs":{}}')).toEqual([]);
    expect(parsePvgisHorizon('{not json')).toEqual([]);
    expect(parsePvgisHorizon('hello world\nfoo bar')).toEqual([]);
  });
});

describe('isPvgisHorizon', () => {
  it('recognizes PVGIS output but not a plain azimuth/elevation CSV', () => {
    expect(isPvgisHorizon(JSON_RESPONSE)).toBe(true);
    expect(isPvgisHorizon(CSV_RESPONSE)).toBe(true);
    expect(isPvgisHorizon('azimuth,elevation\n0,5\n90,3\n')).toBe(false);
  });

  it('recognizes the headerless basic output (regression: it fell through to parseHorizonCsv → [])', () => {
    expect(isPvgisHorizon(BASIC_RESPONSE)).toBe(true);
    // Negative azimuths but only 2 columns, or 6 columns without negative (PVGIS) azimuths → not PVGIS.
    expect(isPvgisHorizon('-90,5\n0,3\n90,4\n')).toBe(false);
    expect(isPvgisHorizon('0 5 0 0 0 0\n90 3 0 0 0 0\n')).toBe(false);
    expect(isPvgisHorizon('')).toBe(false);
  });
});

describe('pvgisHorizonUrl', () => {
  it('builds the printhorizon JSON URL', () => {
    expect(pvgisHorizonUrl(46.62, 8.04)).toBe(
      'https://re.jrc.ec.europa.eu/api/v5_3/printhorizon?lat=46.62&lon=8.04&outputformat=json',
    );
  });
});
