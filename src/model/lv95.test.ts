import { describe, expect, it } from 'vitest';
import { enuToLonLat, lonLatToEnu } from './enu';
import {
  gridToTrueAzimuth,
  lv95Convergence,
  lv95LocalFrame,
  lv95ToWgs84,
  trueToGridAzimuth,
  wgs84ToLv95,
} from './lv95';

/**
 * Reference points: REFRAME (https://geodesy.geo.admin.ch/reframe/wgs84tolv95, format=json), queried
 * 2026-09-25 — WGS84 latitude/longitude → LV95 east/north.
 */
const REFRAME: readonly { name: string; lat: number; lon: number; east: number; north: number }[] = [
  { name: 'Geneva', lat: 46.20431, lon: 6.14311, east: 2500008.900355034, north: 1117811.1701935336 },
  { name: 'Bern-Bümpliz', lat: 46.93971, lon: 7.39127, east: 2596393.705483696, north: 1198736.804128018 },
  { name: 'St. Gallen', lat: 47.42391, lon: 9.37725, east: 2746265.1897219084, north: 1254373.8988787553 },
  { name: 'Chur', lat: 46.8499, lon: 9.53202, east: 2759642.3745607906, north: 1190880.863300849 },
  {
    name: 'Kramgasse 49, Bern',
    lat: 46.947849,
    lon: 7.449978,
    east: 2600863.735848421,
    north: 1199640.5407642045,
  },
  { name: 'Lugano', lat: 46.0037, lon: 8.9511, east: 2717161.185109146, north: 1095811.5377678375 },
  { name: 'Basel', lat: 47.5596, lon: 7.5886, east: 2611287.8310699333, north: 1267664.8347411293 },
  {
    name: 'Bern (LV95 origin)',
    lat: 46.95108,
    lon: 7.43863,
    east: 2599999.810602969,
    north: 1199999.6813454262,
  },
  { name: 'Lower Engadine', lat: 46.6, lon: 10.4, east: 2826856.46919071, north: 1165252.5349769797 },
  { name: 'West of Geneva', lat: 46.3, lon: 6.0, east: 2489159.9881149046, north: 1128639.5083973221 },
];

/**
 * Meridian convergence (grid azimuth of true north) from REFRAME: LV95 of lat ± 0.001° at the same longitude
 * (the values quoted in the research report, reports/integrate.json).
 */
const CONVERGENCE: readonly { name: string; lat: number; lon: number; deg: number }[] = [
  { name: 'Geneva', lat: 46.20431, lon: 6.14311, deg: 0.9475 },
  { name: 'Bern-Bümpliz', lat: 46.93971, lon: 7.39127, deg: 0.0353 },
  { name: 'St. Gallen', lat: 47.42391, lon: 9.37725, deg: -1.4159 },
  { name: 'Chur', lat: 46.8499, lon: 9.53202, deg: -1.529 },
];

describe('wgs84ToLv95 / lv95ToWgs84', () => {
  it('matches REFRAME within 0.35 m (swisstopo approximate formula)', () => {
    for (const r of REFRAME) {
      const p = wgs84ToLv95(r.lat, r.lon);
      expect(Math.hypot(p.east - r.east, p.north - r.north), r.name).toBeLessThan(0.35);
    }
  });

  it("reproduces swisstopo's numerical example (E 2 699 999.76, N 1 099 999.97)", () => {
    // φ = 46° 02' 38.87", λ = 8° 43' 49.79"
    const p = wgs84ToLv95(46 + 2 / 60 + 38.87 / 3600, 8 + 43 / 60 + 49.79 / 3600);
    expect(p.east).toBeCloseTo(2699999.76, 2);
    expect(p.north).toBeCloseTo(1099999.97, 2);
  });

  it('inverts to the REFRAME position within 0.35 m and round-trips the forward formula exactly', () => {
    for (const r of REFRAME) {
      const g = lv95ToWgs84(r.east, r.north);
      const [de, dn] = lonLatToEnu({ latitude: r.lat, longitude: r.lon }, g.latitude, g.longitude);
      expect(Math.hypot(de, dn), r.name).toBeLessThan(0.35);
      const back = wgs84ToLv95(g.latitude, g.longitude);
      expect(Math.abs(back.east - r.east), r.name).toBeLessThan(1e-3);
      expect(Math.abs(back.north - r.north), r.name).toBeLessThan(1e-3);
    }
  });
});

describe('lv95Convergence', () => {
  it('matches REFRAME: Geneva +0.947°, Bümpliz +0.035°, St. Gallen −1.416°, Chur −1.530°', () => {
    for (const c of CONVERGENCE) expect(lv95Convergence(c.lat, c.lon), c.name).toBeCloseTo(c.deg, 2);
    // Zero at the projection centre (Bern, old observatory).
    expect(Math.abs(lv95Convergence(46.95108, 7.43863))).toBeLessThan(0.002);
  });

  it('equals the grid direction of a meridian step computed with the forward formula', () => {
    for (const r of REFRAME) {
      const a = wgs84ToLv95(r.lat - 0.001, r.lon);
      const b = wgs84ToLv95(r.lat + 0.001, r.lon);
      const deg = (Math.atan2(b.east - a.east, b.north - a.north) * 180) / Math.PI;
      expect(lv95Convergence(r.lat, r.lon), r.name).toBeCloseTo(deg, 4);
    }
  });

  it('converts grid azimuths to true azimuths and back', () => {
    // Chur: grid north lies 1.53° clockwise of true north's grid direction → a grid azimuth of 0° is 1.53° true.
    expect(gridToTrueAzimuth(0, 46.8499, 9.53202)).toBeCloseTo(1.529, 2);
    expect(gridToTrueAzimuth(180, 46.20431, 6.14311)).toBeCloseTo(179.0525, 2);
    expect(trueToGridAzimuth(359.5, 46.20431, 6.14311)).toBeCloseTo(0.4475, 2);
    for (const r of REFRAME) {
      for (const az of [0, 90, 153.4, 359.9]) {
        const back = gridToTrueAzimuth(trueToGridAzimuth(az, r.lat, r.lon), r.lat, r.lon);
        expect(Math.abs(((back - az + 540) % 360) - 180), r.name).toBeLessThan(1e-9);
      }
    }
  });
});

describe('lv95LocalFrame', () => {
  it('maps ENU metres to LV95 like the full formula: ≤ 1 cm within 300 m, ≤ 3 cm within 500 m', () => {
    for (const r of REFRAME) {
      const origin = { latitude: r.lat, longitude: r.lon };
      const f = lv95LocalFrame(origin);
      expect(f.convergence).toBeCloseTo(lv95Convergence(r.lat, r.lon), 9);
      for (const [radius, tol] of [
        [300, 0.01],
        [500, 0.03],
      ] as const) {
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          const e = radius * Math.sin(a);
          const n = radius * Math.cos(a);
          const g = enuToLonLat(origin, e, n);
          const exact = wgs84ToLv95(g.latitude, g.longitude);
          const approx = f.toLv95(e, n);
          expect(Math.hypot(exact.east - approx.east, exact.north - approx.north), r.name).toBeLessThan(tol);
          const [be, bn] = f.toEnu(approx.east, approx.north);
          expect(be).toBeCloseTo(e, 6);
          expect(bn).toBeCloseTo(n, 6);
        }
      }
    }
  });

  it('rotates true north by the convergence (Chur: a point due north lies west of grid north)', () => {
    const f = lv95LocalFrame({ latitude: 46.8499, longitude: 9.53202 });
    const p = f.toLv95(0, 100);
    const gridAzimuth = (Math.atan2(p.east - f.origin.east, p.north - f.origin.north) * 180) / Math.PI;
    expect(gridAzimuth).toBeCloseTo(-1.529, 2);
  });
});
