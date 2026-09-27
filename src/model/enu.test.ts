import { describe, expect, it } from 'vitest';
import type { Obstacle } from './types';
import { enuToFacade, enuToLonLat, facadeToEnu, facadeTransform, lonLatToEnu, wgs84Radii } from './enu';
import { horizonAt, obstacleHorizon } from './horizon';
import { wgs84ToLv95 } from './lv95';
import { sunInFacade } from './geometry';
import { toDeg } from './units';

const KRAMGASSE = { latitude: 46.947849, longitude: 7.449978 };

describe('wgs84Radii', () => {
  it('meridian and prime-vertical radii (research values at 46.94°: M 6 369 553 m, N 6 389 564 m)', () => {
    const r = wgs84Radii(46.94);
    expect(r.meridian).toBeCloseTo(6369553, -1);
    expect(r.primeVertical).toBeCloseTo(6389564, -1);
    // Equator and pole: M = a(1 − e²), N = a; at the pole M = N = a² / b.
    expect(wgs84Radii(0).primeVertical).toBeCloseTo(6378137, 3);
    expect(wgs84Radii(0).meridian).toBeCloseTo(6335439.327, 2);
    expect(wgs84Radii(90).meridian).toBeCloseTo(wgs84Radii(90).primeVertical, 3);
  });
});

describe('lonLatToEnu / enuToLonLat', () => {
  it('east and north distances agree with LV95 (conformal, scale ≈ 1 near Bern) within 3 cm at 300 m', () => {
    const o = wgs84ToLv95(KRAMGASSE.latitude, KRAMGASSE.longitude);
    for (const [e, n] of [
      [300, 0],
      [0, 300],
      [-212, 212],
      [150, -260],
    ] as const) {
      const g = enuToLonLat(KRAMGASSE, e, n);
      const p = wgs84ToLv95(g.latitude, g.longitude);
      const lv95Distance = Math.hypot(p.east - o.east, p.north - o.north);
      expect(Math.abs(lv95Distance - Math.hypot(e, n))).toBeLessThan(0.03);
    }
  });

  it('round-trips and wraps the antimeridian', () => {
    const [e, n] = lonLatToEnu(KRAMGASSE, 46.95, 7.46);
    const g = enuToLonLat(KRAMGASSE, e, n);
    expect(g.latitude).toBeCloseTo(46.95, 12);
    expect(g.longitude).toBeCloseTo(7.46, 12);
    const anchor = { latitude: 0, longitude: 179.999 };
    expect(lonLatToEnu(anchor, 0, -179.999)[0]).toBeCloseTo(222.64, 1);
  });

  it('1e-6° of latitude is about 0.11 m, of longitude 0.076 m at 47° N', () => {
    expect(lonLatToEnu(KRAMGASSE, KRAMGASSE.latitude + 1e-6, KRAMGASSE.longitude)[1]).toBeCloseTo(0.111, 3);
    expect(lonLatToEnu(KRAMGASSE, KRAMGASSE.latitude, KRAMGASSE.longitude + 1e-6)[0]).toBeCloseTo(0.076, 3);
  });
});

describe('facade frame', () => {
  it('n = outward normal, u = right when looking at the facade from outside', () => {
    // South facade (γ = 180°): 10 m south is n = 10; east is to the right of a viewer looking north: u > 0.
    expect(enuToFacade([0, -10], 180)[1]).toBeCloseTo(10, 12);
    expect(enuToFacade([5, 0], 180)[0]).toBeCloseTo(5, 12);
    // East facade (γ = 90°): east is n; north is to the right of a viewer looking west.
    expect(enuToFacade([10, 0], 90)).toEqual([expect.closeTo(0, 12), expect.closeTo(10, 12)]);
    expect(enuToFacade([0, 5], 90)[0]).toBeCloseTo(5, 12);
    for (const g of [0, 37, 153.4, 202, 359]) {
      const q = enuToFacade([12.3, -4.5], g);
      const p = facadeToEnu(q, g);
      expect(p[0]).toBeCloseTo(12.3, 12);
      expect(p[1]).toBeCloseTo(-4.5, 12);
    }
  });

  it('matches the sun-in-facade convention (geometry.ts sunInFacade)', () => {
    for (const g of [0, 90, 153.4, 202, 300]) {
      for (const azimuth of [10, 100, 190, 250]) {
        const a = (azimuth * Math.PI) / 180;
        const [u, n] = enuToFacade([Math.sin(a), Math.cos(a)], g);
        const s = sunInFacade({ altitude: 0, azimuth }, g);
        expect(u).toBeCloseTo(s.u, 9);
        expect(n).toBeCloseTo(s.n, 9);
      }
    }
  });

  it('matches horizon.ts obstacleHorizon: a box converted to ENU peaks in its true direction', () => {
    const facadeAzimuth = 153.4;
    const box: Obstacle = {
      id: 'o',
      name: '',
      offsetAlong: 12,
      distance: 25,
      width: 1,
      depth: 1,
      height: 40,
    };
    const profile = obstacleHorizon([box], { u: 0, n: 0, z: 0 }, facadeAzimuth, 0.5);
    // Box centre in ENU → true azimuth; the horizon must peak there (about atan(40 / 28)).
    const [e, n] = facadeToEnu([box.offsetAlong, box.distance + box.depth / 2], facadeAzimuth);
    const az = (toDeg(Math.atan2(e, n)) + 360) % 360;
    const peak = profile.elevations.indexOf(Math.max(...profile.elevations)) * profile.stepDeg;
    expect(Math.abs(((peak - az + 540) % 360) - 180)).toBeLessThan(1.5);
    expect(horizonAt(profile, az)).toBeGreaterThan(50);
    // … and nothing on the mirrored side (u → −u).
    const [me, mn] = facadeToEnu([-box.offsetAlong, box.distance], facadeAzimuth);
    expect(horizonAt(profile, (toDeg(Math.atan2(me, mn)) + 360) % 360)).toBe(0);
  });

  it('facadeTransform: anchor ENU ↔ facade frame at the location', () => {
    const anchor = KRAMGASSE;
    const [le, ln] = [8.5, -14.1];
    const location = enuToLonLat(anchor, le, ln);
    const t = facadeTransform(anchor, location, 0);
    expect(t.origin[0]).toBeCloseTo(le, 9);
    expect(t.origin[1]).toBeCloseTo(ln, 9);
    // The location is the facade origin. North facade (γ = 0): 3 m north is n = 3; a viewer outside looks
    // south, so east is on the left (u < 0).
    expect(t.toFacade([le, ln])).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9)]);
    expect(t.toFacade([le, ln + 3])).toEqual([expect.closeTo(0, 9), expect.closeTo(3, 9)]);
    expect(t.toFacade([le + 2, ln])[0]).toBeCloseTo(-2, 9);
    const q = t.toFacade([40, 25]);
    const p = t.toAnchor(q);
    expect(p[0]).toBeCloseTo(40, 9);
    expect(p[1]).toBeCloseTo(25, 9);
  });
});
