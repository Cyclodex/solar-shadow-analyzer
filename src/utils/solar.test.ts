import { describe, it, expect } from 'vitest';
import {
  toRad,
  toDeg,
  getDayOfYear,
  getPanelGeometry,
  getSolarPosition,
  getProfileAngle,
  getRelativeYield,
} from './solar';
import { DEFAULT_CONFIG } from '../constants';

describe('toRad / toDeg', () => {
  it('converts 180 degrees to PI', () => {
    expect(toRad(180)).toBeCloseTo(Math.PI, 10);
  });

  it('converts 0 to 0', () => {
    expect(toRad(0)).toBe(0);
    expect(toDeg(0)).toBe(0);
  });

  it('round-trips correctly', () => {
    expect(toDeg(toRad(45))).toBeCloseTo(45, 10);
    expect(toDeg(toRad(90))).toBeCloseTo(90, 10);
  });
});

describe('getDayOfYear', () => {
  it('January 1st is day 1', () => {
    expect(getDayOfYear(1, 1)).toBe(1);
  });

  it('March 1st is day 60', () => {
    expect(getDayOfYear(3, 1)).toBe(60);
  });

  it('June 21st is day 172', () => {
    expect(getDayOfYear(6, 21)).toBe(172);
  });

  it('December 21st is day 355', () => {
    expect(getDayOfYear(12, 21)).toBe(355);
  });
});

describe('getPanelGeometry', () => {
  it('returns correct values for 45° tilt', () => {
    const geo = getPanelGeometry(45, DEFAULT_CONFIG);
    const expected = DEFAULT_CONFIG.panelLength * Math.sin(toRad(45));
    expect(geo.panelH).toBeCloseTo(expected, 5);
    expect(geo.panelD).toBeCloseTo(expected, 5); // same for 45°
  });

  it('panelH + verticalGap equals balconyHeight', () => {
    const geo = getPanelGeometry(45, DEFAULT_CONFIG);
    expect(geo.verticalGap).toBeCloseTo(DEFAULT_CONFIG.balconyHeight - geo.panelH, 10);
  });

  it('criticalAngle is positive for typical config', () => {
    const geo = getPanelGeometry(45, DEFAULT_CONFIG);
    expect(geo.criticalAngle).toBeGreaterThan(0);
  });

  it('returns 90° tilt (fully horizontal) geometry', () => {
    const geo = getPanelGeometry(90, DEFAULT_CONFIG);
    expect(geo.panelH).toBeCloseTo(DEFAULT_CONFIG.panelLength, 5);
    expect(geo.panelD).toBeCloseTo(0, 5);
  });

  it('returns 0° tilt (fully vertical) geometry', () => {
    const geo = getPanelGeometry(0, DEFAULT_CONFIG);
    expect(geo.panelH).toBeCloseTo(0, 5);
    expect(geo.panelD).toBeCloseTo(DEFAULT_CONFIG.panelLength, 5);
  });
});

describe('getSolarPosition', () => {
  it('sun is below horizon at midnight', () => {
    const pos = getSolarPosition(172, 0, DEFAULT_CONFIG);
    expect(pos.altitude).toBeLessThan(0);
  });

  it('sun has positive altitude at noon in summer', () => {
    const pos = getSolarPosition(172, 12, DEFAULT_CONFIG);
    expect(pos.altitude).toBeGreaterThan(0);
  });

  it('sun altitude at summer solstice noon is around 66° at latitude 47.1°', () => {
    const pos = getSolarPosition(172, 12, DEFAULT_CONFIG);
    // Max sun altitude = 90 - lat + decl = 90 - 47.1 + 23.45 ≈ 66.35°
    expect(pos.altitude).toBeGreaterThan(60);
    expect(pos.altitude).toBeLessThan(75);
  });

  it('sun is due south (180°) at noon', () => {
    const pos = getSolarPosition(172, 12, DEFAULT_CONFIG);
    expect(pos.azimuth).toBeCloseTo(180, 0);
  });

  it('sun is in the east (< 180°) in the morning', () => {
    const pos = getSolarPosition(172, 8, DEFAULT_CONFIG);
    expect(pos.altitude).toBeGreaterThan(0);
    expect(pos.azimuth).toBeLessThan(180);
  });

  it('sun is in the west (> 180°) in the afternoon', () => {
    const pos = getSolarPosition(172, 16, DEFAULT_CONFIG);
    expect(pos.altitude).toBeGreaterThan(0);
    expect(pos.azimuth).toBeGreaterThan(180);
  });
});

describe('getProfileAngle', () => {
  it('returns null when sun is behind the facade', () => {
    // Sun at azimuth 22° (i.e., behind facade at 202°)
    const angle = getProfileAngle(30, 22, DEFAULT_CONFIG);
    expect(angle).toBeNull();
  });

  it('returns positive value when sun is facing the facade', () => {
    // Facade at 202°, sun at 202° (directly facing)
    const angle = getProfileAngle(30, DEFAULT_CONFIG.facadeAzimuth, DEFAULT_CONFIG);
    expect(angle).not.toBeNull();
    expect(angle!).toBeGreaterThan(0);
  });

  it('profile angle equals altitude when sun is exactly on facade normal', () => {
    const alt = 30;
    const angle = getProfileAngle(alt, DEFAULT_CONFIG.facadeAzimuth, DEFAULT_CONFIG);
    expect(angle).toBeCloseTo(alt, 5);
  });

  it('profile angle increases when sun moves away from facade normal (within valid range)', () => {
    // Profile angle = atan(tan(alt) / cos(diff)); cos(diff)<1 → larger profile angle
    const altDirect = getProfileAngle(30, DEFAULT_CONFIG.facadeAzimuth, DEFAULT_CONFIG)!;
    const altOffset = getProfileAngle(30, DEFAULT_CONFIG.facadeAzimuth + 45, DEFAULT_CONFIG)!;
    expect(altOffset).toBeGreaterThan(altDirect);
  });
});

describe('getRelativeYield', () => {
  it('returns a positive number for any tilt', () => {
    expect(getRelativeYield(45, DEFAULT_CONFIG)).toBeGreaterThan(0);
  });

  it('returns more yield for moderate tilts vs. fully vertical (0°)', () => {
    const yield45 = getRelativeYield(45, DEFAULT_CONFIG);
    const yield0 = getRelativeYield(0, DEFAULT_CONFIG);
    expect(yield45).toBeGreaterThan(yield0);
  });

  it('is symmetric-ish around optimal tilt range (35–55°)', () => {
    const y35 = getRelativeYield(35, DEFAULT_CONFIG);
    const y55 = getRelativeYield(55, DEFAULT_CONFIG);
    const y45 = getRelativeYield(45, DEFAULT_CONFIG);
    expect(y45).toBeGreaterThan(y35 * 0.9);
    expect(y45).toBeGreaterThan(y55 * 0.9);
  });
});
