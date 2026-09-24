import type {
  Config,
  FacadeVector,
  FloorPlacement,
  HorizonProfile,
  InstantState,
  ModuleSpan,
  PanelLayout,
  ShadeRect,
  ShadeResult,
  SunPosition,
  SunState,
  Vec3,
} from './types';
import { cmToM, toDeg, toRad } from './units';
import { sunPosition } from './sun';
import { horizonAt } from './horizon';

// ─────────────────────────────────────────────
// FACADE GEOMETRY & PANEL-TO-PANEL SHADING
// Frames and derivation: docs/ARCHITECTURE.md ("Koordinatensysteme",
// "Geometrie des Schattenwurfs"). Lengths in m, API angles in degrees.
// Panel plane (u, v): v = distance down the slope from the top edge (railing).
// ─────────────────────────────────────────────

/** Below this sin θ a panel counts as vertical: coplanar rows cannot shade each other. */
const VERTICAL_SIN_EPS = 1e-9;
/** Shaded u-intervals shorter than this (m) are dropped; touching intervals closer than this are merged. */
const U_EPS = 1e-12;

/** Bypass-diode substrings per module, parallel to the module's long side. */
export const SUBSTRINGS_PER_MODULE = 3;
/** Square cells across the module's short side (2 cell rows per substring). */
export const CELLS_ACROSS_SHORT_SIDE = 6;

/** cos/sin of 90° are 6e-17, not 0 — snap so that flat/vertical panels get exact zeros. */
const snap = (x: number): number => (Math.abs(x) < 1e-15 ? 0 : x);

/** Unit vectors of the facade frame in ENU: outward normal `n`, `u` along the facade (+ = right seen from outside). */
export function facadeFrame(facadeAzimuth: number): { n: Vec3; u: Vec3 } {
  const g = toRad(facadeAzimuth);
  const s = Math.sin(g);
  const c = Math.cos(g);
  return { n: { x: s, y: c, z: 0 }, u: { x: -c, y: s, z: 0 } };
}

/** Expresses an ENU vector in the facade frame of a facade facing `facadeAzimuth`. */
export function toFacade(v: Vec3, facadeAzimuth: number): FacadeVector {
  const g = toRad(facadeAzimuth);
  const s = Math.sin(g);
  const c = Math.cos(g);
  return { u: -v.x * c + v.y * s, n: v.x * s + v.y * c, z: v.z };
}

/** Sun direction (from apparent altitude/azimuth) in the facade frame; equals toFacade(sunVectorEnu(sun)). */
export function sunInFacade(sun: Pick<SunPosition, 'altitude' | 'azimuth'>, facadeAzimuth: number): FacadeVector {
  const h = toRad(sun.altitude);
  const d = toRad(sun.azimuth - facadeAzimuth);
  const ch = Math.cos(h);
  // s_n = cos h·cos(A−γ), s_u = −cos h·sin(A−γ), s_z = sin h
  return { u: -ch * Math.sin(d), n: ch * Math.cos(d), z: Math.sin(h) };
}

/** Panel row geometry in meters (identical for every floor); modules side by side, row centered at u = 0. */
export function panelLayout(config: Config): PanelLayout {
  const { panels, building } = config;
  const length = cmToM(panels.length);
  const moduleWidth = cmToM(panels.width);
  const count = panels.count;
  const gap = cmToM(panels.gap);
  const rowWidth = count * moduleWidth + Math.max(0, count - 1) * gap;
  const modules: ModuleSpan[] = [];
  for (let i = 0; i < count; i++) {
    const u0 = -rowWidth / 2 + i * (moduleWidth + gap);
    modules.push({ u0, u1: u0 + moduleWidth });
  }
  const theta = panels.tiltFromVertical;
  const cosT = snap(Math.cos(toRad(theta)));
  const sinT = snap(Math.sin(toRad(theta)));
  const drop = length * cosT;
  const reach = length * sinT;
  const floorHeight = cmToM(building.floorHeight);
  const verticalGap = floorHeight - drop;
  // 2D onset: ray grazing the upper row's lower edge (reach, H − drop) and the lower row's top edge (0, 0).
  const criticalProfileAngle = reach < 1e-9 && verticalGap >= 0 ? 90 : toDeg(Math.atan2(verticalGap, reach));
  return {
    length,
    moduleWidth,
    count,
    gap,
    rowWidth,
    modules,
    tiltFromVertical: theta,
    tiltFromHorizontal: 90 - theta,
    drop,
    reach,
    floorHeight,
    verticalGap,
    criticalProfileAngle,
    // Slope direction (n, z) = (sin θ, −cos θ) → outward/upward normal (cos θ, sin θ).
    normal: { u: 0, n: cosT, z: sinT },
    moduleArea: length * moduleWidth,
  };
}

/** True if a panel reaches further down than the floor height (drop > H): rows collide / overlap → UI warning. */
export function panelsOverlap(layout: PanelLayout): boolean {
  return layout.drop > layout.floorHeight;
}

/** Placement of every floor's panel row (index 0 = lowest panel floor). Slab of storey s at s·H above ground. */
export function floorPlacements(config: Config): FloorPlacement[] {
  const b = config.building;
  const H = cmToM(b.floorHeight);
  const railH = cmToM(b.railingHeight);
  const railN = cmToM(b.balconyDepth);
  const half = cmToM(config.panels.length) / 2;
  const t = toRad(config.panels.tiltFromVertical);
  const cosT = snap(Math.cos(t));
  const sinT = snap(Math.sin(t));
  const out: FloorPlacement[] = [];
  for (let k = 0; k < b.numFloors; k++) {
    const storey = b.lowestFloor + k;
    const slabZ = storey * H;
    const railTopZ = slabZ + railH;
    out.push({
      floor: k,
      storey,
      slabZ,
      railTopZ,
      railN,
      center: { u: 0, n: railN + half * sinT, z: railTopZ - half * cosT },
    });
  }
  return out;
}

/** Profile angle atan2(s_z, s_n) in degrees (sun ray projected onto the plane ⟂ facade); null if s_n ≤ 0. */
export function profileAngle(sf: FacadeVector): number | null {
  return sf.n <= 0 ? null : toDeg(Math.atan2(sf.z, sf.n));
}

/** Cosine of the angle of incidence on the panel plane (≤ 0: sun behind the panel). */
export function cosIncidence(sf: FacadeVector, layout: PanelLayout): number {
  const N = layout.normal;
  return sf.u * N.u + sf.n * N.n + sf.z * N.z;
}

function noShade(count: number, du = 0, dv = 0): ShadeResult {
  return { fraction: 0, perModule: new Array<number>(count).fill(0), rects: [], du, dv };
}

/**
 * Shade cast on a panel row by the identical row one floor above (floor height H, parallel planes).
 * The ray from lower-row point (u, v) toward the sun meets the upper plane at (u + du, v + dv), with
 * cosInc = s_n·cos θ + s_z·sin θ, du = H·sin θ·s_u / cosInc, dv = H·s_n / cosInc.
 * The point is shaded iff that lands on an upper module, so the shade is the upper row translated by (−du, −dv).
 * Zero shade (du = dv = 0) if s_n ≤ 0, s_z ≤ 0, cosInc ≤ 0 or θ = 0 (vertical, coplanar rows).
 * `rects` holds, per shaded module, the disjoint u-intervals (clipped to that module) × the shaded v-band.
 * Rows further up (shift j·(du, dv)) add nothing for gapless rows or single modules; with module gaps they can
 * reach through the gaps of the row directly above (e.g. flat, L = 1, w = 0.6, gap = 0.3, (du, dv) = (0.45, 0.25):
 * true 0.625 instead of 0.375 on the left module). Not modelled — annual effect < 0.01 %-points in realistic setups.
 */
export function shadeFromAbove(sf: FacadeVector, layout: PanelLayout): ShadeResult {
  const { modules, length: L, moduleWidth: w } = layout;
  const count = modules.length;
  const cosT = layout.normal.n;
  const sinT = layout.normal.z;
  const cosInc = sf.n * cosT + sf.z * sinT;
  if (sf.n <= 0 || sf.z <= 0 || cosInc <= 0 || sinT < VERTICAL_SIN_EPS) return noShade(count);

  const H = layout.floorHeight;
  const du = (H * sinT * sf.u) / cosInc;
  const dv = (H * sf.n) / cosInc;
  // v-band = [0, L] ∩ ([0, L] − dv)
  const v0 = Math.max(0, -dv);
  const v1 = Math.min(L, L - dv);
  if (v1 - v0 <= 0 || Math.abs(du) >= layout.rowWidth || count === 0 || !(w > 0)) return noShade(count, du, dv);

  const bandShare = (v1 - v0) / L;
  const perModule = new Array<number>(count).fill(0);
  const rects: ShadeRect[] = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const a = modules[i].u0;
    const b = modules[i].u1;
    let covered = 0;
    let open = false;
    let r0 = 0;
    let r1 = 0;
    // Upper modules shifted by −du are disjoint and sorted: sum of overlaps is exact.
    for (let j = 0; j < count; j++) {
      const lo = Math.max(a, modules[j].u0 - du);
      const hi = Math.min(b, modules[j].u1 - du);
      if (hi - lo <= U_EPS) continue;
      covered += hi - lo;
      if (open && lo <= r1 + U_EPS) r1 = hi;
      else {
        if (open) rects.push({ u0: r0, u1: r1, v0, v1 });
        open = true;
        r0 = lo;
        r1 = hi;
      }
    }
    if (open) rects.push({ u0: r0, u1: r1, v0, v1 });
    perModule[i] = Math.min(1, (covered / w) * bandShare);
    sum += perModule[i];
  }
  return { fraction: sum / count, perModule, rects, du, dv };
}

/**
 * Beam loss per module (0…1) under the bypass-substring model: 3 substrings parallel to the module's long side,
 * each 2 cell rows; 6 square cells across the short side (cell = short/6), round(long/cell) cells along the long
 * side (grid covers the module exactly). A substring's beam output is limited by its most shaded cell
 * (shaded cell area / cell area); module loss = mean of the substring losses.
 * Landscape (width ≥ length): substrings are bands along u; portrait: bands along v.
 * Always ≥ the linear (area) loss of the same module.
 */
export function substringBeamLoss(shade: ShadeResult, layout: PanelLayout): number[] {
  const { modules, length: L, moduleWidth: w } = layout;
  const out = new Array<number>(modules.length).fill(0);
  if (shade.rects.length === 0 || !(L > 0) || !(w > 0)) return out;
  const landscape = w >= L;
  const long = landscape ? w : L;
  const short = landscape ? L : w;
  const across = CELLS_ACROSS_SHORT_SIDE;
  const cs = short / across;
  const nAlong = Math.max(1, Math.round(long / cs));
  const cl = long / nAlong;
  const cellArea = cs * cl;
  const rowsPerSub = across / SUBSTRINGS_PER_MODULE;
  const cells = new Float64Array(across * nAlong); // shaded area, index p·nAlong + q
  const acrossOverlap = new Float64Array(across);

  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    let any = false;
    for (const r of shade.rects) {
      const ru0 = Math.max(r.u0, m.u0);
      const ru1 = Math.min(r.u1, m.u1);
      const rv0 = Math.max(r.v0, 0);
      const rv1 = Math.min(r.v1, L);
      if (ru1 - ru0 <= 0 || rv1 - rv0 <= 0) continue;
      if (!any) {
        cells.fill(0);
        any = true;
      }
      // Local coordinates: a = along the long side, c = across the short side, both from the module corner.
      const a0 = landscape ? ru0 - m.u0 : rv0;
      const a1 = landscape ? ru1 - m.u0 : rv1;
      const c0 = landscape ? rv0 : ru0 - m.u0;
      const c1 = landscape ? rv1 : ru1 - m.u0;
      for (let p = 0; p < across; p++) {
        acrossOverlap[p] = Math.max(0, Math.min(c1, (p + 1) * cs) - Math.max(c0, p * cs));
      }
      const q0 = Math.max(0, Math.floor(a0 / cl));
      const q1 = Math.min(nAlong - 1, Math.ceil(a1 / cl) - 1);
      for (let q = q0; q <= q1; q++) {
        const oa = Math.min(a1, (q + 1) * cl) - Math.max(a0, q * cl);
        if (oa <= 0) continue;
        for (let p = 0; p < across; p++) cells[p * nAlong + q] += acrossOverlap[p] * oa;
      }
    }
    if (!any) continue;
    let loss = 0;
    for (let s = 0; s < SUBSTRINGS_PER_MODULE; s++) {
      let worst = 0;
      for (let p = s * rowsPerSub; p < (s + 1) * rowsPerSub; p++) {
        for (let q = 0; q < nAlong; q++) worst = Math.max(worst, cells[p * nAlong + q]);
      }
      loss += Math.min(1, worst / cellArea);
    }
    out[i] = loss / SUBSTRINGS_PER_MODULE;
  }
  return out;
}

/**
 * Per-floor state for a known sun position (lets views reuse an already computed SunPosition).
 * 'night' if altitude ≤ 0, 'behind' if s_n ≤ 0, 'horizon' if altitude < horizon of that floor, else 'lit'.
 * Shade from the floor above only for lit floors below the top floor. Missing horizons count as flat (0°).
 */
export function instantStateFromSun(
  config: Config,
  utcMs: number,
  sun: SunPosition,
  horizons: readonly (HorizonProfile | null | undefined)[],
  layout: PanelLayout = panelLayout(config),
): InstantState {
  const sf = sunInFacade(sun, config.building.facadeAzimuth);
  const cosInc = cosIncidence(sf, layout);
  const n = config.building.numFloors;
  const floors: InstantState['floors'] = [];
  for (let k = 0; k < n; k++) {
    const hz = horizons[k];
    let state: SunState;
    if (sun.altitude <= 0) state = 'night';
    else if (sf.n <= 0) state = 'behind';
    else if (hz && sun.altitude < horizonAt(hz, sun.azimuth)) state = 'horizon';
    else state = 'lit';
    const shade = state === 'lit' && k < n - 1 ? shadeFromAbove(sf, layout) : noShade(layout.modules.length);
    floors.push({ floor: k, state, shade, cosIncidence: cosInc });
  }
  return { utcMs, sun, sunFacade: sf, profileAngle: profileAngle(sf), floors };
}

/** Everything the views need for one instant: sun position (NOAA), per-floor state and shade. */
export function instantState(config: Config, utcMs: number, horizons: HorizonProfile[]): InstantState {
  const sun = sunPosition(utcMs, config.location.latitude, config.location.longitude);
  return instantStateFromSun(config, utcMs, sun, horizons);
}
