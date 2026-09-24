import type { FacadeVector, HorizonProfile, IrradianceSample, PanelLayout } from './types';
import { DEG } from './units';
import { horizonAt } from './horizon';

// ─────────────────────────────────────────────
// IRRADIANCE
// Clear sky (Meinel), incidence angle modifier (ASHRAE), plane-of-array (POA) irradiance and
// the isotropic sky view factor of a panel row in front of a facade, below an identical row.
// Irradiance in W/m², angles in degrees (API) / radians (formulas).
// ─────────────────────────────────────────────

/** Total solar irradiance at 1 AU, W/m² (Kopp & Lean 2011). */
export const SOLAR_CONSTANT = 1361;

/**
 * Extraterrestrial normal irradiance on day `dayOfYear` (1-based), W/m².
 * Spencer (1971) Fourier series for (r0/r)², as in Duffie & Beckman eq. 1.4.1b.
 */
export function extraterrestrialNormal(dayOfYear: number): number {
  const b = (2 * Math.PI * (dayOfYear - 1)) / 365;
  return (
    SOLAR_CONSTANT *
    (1.00011 +
      0.034221 * Math.cos(b) +
      0.00128 * Math.sin(b) +
      0.000719 * Math.cos(2 * b) +
      0.000077 * Math.sin(2 * b))
  );
}

/**
 * Relative optical air mass (Kasten & Young 1989) for the apparent sun altitude, degrees:
 * AM = 1 / (sin h + 0.50572·(h + 6.07995)^−1.6364). 1 at the zenith, ≈ 38 at h = 0; Infinity below the horizon.
 */
export function airMass(altitudeDeg: number): number {
  if (!(altitudeDeg >= 0)) return Infinity;
  const h = Math.min(90, altitudeDeg);
  return 1 / (Math.sin(h * DEG) + 0.50572 * (h + 6.07995) ** -1.6364);
}

/**
 * Clear-sky irradiance for an apparent sun altitude (degrees) on day `dayOfYear`.
 * Meinel & Meinel (1976): DNI = E0·0.7^(AM^0.678) with E0 = extraterrestrialNormal; DHI = 0.1·DNI;
 * GHI = DNI·sin h + DHI. Zero at night (altitude ≤ 0). An upper bound, not a typical sky.
 */
export function clearSkyIrradiance(altitudeDeg: number, dayOfYear: number): IrradianceSample {
  if (!(altitudeDeg > 0)) return { ghi: 0, dni: 0, dhi: 0 };
  const dni = extraterrestrialNormal(dayOfYear) * 0.7 ** (airMass(altitudeDeg) ** 0.678);
  const dhi = 0.1 * dni;
  return { ghi: dni * Math.sin(Math.min(90, altitudeDeg) * DEG) + dhi, dni, dhi };
}

/**
 * Incidence angle modifier for beam light, ASHRAE model: IAM = 1 − b0·(1/cos θi − 1), clamped to [0, 1].
 * 0 for grazing or back-side incidence (cos θi ≤ 0).
 */
export function iamAshrae(cosIncidence: number, b0 = 0.05): number {
  if (!(cosIncidence > 0)) return 0;
  const iam = 1 - b0 * (1 / cosIncidence - 1);
  return iam < 0 ? 0 : iam > 1 ? 1 : iam;
}

/** Plane-of-array irradiance components, W/m². */
export interface PoaIrradiance {
  beam: number;
  diffuse: number;
  ground: number;
  total: number;
}

/** Ground view factor of a plane tilted β from horizontal, (1 − cos β)/2, from the panel normal's z component. */
export function groundViewFactor(layout: PanelLayout): number {
  return (1 - layout.normal.z) / 2;
}

/**
 * POA irradiance of a panel with sun direction `sf` (facade frame):
 * beam = DNI·max(0, cosInc)·IAM·beamFactor (0 if the sun is behind the facade, s_n ≤ 0, or below the
 * horizontal); diffuse = DHI·skyViewFactor (isotropic); ground = GHI·albedo·(1 − cos β)/2.
 * `beamFactor` (0…1) carries horizon blocking and shading by the row above.
 */
export function poaIrradiance(
  sample: IrradianceSample,
  sf: FacadeVector,
  layout: PanelLayout,
  p: { beamFactor: number; skyViewFactor: number; albedo: number },
): PoaIrradiance {
  const ci = sf.u * layout.normal.u + sf.n * layout.normal.n + sf.z * layout.normal.z;
  const beam = sf.n > 0 && sf.z > 0 && ci > 0 ? sample.dni * ci * iamAshrae(ci) * p.beamFactor : 0;
  const diffuse = sample.dhi * p.skyViewFactor;
  const ground = sample.ghi * p.albedo * groundViewFactor(layout);
  return { beam, diffuse, ground, total: beam + diffuse + ground };
}

// ── Sky view factor ──────────────────────────

/** Below this sin θ a panel counts as vertical (coplanar rows, no blocking) — as in geometry.ts. */
const VERTICAL_SIN_EPS = 1e-9;

/**
 * Area fraction (0…1) of a row from which the ray in direction `d` (facade frame, unit) hits the identical
 * row one floor above. Same translation as shadeFromAbove (ray (u, v) → (u + du, v + dv) on the upper
 * plane), without allocations, and valid for any d with d·N > 0 (also d_n ≤ 0). Equals
 * shadeFromAbove(d, layout).fraction for d in front of the facade and above the horizontal.
 */
export function rowAboveBlockedFraction(d: FacadeVector, layout: PanelLayout): number {
  const N = layout.normal;
  const ci = d.u * N.u + d.n * N.n + d.z * N.z;
  const L = layout.length;
  const w = layout.moduleWidth;
  const mods = layout.modules;
  const count = mods.length;
  if (!(ci > 0) || N.z < VERTICAL_SIN_EPS || count === 0 || !(w > 0) || !(L > 0)) return 0;
  const H = layout.floorHeight;
  const du = (H * N.z * d.u) / ci;
  const dv = (H * d.n) / ci;
  // v-band = [0, L] ∩ ([0, L] − dv)
  const band = Math.min(L, L - dv) - Math.max(0, -dv);
  if (band <= 0 || Math.abs(du) >= layout.rowWidth) return 0;
  let covered = 0;
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < count; j++) {
      const o = Math.min(mods[i].u1, mods[j].u1 - du) - Math.max(mods[i].u0, mods[j].u0 - du);
      if (o > 0) covered += o;
    }
  }
  return Math.min(1, (covered / (count * w)) * (band / L));
}

/** Options of the sky view factor integration. */
export interface SkyViewOptions {
  /** Angular grid step in altitude and azimuth, degrees. Default 1 (error < 1e-3 absolute). */
  gridDeg?: number;
  /**
   * The facade wall blocks every direction behind its plane (d_n ≤ 0), treated as an infinitely high wall.
   * Default true; false = free-standing panel (reference / validation only).
   */
  facade?: boolean;
}

/**
 * Precomputed cell weights of the sky view integral for one panel layout; reusable for many horizons.
 * Cells are a regular grid in apparent altitude a ∈ [0°, 90°] and azimuth relative to the facade normal φ.
 */
export interface SkyViewGrid {
  /** Effective grid step, degrees (90 / nAlt). */
  stepDeg: number;
  nPhi: number;
  nAlt: number;
  /** Relative azimuth of the first column's left edge, degrees (−90 with facade, −180 without). */
  phiStartDeg: number;
  /** Altitude of every cell edge, degrees (nAlt + 1). */
  altEdges: Float64Array;
  /** sin of every altitude edge (nAlt + 1). */
  sinEdges: Float64Array;
  /** (1/π)∫ max(0, d·N) dΩ per cell, index col·nAlt + row. Sums to the unobstructed view factor. */
  open: Float64Array;
  /** Same with the part blocked by the row above removed (blocked fraction at the cell centre). */
  belowRow: Float64Array;
}

/** Sub-samples per axis for cells straddling the panel plane (d·N changes sign, only without facade). */
const KINK_SUBDIV = 8;

/**
 * The layout-independent part of a sky grid: cell edge angles, their sines and cosines, the kernel
 * integrals and the sub-sample directions. Every tilt step rebuilds the grid (createFloorModel), so these
 * ≈ 0.5 million trigonometric calls are computed once per grid shape instead (the values are identical).
 */
interface SkyGridTables {
  nAlt: number;
  nPhi: number;
  step: number;
  phiStart: number;
  altEdges: Float64Array;
  sinEdges: Float64Array;
  /** Per altitude edge r (nAlt + 1): a = altEdges[r]·DEG, cos a, sin a. */
  cosA: Float64Array;
  sinA: Float64Array;
  /** Per row (nAlt): ∫cos²a da, ∫sin a·cos a da, cos/sin of the mid altitude, sub-sample step. */
  ic: Float64Array;
  is: Float64Array;
  cosAm: Float64Array;
  sinAm: Float64Array;
  ha: Float64Array;
  /** Per row × KINK_SUBDIV: cos/sin of the sub-sample altitudes. */
  subCosA: Float64Array;
  subSinA: Float64Array;
  /** Per column (nPhi): cos/sin of the left (0) and right (1) edge, sin φ1 − sin φ0, φ1 − φ0, mid φ, sub step. */
  cosF0: Float64Array;
  sinF0: Float64Array;
  cosF1: Float64Array;
  sinF1: Float64Array;
  dSinF: Float64Array;
  dF: Float64Array;
  cosFm: Float64Array;
  sinFm: Float64Array;
  hf: Float64Array;
  /** Per column × KINK_SUBDIV: cos/sin of the sub-sample azimuths. */
  subCosF: Float64Array;
  subSinF: Float64Array;
}

const skyGridTables = new Map<string, SkyGridTables>();

function gridTables(nAlt: number, nPhi: number, step: number, phiStart: number): SkyGridTables {
  const key = `${nAlt},${nPhi},${step},${phiStart}`;
  const hit = skyGridTables.get(key);
  if (hit) return hit;
  const f = (n: number): Float64Array => new Float64Array(n);
  const t: SkyGridTables = {
    nAlt,
    nPhi,
    step,
    phiStart,
    altEdges: f(nAlt + 1),
    sinEdges: f(nAlt + 1),
    cosA: f(nAlt + 1),
    sinA: f(nAlt + 1),
    ic: f(nAlt),
    is: f(nAlt),
    cosAm: f(nAlt),
    sinAm: f(nAlt),
    ha: f(nAlt),
    subCosA: f(nAlt * KINK_SUBDIV),
    subSinA: f(nAlt * KINK_SUBDIV),
    cosF0: f(nPhi),
    sinF0: f(nPhi),
    cosF1: f(nPhi),
    sinF1: f(nPhi),
    dSinF: f(nPhi),
    dF: f(nPhi),
    cosFm: f(nPhi),
    sinFm: f(nPhi),
    hf: f(nPhi),
    subCosF: f(nPhi * KINK_SUBDIV),
    subSinF: f(nPhi * KINK_SUBDIV),
  };
  for (let r = 0; r <= nAlt; r++) {
    t.altEdges[r] = r * step;
    t.sinEdges[r] = Math.sin(r * step * DEG);
    const a = t.altEdges[r] * DEG;
    t.cosA[r] = Math.cos(a);
    t.sinA[r] = Math.sin(a);
  }
  for (let r = 0; r < nAlt; r++) {
    const a0 = t.altEdges[r] * DEG;
    const a1 = t.altEdges[r + 1] * DEG;
    const am = (a0 + a1) / 2;
    t.ic[r] = (a1 - a0) / 2 + (Math.sin(2 * a1) - Math.sin(2 * a0)) / 4; // ∫cos²a da
    t.is[r] = (Math.sin(a1) ** 2 - Math.sin(a0) ** 2) / 2; // ∫sin a·cos a da
    t.cosAm[r] = Math.cos(am);
    t.sinAm[r] = Math.sin(am);
    const ha = (a1 - a0) / KINK_SUBDIV;
    t.ha[r] = ha;
    for (let i = 0; i < KINK_SUBDIV; i++) {
      const a = a0 + (i + 0.5) * ha;
      t.subCosA[r * KINK_SUBDIV + i] = Math.cos(a);
      t.subSinA[r * KINK_SUBDIV + i] = Math.sin(a);
    }
  }
  for (let c = 0; c < nPhi; c++) {
    const f0 = (phiStart + c * step) * DEG;
    const f1 = f0 + step * DEG;
    const fm = (f0 + f1) / 2;
    t.cosF0[c] = Math.cos(f0);
    t.sinF0[c] = Math.sin(f0);
    t.cosF1[c] = Math.cos(f1);
    t.sinF1[c] = Math.sin(f1);
    t.dSinF[c] = Math.sin(f1) - Math.sin(f0);
    t.dF[c] = f1 - f0;
    t.cosFm[c] = Math.cos(fm);
    t.sinFm[c] = Math.sin(fm);
    const hf = (f1 - f0) / KINK_SUBDIV;
    t.hf[c] = hf;
    for (let j = 0; j < KINK_SUBDIV; j++) {
      const fj = f0 + (j + 0.5) * hf;
      t.subCosF[c * KINK_SUBDIV + j] = Math.cos(fj);
      t.subSinF[c * KINK_SUBDIV + j] = Math.sin(fj);
    }
  }
  if (skyGridTables.size >= 4) skyGridTables.clear();
  skyGridTables.set(key, t);
  return t;
}

/**
 * Cell weights of F = (1/π)∫ max(0, d·N)·V(d) dΩ over the sky (a > 0) for `layout`. Cells fully in front
 * of the panel use the exact integral of the cosine kernel, cells crossing the panel plane are sub-sampled.
 * Direction (a, φ) in the facade frame: d_n = cos a·cos φ, d_u = −cos a·sin φ, d_z = sin a (as sunInFacade).
 */
export function skyViewGrid(layout: PanelLayout, opts: SkyViewOptions = {}): SkyViewGrid {
  const g = opts.gridDeg ?? 1;
  if (!(g > 0) || !Number.isFinite(g) || g > 45) throw new RangeError(`Invalid sky grid step: ${g}`);
  const facade = opts.facade ?? true;
  const nAlt = Math.max(2, Math.round(90 / g));
  const step = 90 / nAlt;
  const span = facade ? 180 : 360;
  const nPhi = Math.round(span / step);
  const phiStart = -span / 2;
  const Nn = layout.normal.n;
  const Nz = layout.normal.z;
  const Nu = layout.normal.u;
  const t = gridTables(nAlt, nPhi, step, phiStart);
  const { cosA, sinA, subCosA, subSinA, subCosF, subSinF } = t;

  const open = new Float64Array(nPhi * nAlt);
  const belowRow = new Float64Array(nPhi * nAlt);
  // d·N of the direction (a, φ) from its cosines and sines.
  const dN = (ca: number, sa: number, cf: number, sf: number): number =>
    -ca * sf * Nu + ca * cf * Nn + sa * Nz;
  const d: FacadeVector = { u: 0, n: 0, z: 0 };

  for (let c = 0; c < nPhi; c++) {
    const cf0 = t.cosF0[c];
    const sf0 = t.sinF0[c];
    const cf1 = t.cosF1[c];
    const sf1 = t.sinF1[c];
    for (let r = 0; r < nAlt; r++) {
      const k00 = dN(cosA[r], sinA[r], cf0, sf0);
      const k01 = dN(cosA[r], sinA[r], cf1, sf1);
      const k10 = dN(cosA[r + 1], sinA[r + 1], cf0, sf0);
      const k11 = dN(cosA[r + 1], sinA[r + 1], cf1, sf1);
      let w: number;
      if (Math.min(k00, k01, k10, k11) >= 0 && Nu === 0) {
        // ∫∫ (cos a·cos φ·N_n + sin a·N_z)·cos a da dφ over the cell, exact.
        w = Nn * t.dSinF[c] * t.ic[r] + Nz * t.dF[c] * t.is[r];
      } else if (Math.max(k00, k01, k10, k11) <= 0) {
        w = 0;
      } else {
        // Straddles the panel plane: midpoint rule on a KINK_SUBDIV² sub-grid.
        const ha = t.ha[r];
        const hf = t.hf[c];
        w = 0;
        for (let i = 0; i < KINK_SUBDIV; i++) {
          const ca = subCosA[r * KINK_SUBDIV + i];
          const sa = subSinA[r * KINK_SUBDIV + i];
          for (let j = 0; j < KINK_SUBDIV; j++) {
            const k = c * KINK_SUBDIV + j;
            w += Math.max(0, dN(ca, sa, subCosF[k], subSinF[k])) * ca * ha * hf;
          }
        }
      }
      w /= Math.PI;
      const idx = c * nAlt + r;
      open[idx] = w;
      if (w > 0) {
        const ca = t.cosAm[r];
        d.u = -ca * t.sinFm[c];
        d.n = ca * t.cosFm[c];
        d.z = t.sinAm[r];
        belowRow[idx] = w * (1 - rowAboveBlockedFraction(d, layout));
      }
    }
  }
  return {
    stepDeg: step,
    nPhi,
    nAlt,
    phiStartDeg: phiStart,
    altEdges: t.altEdges,
    sinEdges: t.sinEdges,
    open,
    belowRow,
  };
}

/**
 * Sky view factor from a precomputed grid for one horizon (null = flat) and facade azimuth.
 * The horizon (world azimuth = facade azimuth + φ) is sampled at each column centre; a cell cut by the
 * horizon counts with its visible solid-angle share. Negative horizon elevations count as 0°.
 */
export function skyViewFromGrid(
  grid: SkyViewGrid,
  horizon: HorizonProfile | null,
  facadeAzimuth: number,
  hasFloorAbove: boolean,
): number {
  const w = hasFloorAbove ? grid.belowRow : grid.open;
  const { nPhi, nAlt, altEdges, sinEdges, stepDeg } = grid;
  let sum = 0;
  for (let c = 0; c < nPhi; c++) {
    const hz = horizon ? horizonAt(horizon, facadeAzimuth + grid.phiStartDeg + (c + 0.5) * stepDeg) : 0;
    const base = c * nAlt;
    for (let r = 0; r < nAlt; r++) {
      const wc = w[base + r];
      if (wc === 0 || hz >= altEdges[r + 1]) continue;
      if (hz <= altEdges[r]) sum += wc;
      else sum += (wc * (sinEdges[r + 1] - Math.sin(hz * DEG))) / (sinEdges[r + 1] - sinEdges[r]);
    }
  }
  return sum;
}

/**
 * Isotropic sky view factor of a panel row, relative to the horizontal sky (diffuse on the panel = DHI·F):
 * F = (1/π)∫ max(0, d·N) dΩ over sky directions (altitude > 0) that are above the horizon (world azimuth),
 * in front of the facade (d_n > 0) and — with `hasFloorAbove` — not blocked by the identical row one floor
 * above (area average over the row). Unobstructed free-standing plane: (1 + cos β)/2.
 * `facadeAzimuth` orients the horizon profile; `horizon` null = flat.
 */
export function skyViewFactor(
  layout: PanelLayout,
  horizon: HorizonProfile | null,
  facadeAzimuth: number,
  hasFloorAbove: boolean,
  opts?: SkyViewOptions,
): number {
  return skyViewFromGrid(skyViewGrid(layout, opts), horizon, facadeAzimuth, hasFloorAbove);
}
