import type { Config, SolarPosition, PanelGeometry } from '../types';

// ─────────────────────────────────────────────
// PURE UTILITY FUNCTIONS
// ─────────────────────────────────────────────

export const toRad = (deg: number): number => (deg * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export function getDayOfYear(m: number, d: number): number {
  const t = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return t[m - 1] + d;
}

export function getPanelGeometry(tilt: number, cfg: Config): PanelGeometry {
  const pH = cfg.panelLength * Math.sin(toRad(tilt));
  const pD = cfg.panelLength * Math.cos(toRad(tilt));
  const vGap = cfg.balconyHeight - pH;
  const crit = toDeg(Math.atan(vGap / pD));
  return { panelH: pH, panelD: pD, verticalGap: vGap, criticalAngle: crit };
}

export function getSolarPosition(dayOfYear: number, hour: number, cfg: Config): SolarPosition {
  const decl = 23.45 * Math.sin(toRad((360 / 365) * (dayOfYear - 81)));
  const latR = toRad(cfg.latitude);
  const declR = toRad(decl);
  const hAngle = (hour - 12) * 15;
  const hRad = toRad(hAngle);
  const sinAlt =
    Math.sin(latR) * Math.sin(declR) +
    Math.cos(latR) * Math.cos(declR) * Math.cos(hRad);
  const alt = toDeg(Math.asin(sinAlt));
  const cosAz =
    (Math.sin(declR) - Math.sin(latR) * sinAlt) /
    (Math.cos(latR) * Math.cos(toRad(alt)));
  let az = toDeg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
  if (hAngle > 0) az = 360 - az;
  return { altitude: alt, azimuth: az };
}

export function getProfileAngle(alt: number, az: number, cfg: Config): number | null {
  const diff = toRad(az - cfg.facadeAzimuth);
  const cosDiff = Math.cos(diff);
  if (cosDiff <= 0) return null;
  return toDeg(Math.atan(Math.tan(toRad(alt)) / cosDiff));
}

export function getRelativeYield(tilt: number, cfg: Config): number {
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    const doy = getDayOfYear(m, 15);
    for (let h = 5; h <= 21; h += 0.25) {
      const sol = getSolarPosition(doy, h, cfg);
      if (sol.altitude <= 2) continue;
      const cosInc =
        Math.sin(toRad(sol.altitude)) * Math.cos(toRad(tilt)) +
        Math.cos(toRad(sol.altitude)) *
          Math.sin(toRad(tilt)) *
          Math.cos(toRad(sol.azimuth - cfg.facadeAzimuth));
      if (cosInc > 0) total += cosInc * 0.25;
    }
  }
  return total;
}
