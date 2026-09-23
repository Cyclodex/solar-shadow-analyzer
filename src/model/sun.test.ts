import { describe, it, expect } from 'vitest';
import { SUNRISE_ALTITUDE, noaaRefraction, solarPath, sunPosition, sunTimes, sunVectorEnu } from './sun';
import { localToUtc } from './time';
import { angleDiff, toRad } from './units';

const utc = (iso: string): number => Date.parse(iso);

// Tolerances come from a cross-check against astronomy-engine 2.1.19 (independent VSOP87-based ephemeris;
// script kept outside the repo) over 20 000 random instants 1970–2070 at random latitudes/longitudes:
//   max |Δaltitude| 0.0173°, max |Δazimuth|·cos(alt) 0.0153°, max |Δdeclination| 0.0055°,
//   max |Δtransit| 3.8 s (3 000 samples), max |Δsunrise/sunset| 11.7 s for |lat| ≤ 65° (6 000 events).
// astronomy-engine is topocentric (parallax ≤ 0.0024°) and uses TT; NOAA is geocentric in UT.
const POS_TOL = 0.02; // deg
const DECL_TOL = 0.01; // deg
const EOT_TOL = 0.07; // min (3.8 s → 0.063 min)
const RISE_SET_TOL = 0.25; // min (11.7 s → 0.2 min)

describe('sunPosition', () => {
  it('matches the NREL SPA reference case (Reda & Andreas 2004)', () => {
    // 2003-10-17 12:30:30 local, UTC−7 → 19:30:30Z; lat 39.742476, lon −105.1786.
    // SPA (P = 820 mbar, T = 11 °C, h = 1830.14 m, ΔT = 67 s): topocentric zenith 50.11162°, azimuth 194.34024°,
    // EoT 14.641511 min — reproduced with pvlib 0.15.2 spa_python (50.11162202°, 194.34024051°, 14.64151077 min).
    // Expected NOAA − SPA deviation: model accuracy (≤ 0.0173° vs astronomy-engine, see above) plus SPA's
    // non-standard atmosphere (refraction 0.0163° vs NOAA 0.0193° here → 0.0030°) and parallax (0.0019°).
    const s = sunPosition(utc('2003-10-17T19:30:30Z'), 39.742476, -105.1786);
    expect(Math.abs(90 - s.altitude - 50.11162)).toBeLessThan(POS_TOL);
    expect(Math.abs(s.azimuth - 194.34024)).toBeLessThan(POS_TOL);
    expect(Math.abs(s.equationOfTime - 14.641511)).toBeLessThan(EOT_TOL);
  });

  it('agrees with astronomy-engine at sample instants (both hemispheres, polar)', () => {
    // [instant, lat, lon, altitude, azimuth, declination] — astronomy-engine 2.1.19: Equator(Sun, date, observer,
    // ofdate = true, aberration = true) + Horizon(..., refraction = null), observer at sea level.
    const refs: [string, number, number, number, number, number][] = [
      ['2025-06-21T10:00:00Z', 46.948, 7.447, 60.127467, 133.932188, 23.437056],
      ['2025-12-21T12:00:00Z', -33.8688, 151.2093, -26.67244, 209.16597, -23.436043],
      ['2024-03-20T06:30:00Z', 69.65, 18.96, 8.379182, 113.228904, 0.053649],
      ['2030-09-01T18:45:00Z', -54.8, -68.3, 21.367335, 324.643532, 8.052584],
      ['1999-08-11T11:03:00Z', 48.1, 11.6, 57.063771, 172.958014, 15.32643],
      ['2040-01-15T23:10:00Z', 78.22, 15.65, -32.833882, 0.888654, -21.055149],
    ];
    for (const [iso, lat, lon, alt, az, decl] of refs) {
      const s = sunPosition(utc(iso), lat, lon, { refraction: false });
      expect(Math.abs(s.altitude - alt)).toBeLessThan(POS_TOL);
      expect(Math.abs(angleDiff(s.azimuth, az)) * Math.cos(toRad(alt))).toBeLessThan(POS_TOL);
      expect(Math.abs(s.declination - decl)).toBeLessThan(DECL_TOL);
    }
  });

  it('gives the equation of time of astronomy-engine transits', () => {
    // EoT = 720 − UTC minutes of the transit at Greenwich (astronomy-engine SearchHourAngle(Sun, lon 0, ha 0)).
    // Covers both extremes (Feb ≈ −14.2 min, Nov ≈ +16.4 min).
    const refs: [string, number][] = [
      ['2025-02-11T12:14:11.278Z', -14.188],
      ['2025-04-15T11:59:56.892Z', 0.0518],
      ['2025-07-26T12:06:33.888Z', -6.5648],
      ['2025-11-03T11:43:33.922Z', 16.4346],
      ['2025-12-25T12:00:10.545Z', -0.1757],
    ];
    for (const [iso, eot] of refs) expect(Math.abs(sunPosition(utc(iso), 51.4769, 0).equationOfTime - eot)).toBeLessThan(EOT_TOL);
  });

  it('applies NOAA refraction to the altitude only', () => {
    const t = utc('2025-06-21T05:00:00Z');
    const geo = sunPosition(t, 46.948, 7.447, { refraction: false });
    const app = sunPosition(t, 46.948, 7.447);
    expect(app.altitude - geo.altitude).toBeCloseTo(noaaRefraction(geo.altitude), 12);
    expect(app.azimuth).toBe(geo.azimuth);
  });

  it('has the analytic transit geometry in both hemispheres', () => {
    // At hour angle 0: altitude = 90° − |φ − δ|, sun due north if δ > φ, due south if δ < φ.
    const cases: [string, number, number, string, number][] = [
      ['2025-06-21', 46.948, 7.447, 'Europe/Zurich', 180],
      ['2025-12-21', -33.8688, 151.2093, 'Australia/Sydney', 0], // δ ≈ −23.4° > φ → north
      ['2025-06-21', -33.8688, 151.2093, 'Australia/Sydney', 0],
      ['2025-06-21', 10, -60, 'America/Caracas', 0], // tropics, sun north of zenith
    ];
    for (const [date, lat, lon, tz, az] of cases) {
      const noon = localToUtc(date, sunTimes(date, lat, lon, tz).solarNoon, tz);
      const s = sunPosition(noon, lat, lon, { refraction: false });
      expect(s.altitude).toBeCloseTo(90 - Math.abs(lat - s.declination), 6);
      expect(Math.abs(angleDiff(s.azimuth, az))).toBeLessThan(1e-3);
    }
  });

  it('equals ±declination at the poles and never returns NaN', () => {
    // φ = ±90°: sin(alt) = ±sin δ exactly (the hour angle drops out).
    const t = utc('2025-06-21T00:00:00Z');
    const north = sunPosition(t, 90, 0, { refraction: false });
    const south = sunPosition(t, -90, 0, { refraction: false });
    expect(north.altitude).toBeCloseTo(north.declination, 9);
    expect(south.altitude).toBeCloseTo(-south.declination, 9);
    for (let i = 0; i < 2000; i++) {
      const lat = -90 + (180 * i) / 1999;
      const s = sunPosition(t + i * 3_600_000 * 7.3, lat, -180 + (i * 37) % 360);
      for (const v of [s.altitude, s.azimuth, s.declination, s.equationOfTime]) expect(Number.isFinite(v)).toBe(true);
      expect(s.azimuth).toBeGreaterThanOrEqual(0);
      expect(s.azimuth).toBeLessThan(360);
    }
  });

  it('is fast enough for yearly loops', () => {
    const t0 = performance.now();
    let sum = 0;
    for (let i = 0; i < 100_000; i++) sum += sunPosition(1.7e12 + i * 60_000, 47, 7).altitude;
    expect(Number.isFinite(sum)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(1000); // ≈ 60 ms measured
  });
});

describe('noaaRefraction', () => {
  it('follows the NOAA piecewise formula', () => {
    // Values straight from the published coefficients: 0° → 1735″; 45° → 58.1 − 0.07 + 0.000086 = 58.030086″.
    expect(noaaRefraction(0)).toBeCloseTo(1735 / 3600, 12);
    expect(noaaRefraction(45)).toBeCloseTo(58.030086 / 3600, 12);
    expect(noaaRefraction(-2)).toBeCloseTo(20.772 / Math.tan(toRad(2)) / 3600, 12);
    expect(noaaRefraction(86)).toBe(0);
  });

  it('is nearly continuous at the branch limits', () => {
    // Evaluated from the coefficients: at 5° the branches give 576.3″ vs 574.6″, at −0.575° 2069.66″ vs 2069.75″.
    const jump = (e: number): number => Math.abs(noaaRefraction(e + 1e-9) - noaaRefraction(e - 1e-9)) * 3600;
    expect(jump(5)).toBeLessThan(2);
    expect(jump(-0.575)).toBeLessThan(0.5);
  });
});

describe('sunVectorEnu', () => {
  it('points along azimuth/altitude in ENU', () => {
    const v = sunVectorEnu({ altitude: 0, azimuth: 90, declination: 0, equationOfTime: 0 });
    expect(v.x).toBeCloseTo(1, 12);
    expect(v.y).toBeCloseTo(0, 12);
    expect(v.z).toBeCloseTo(0, 12);
    const w = sunVectorEnu({ altitude: 30, azimuth: 180, declination: 0, equationOfTime: 0 });
    expect(w.x).toBeCloseTo(0, 12);
    expect(w.y).toBeCloseTo(-Math.cos(toRad(30)), 12);
    expect(w.z).toBeCloseTo(0.5, 12);
  });

  it('is a unit vector', () => {
    const s = sunPosition(utc('2025-08-01T15:00:00Z'), 46.948, 7.447);
    const v = sunVectorEnu(s);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 12);
  });
});

describe('sunTimes', () => {
  // References: astronomy-engine 2.1.19 SearchRiseSet (upper limb, 34′ refraction) and SearchHourAngle(ha 0),
  // converted to local clock minutes. [date, lat, lon, tz, sunrise, transit, sunset]
  const refs: [string, number, number, string, number, number, number][] = [
    ['2025-06-21', 46.948, 7.447, 'Europe/Zurich', 335.3936, 812.0648, 1288.726], // Bern 05:35 / 21:29 CEST
    ['2025-12-21', 46.948, 7.447, 'Europe/Zurich', 492.9117, 748.3854, 1003.8569], // Bern 08:13 / 16:44 CET
    ['2025-12-21', -33.8688, 151.2093, 'Australia/Sydney', 340.7348, 773.1372, 1205.5485],
    ['2025-06-21', -33.8688, 151.2093, 'Australia/Sydney', 420.0265, 716.9281, 1013.8293],
    ['2025-03-20', -0.1807, -78.4678, 'America/Guayaquil', 377.913, 741.1647, 1104.4137], // Quito
  ];

  it('matches astronomy-engine sunrise, transit and sunset', () => {
    for (const [date, lat, lon, tz, rise, transit, set] of refs) {
      const st = sunTimes(date, lat, lon, tz);
      expect(st.polar).toBeNull();
      expect(Math.abs(st.sunrise! - rise)).toBeLessThan(RISE_SET_TOL);
      expect(Math.abs(st.solarNoon - transit)).toBeLessThan(EOT_TOL);
      expect(Math.abs(st.sunset! - set)).toBeLessThan(RISE_SET_TOL);
    }
  });

  it('reports DST-switch days in the clock time valid at each event', () => {
    // astronomy-engine 2.1.19: geocentric apparent sun center crossing −0.833° (bisection to 0.1 s) and
    // SearchHourAngle(ha 0); UTC → local clock via Intl. Covers 30 min DST (Lord Howe), :45 offsets (Chatham)
    // and a gap at midnight (Santiago 09-07 starts at 01:00). Worst |Δ| over all of 2025 at these sites: 4.0 s.
    const dst: [string, number, number, string, number, number, number][] = [
      ['2025-03-30', 47.3769, 8.5417, 'Europe/Zurich', 428.5012, 810.2009, 1192.8059],
      ['2025-10-26', 47.3769, 8.5417, 'Europe/Zurich', 420.5682, 729.7875, 1038.328],
      ['2025-04-06', -33.4489, -70.6693, 'America/Santiago', 418.6169, 764.9425, 1110.7839],
      ['2025-09-07', -33.4489, -70.6693, 'America/Santiago', 472.2156, 820.5549, 1169.3787],
      ['2025-04-06', -31.5553, 159.0821, 'Australia/Lord_Howe', 368.035, 716.1175, 1063.7469],
      ['2025-10-05', -31.5553, 159.0821, 'Australia/Lord_Howe', 356.8033, 732.1525, 1108.0006],
      ['2025-04-06', -43.9535, -176.5597, 'Pacific/Chatham', 413.8187, 753.7039, 1092.8919],
      ['2025-09-28', -43.9535, -176.5597, 'Pacific/Chatham', 429.9832, 801.9876, 1174.7713],
    ];
    for (const [date, lat, lon, tz, rise, transit, set] of dst) {
      const st = sunTimes(date, lat, lon, tz);
      expect(Math.abs(st.sunrise! - rise)).toBeLessThan(RISE_SET_TOL);
      expect(Math.abs(st.solarNoon - transit)).toBeLessThan(EOT_TOL);
      expect(Math.abs(st.sunset! - set)).toBeLessThan(RISE_SET_TOL);
    }
  });

  it('puts the sun at −0.833° geometric altitude at sunrise/sunset', () => {
    const st = sunTimes('2025-06-21', 46.948, 7.447, 'Europe/Zurich');
    for (const m of [st.sunrise!, st.sunset!]) {
      const s = sunPosition(localToUtc('2025-06-21', m, 'Europe/Zurich'), 46.948, 7.447, { refraction: false });
      expect(s.altitude).toBeCloseTo(SUNRISE_ALTITUDE, 3); // 0.5 s bisection ≈ 0.001°
    }
  });

  it('flags polar day and polar night (Tromsø 69.65 N, McMurdo 77.85 S)', () => {
    // astronomy-engine finds no sunrise/sunset within 24 h of local midnight on these dates.
    expect(sunTimes('2025-06-21', 69.65, 18.96, 'Europe/Oslo')).toMatchObject({ sunrise: null, sunset: null, polar: 'day' });
    expect(sunTimes('2025-12-21', 69.65, 18.96, 'Europe/Oslo')).toMatchObject({ sunrise: null, sunset: null, polar: 'night' });
    expect(sunTimes('2025-12-21', -77.85, 166.67, 'Antarctica/McMurdo')).toMatchObject({ polar: 'day' });
    expect(sunTimes('2025-06-21', -77.85, 166.67, 'Antarctica/McMurdo')).toMatchObject({ polar: 'night' });
    // Solar noon is always defined (astronomy-engine transit: 766.0058 min).
    expect(Math.abs(sunTimes('2025-06-21', 69.65, 18.96, 'Europe/Oslo').solarNoon - 766.0058)).toBeLessThan(EOT_TOL);
  });

  it('handles transition days with a single event (Tromsø)', () => {
    // Grazing sun at 70° N: 0.02° position error ↔ up to ~1 min; observed 0.57 / 0.83 min → tolerance 2 min.
    // 2025-05-17: rises 01:13 (astronomy-engine 73.3619 min), then stays up.
    const may = sunTimes('2025-05-17', 69.65, 18.96, 'Europe/Oslo');
    expect(may.polar).toBeNull();
    expect(may.sunset).toBeNull();
    expect(Math.abs(may.sunrise! - 73.3619)).toBeLessThan(2);
    // 2025-07-25: up since the previous day, sets 00:29 after local midnight (astronomy-engine 1468.5238 min).
    const jul = sunTimes('2025-07-25', 69.65, 18.96, 'Europe/Oslo');
    expect(jul.polar).toBeNull();
    expect(jul.sunrise).toBeNull();
    expect(Math.abs(jul.sunset! - 1468.5238)).toBeLessThan(2);
  });

  it('never returns NaN near the poles', () => {
    for (const lat of [-90, -89.9, 89.9, 90]) {
      for (const date of ['2025-03-20', '2025-06-21', '2025-09-23', '2025-12-21']) {
        const st = sunTimes(date, lat, 0, 'UTC');
        expect(Number.isFinite(st.solarNoon)).toBe(true);
        for (const v of [st.sunrise, st.sunset]) if (v !== null) expect(Number.isFinite(v)).toBe(true);
      }
    }
    // |φ| = 89.9°: altitude ≈ ±δ ± 0.1°, so the solstices are unambiguous.
    expect(sunTimes('2025-06-21', 89.9, 0, 'UTC').polar).toBe('day');
    expect(sunTimes('2025-06-21', -89.9, 0, 'UTC').polar).toBe('night');
  });
});

describe('solarPath', () => {
  const [lat, lon, tz] = [46.948, 7.447, 'Europe/Zurich'];

  it('samples the whole local day including 24:00', () => {
    const p = solarPath('2025-06-21', lat, lon, tz);
    expect(p).toHaveLength(145);
    expect(p[0]).toMatchObject({ minutes: 0, utcMs: utc('2025-06-20T22:00:00Z') });
    expect(p[144]).toMatchObject({ minutes: 1440, utcMs: utc('2025-06-21T22:00:00Z') });
    for (const pt of p) expect(pt.sun).toEqual(sunPosition(pt.utcMs, lat, lon));
    // Highest sample is the one closest to solar noon (812.1 min → 810).
    const top = p.reduce((a, b) => (b.sun.altitude > a.sun.altitude ? b : a));
    expect(top.minutes).toBe(810);
  });

  it('skips clock times that do not exist (spring forward)', () => {
    const p = solarPath('2025-03-30', lat, lon, tz);
    expect(p).toHaveLength(139); // 02:00–02:50 missing
    expect(p.some((pt) => pt.minutes >= 120 && pt.minutes < 180)).toBe(false);
    expect(p.find((pt) => pt.minutes === 110)!.utcMs).toBe(utc('2025-03-30T00:50:00Z'));
    expect(p.find((pt) => pt.minutes === 180)!.utcMs).toBe(utc('2025-03-30T01:00:00Z'));
  });

  it('skips 24:00 when the next day starts in a DST gap (America/Santiago)', () => {
    // Chile 2025-09-07 00:00 −04 → 01:00 −03 (transition 2025-09-07T04:00Z, Python zoneinfo / tzdata 2025b):
    // 24:00 of 09-06 never shows on a clock; the instant 04:00Z reads 01:00 of 09-07. Regression: was kept as 1440.
    const p = solarPath('2025-09-06', -33.45, -70.67, 'America/Santiago');
    expect(p).toHaveLength(144);
    expect(p[143]).toMatchObject({ minutes: 1430, utcMs: utc('2025-09-07T03:50:00Z') }); // 23:50 −04
  });

  it('uses the first occurrence of repeated clock times (fall back)', () => {
    const p = solarPath('2025-10-26', lat, lon, tz);
    expect(p).toHaveLength(145);
    expect(p.find((pt) => pt.minutes === 150)!.utcMs).toBe(utc('2025-10-26T00:30:00Z'));
    expect(p.find((pt) => pt.minutes === 180)!.utcMs).toBe(utc('2025-10-26T02:00:00Z'));
  });

  it('supports other steps and rejects invalid ones', () => {
    const p = solarPath('2025-06-21', lat, lon, tz, 7);
    expect(p).toHaveLength(206); // 0, 7, …, 1435
    expect(p[205].minutes).toBe(1435);
    expect(() => solarPath('2025-06-21', lat, lon, tz, 0)).toThrow(RangeError);
    expect(() => solarPath('2025-06-21', lat, lon, tz, NaN)).toThrow(RangeError);
  });
});
