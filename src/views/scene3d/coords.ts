import type { FacadeVector, FloorPlacement, PanelLayout, Vec3 } from '../../model/types';
import { toRad } from '../../model/units';

// ─────────────────────────────────────────────
// COORDINATES: model frames → three.js
// The only place where model coordinates are converted for the 3D view (docs/ARCHITECTURE.md).
//   ENU (model world):  x = east, y = north, z = up
//   three.js world:     X = east, Y = up,    Z = −north (= south)
//   Facade frame:       u = along the facade (+ = right seen from outside), n = outward normal, z = up
//   Facade group:       a <group> rotated by facadeRotationY(γ); its local axes are (x = u, y = z, z = n)
//   Panel group:        child of the facade group at the rail top edge, rotated by panelRotationX(θ);
//                       local axes (x = u, y = −v, z = panel normal), v = distance down the slope
// ─────────────────────────────────────────────

export type Tuple3 = [number, number, number];

/** ENU vector (x = east, y = north, z = up) → three.js world (X = east, Y = up, Z = −north). */
export function enuToThree(v: Vec3): Tuple3 {
  return [v.x, v.z, v.y === 0 ? 0 : -v.y];
}

/** three.js world → ENU (inverse of enuToThree). */
export function threeToEnu([x, y, z]: readonly [number, number, number]): Vec3 {
  return { x, y: z === 0 ? 0 : -z, z: y };
}

/** Facade-frame vector (u, n, z) of a facade facing `facadeAzimuth` → ENU. Origin: facade wall, row centre, ground. */
export function facadeToEnu(p: FacadeVector, facadeAzimuth: number): Vec3 {
  const g = toRad(facadeAzimuth);
  const s = Math.sin(g);
  const c = Math.cos(g);
  // n̂ = (sin γ, cos γ, 0), û = (−cos γ, sin γ, 0)
  return { x: p.n * s - p.u * c, y: p.n * c + p.u * s, z: p.z };
}

/** Facade-frame vector → three.js world (works for points and directions). */
export function facadeToThree(p: FacadeVector, facadeAzimuth: number): Tuple3 {
  return enuToThree(facadeToEnu(p, facadeAzimuth));
}

/**
 * Y rotation (radians) of the facade group: maps its local axes (x = u, y = z, z = n) onto the world.
 * Rotating local X = (1, 0, 0) by φ about Y gives (cos φ, 0, −sin φ), which must equal û in three.js
 * coordinates, (−cos γ, 0, −sin γ): φ = π − γ.
 */
export function facadeRotationY(facadeAzimuth: number): number {
  return Math.PI - toRad(facadeAzimuth);
}

/** Local coordinates of a facade-frame point inside the facade group. */
export function facadeLocal(p: FacadeVector): Tuple3 {
  return [p.u, p.z, p.n];
}

/**
 * X rotation (radians) of a panel group placed at the rail top edge: local −Y becomes the slope direction
 * (n, z) = (sin θ, −cos θ) and local +Z the panel normal (n, z) = (cos θ, sin θ).
 */
export function panelRotationX(tiltFromVertical: number): number {
  return -toRad(tiltFromVertical);
}

/** Local coordinates of the panel-plane point (u, v) inside a panel group; `offset` along the panel normal. */
export function panelLocal(u: number, v: number, offset = 0): Tuple3 {
  return [u, v === 0 ? 0 : -v, offset];
}

/**
 * Facade coordinates of the panel-plane point (u, v) of a floor, with the model's formulas
 * n = railN + v·sin θ, z = railTopZ − v·cos θ (sin/cos from layout.normal, exact at 0° and 90°).
 */
export function panelPointFacade(
  placement: FloorPlacement,
  layout: PanelLayout,
  u: number,
  v: number,
): FacadeVector {
  const sinT = layout.normal.z;
  const cosT = layout.normal.n;
  return { u, n: placement.railN + v * sinT, z: placement.railTopZ - v * cosT };
}

/** Adds `scale`·`dir` to `origin`. */
export function offsetAlong(origin: readonly number[], dir: readonly number[], scale: number): Tuple3 {
  return [origin[0] + dir[0] * scale, origin[1] + dir[1] * scale, origin[2] + dir[2] * scale];
}
