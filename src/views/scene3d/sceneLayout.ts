import { OrthographicCamera, Vector3 } from 'three';
import type {
  FacadeVector,
  FloorPlacement,
  InstantState,
  Obstacle,
  PanelLayout,
  ShadeRect,
  SunPosition,
} from '../../model/types';
import { LIMITS } from '../../model/defaults';
import { sunInFacade } from '../../model/geometry';
import { sunVectorEnu } from '../../model/sun';
import type { SolarPathPoint } from '../../model/sun';
import { clamp, toDeg, toRad } from '../../model/units';
import { enuToThree, facadeToThree, offsetAlong, panelPointFacade, type Tuple3 } from './coords';

// ─────────────────────────────────────────────
// SCENE LAYOUT (pure, three.js math only — no rendering)
// Dimensions of the scene objects, camera presets, the fitted shadow camera, sky state by sun
// altitude, the sun path split at the facade plane, and the model's shade rectangles per floor.
// Lengths in metres. Facade-frame boxes are converted with coords.ts.
// ─────────────────────────────────────────────

/** Depth of the building box behind the facade, m. */
export const BUILDING_DEPTH = 10;
/** Building width = row width + this (1.5 m on each side), m. */
export const BUILDING_SIDE_MARGIN = 3;
/** Minimum building width, m. */
export const BUILDING_MIN_WIDTH = 6;
/** Height of the building above the top panel floor's slab (at least), m. */
export const BUILDING_ABOVE_TOP_SLAB = 3;
/** Balcony slab extends this far beyond the panel row on each side, m. */
export const BALCONY_SIDE_MARGIN = 0.25;
/** Balcony slab thickness, m. */
export const SLAB_THICKNESS = 0.2;
/** Railing bar thickness, m. */
export const RAIL_THICKNESS = 0.05;
/** Clearance between the railing front and the panel plane (no z-fighting with vertical panels), m. */
export const RAIL_CLEARANCE = 0.015;
/** Module thickness, m (drawn behind the panel plane; thin so the cast shadow matches the plane model). */
export const MODULE_THICKNESS = 0.012;
/** Model shade overlay: offset in front of the panel plane, m. */
export const OVERLAY_OFFSET = 0.004;
/** Largest / smallest distance of the sun marker and sun path from the orbit target (4 × scene radius), m. */
export const SUN_DISTANCE = 60;
export const SUN_DISTANCE_MIN = 30;
/** Floor label width relative to its height (typical "1. OG" / "Floor 1" pill), for framing. */
const LABEL_ASPECT = 3.3;
/** Radius of the horizon silhouette ring, m. */
export const HORIZON_RING_RADIUS = 250;
/** Camera distance for the "from the sun" preset (inside the horizon ring), m. */
export const SUN_VIEW_DISTANCE = 180;
/** Default vertical field of view, degrees. */
export const DEFAULT_FOV = 35;
/** Obstacles closer than this (near face, m) are included in the shadow-map fit. */
export const SHADOW_FIT_OBSTACLE_DISTANCE = 60;
/** Closest and farthest orbit distance from the target, m. */
export const MIN_CAMERA_DISTANCE = 1.5;
export const MAX_CAMERA_DISTANCE = 230;
/**
 * Lowest camera elevation above the orbit target's horizontal plane, degrees: keeps the camera above the
 * ground (the target never lies below it). Shared by the orbit limit and the "from the sun" preset, so
 * the preset is never clamped off the sun rays.
 */
export const MIN_CAMERA_ELEVATION = 1;
/** Largest polar angle of the orbit camera (from straight above), radians. */
export const MAX_POLAR = Math.PI / 2 - toRad(MIN_CAMERA_ELEVATION);
/**
 * Half-extent of the shadow-only stand-in for the model's infinite facade (along the facade and above the
 * roof), m. Large enough that rays from the rows towards a grazing sun still cross it.
 */
export const FACADE_OCCLUDER_EXTENT = 500;

export interface Box3Facade {
  min: FacadeVector;
  max: FacadeVector;
}

export interface SceneDims {
  facadeAzimuth: number;
  buildingWidth: number;
  buildingDepth: number;
  buildingHeight: number;
  /** Floor-to-floor height H, m. */
  storeyHeight: number;
  /** Highest storey number with panels. */
  topStorey: number;
  balconyWidth: number;
  /** Railing distance from the wall (balcony depth), m. */
  railN: number;
  /** Railing height above the slab, m. */
  railHeight: number;
  rows: readonly FloorPlacement[];
  layout: PanelLayout;
  /** Region of interest in the facade frame: facade, balconies and panel rows. */
  focus: Box3Facade;
  /** Panel rows incl. their floor labels (left of the rows), facade frame. */
  panels: Box3Facade;
  /** Distance of the sun marker and sun path from the target, m. */
  sunDistance: number;
  /** World height of the floor labels (grows with the scene so they stay readable), m. */
  labelHeight: number;
  /** Orbit target: centre of the focus box, three.js world. */
  target: Tuple3;
  /** Radius of the sphere around the focus box, m. */
  radius: number;
}

/** Scene dimensions from the model's panel layout and floor placements. */
export function sceneDims(
  layout: PanelLayout,
  rows: readonly FloorPlacement[],
  facadeAzimuth: number,
  railHeight: number,
): SceneDims {
  const H = layout.floorHeight;
  const lowest = rows[0];
  const top = rows[rows.length - 1];
  const railN = lowest?.railN ?? 0;
  const topSlab = top?.slabZ ?? 0;
  const buildingWidth = Math.max(BUILDING_MIN_WIDTH, layout.rowWidth + BUILDING_SIDE_MARGIN);
  const buildingHeight = topSlab + Math.max(BUILDING_ABOVE_TOP_SLAB, H);
  const balconyWidth = Math.min(buildingWidth, layout.rowWidth + 2 * BALCONY_SIDE_MARGIN);
  const lowSlab = lowest?.slabZ ?? 0;
  const lowestPanelBottom = (lowest?.railTopZ ?? 0) - layout.drop;
  // Rows can reach below the ground on the ground floor (short railing, long panels): keep them in view.
  const zMin = Math.min(lowSlab < 4 ? 0 : lowSlab - 0.6, lowestPanelBottom - 0.1);
  const zMax = Math.max((top?.railTopZ ?? 0) + 0.6, zMin + 1);
  const focus: Box3Facade = {
    min: { u: -buildingWidth / 2, n: 0, z: zMin },
    max: { u: buildingWidth / 2, n: railN + layout.reach + 0.3, z: zMax },
  };
  const centre: FacadeVector = {
    u: 0,
    n: (focus.min.n + focus.max.n) / 2,
    z: (focus.min.z + focus.max.z) / 2,
  };
  const du = focus.max.u - focus.min.u;
  const dn = focus.max.n - focus.min.n;
  const dz = focus.max.z - focus.min.z;
  const radius = Math.hypot(du, dn, dz) / 2;
  const labelHeight = clamp(0.06 * radius, 0.36, 1.2);
  const panels: Box3Facade = {
    min: {
      u: -layout.rowWidth / 2 - 0.2 - LABEL_ASPECT * labelHeight,
      n: railN - 0.1,
      z: lowestPanelBottom - 0.25,
    },
    max: { u: layout.rowWidth / 2 + 0.2, n: railN + layout.reach + 0.05, z: (top?.railTopZ ?? 0) + 0.25 },
  };
  return {
    facadeAzimuth,
    buildingWidth,
    buildingDepth: BUILDING_DEPTH,
    buildingHeight,
    storeyHeight: H,
    topStorey: top?.storey ?? 0,
    balconyWidth,
    railN,
    railHeight,
    rows,
    layout,
    focus,
    panels,
    sunDistance: clamp(4 * radius, SUN_DISTANCE_MIN, SUN_DISTANCE),
    labelHeight,
    target: facadeToThree(centre, facadeAzimuth),
    radius,
  };
}

/**
 * Whether a railing fits between the wall and the panel plane at railing distance `railN` (m). Without
 * it the panels are drawn as mounted directly on the facade (e.g. balcony depth 0).
 */
export function hasRailing(railN: number): boolean {
  return railN >= RAIL_THICKNESS + RAIL_CLEARANCE;
}

/** The 8 corners of a facade-frame box in three.js world coordinates. */
export function boxCorners(box: Box3Facade, facadeAzimuth: number): Tuple3[] {
  const out: Tuple3[] = [];
  for (const u of [box.min.u, box.max.u]) {
    for (const n of [box.min.n, box.max.n]) {
      for (const z of [box.min.z, box.max.z]) out.push(facadeToThree({ u, n, z }, facadeAzimuth));
    }
  }
  return out;
}

/**
 * Shadow-only stand-in for the model's facade, which is infinitely wide and high: a thin slab just behind
 * the wall (n < 0), cast into the shadow map while the sun is behind the facade so that, as in the model,
 * no direct sun reaches anything in front of it.
 */
export function facadeOccluderBox(dims: SceneDims): Box3Facade {
  const e = FACADE_OCCLUDER_EXTENT;
  return {
    min: { u: -e, n: -0.002, z: 0 },
    max: { u: e, n: -0.001, z: dims.buildingHeight + e },
  };
}

/** Facade-frame box of an obstacle (u = offsetAlong ± width/2, n = distance … distance + depth, z = 0 … height). */
export function obstacleBox(o: Obstacle): Box3Facade {
  return {
    min: { u: o.offsetAlong - o.width / 2, n: o.distance, z: 0 },
    max: { u: o.offsetAlong + o.width / 2, n: o.distance + o.depth, z: o.height },
  };
}

/**
 * Points of the panel rows that obstacles should not hide from the camera: centre and corners of every
 * module (facade frame).
 */
export function viewTargets(dims: SceneDims): FacadeVector[] {
  const { layout } = dims;
  const out: FacadeVector[] = [];
  for (const row of dims.rows) {
    for (const m of layout.modules) {
      out.push(panelPointFacade(row, layout, (m.u0 + m.u1) / 2, layout.length / 2));
      for (const u of [m.u0, m.u1]) {
        for (const v of [0, layout.length]) out.push(panelPointFacade(row, layout, u, v));
      }
    }
  }
  return out;
}

const AXES = ['u', 'n', 'z'] as const;

/** Whether the segment a→b meets the box (slab test; allocation-free). */
export function segmentHitsBox(a: FacadeVector, b: FacadeVector, box: Box3Facade): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < AXES.length; i++) {
    const k = AXES[i];
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-12) {
      if (a[k] < box.min[k] || a[k] > box.max[k]) return false;
      continue;
    }
    const ta = (box.min[k] - a[k]) / d;
    const tb = (box.max[k] - a[k]) / d;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Whether an obstacle box hides any of `targets` from the camera at `cam` (facade frame). False while the
 * camera is inside the box: its faces are culled from inside, so it does not hide anything then.
 */
export function obstacleBlocksView(
  cam: FacadeVector,
  targets: readonly FacadeVector[],
  box: Box3Facade,
): boolean {
  const inside =
    cam.u > box.min.u &&
    cam.u < box.max.u &&
    cam.n > box.min.n &&
    cam.n < box.max.n &&
    cam.z > box.min.z &&
    cam.z < box.max.z;
  if (inside) return false;
  for (let i = 0; i < targets.length; i++) if (segmentHitsBox(cam, targets[i], box)) return true;
  return false;
}

// ── Sun ──────────────────────────────────────

/** Unit sun direction (towards the sun) in three.js world coordinates. */
export function sunDirection(sun: SunPosition): Tuple3 {
  return enuToThree(sunVectorEnu(sun));
}

export interface SkyState {
  /** 0 = night, 1 = full daylight (sky colours). */
  day: number;
  /** 0…1, peaks around sunrise/sunset (warm horizon tint). */
  twilight: number;
  /** Direct light factor 0…1 (0 when the sun is below the horizon). */
  sunLight: number;
  /** Warm tint of the sunlight 0…1 (low sun). */
  warmth: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Sky and light state from the apparent sun altitude (degrees). Direct light is on exactly when the
 * model has the sun above the horizon (altitude > 0), never dimmed to zero while the sun is up.
 */
export function skyState(altitude: number): SkyState {
  const up = altitude > 0;
  return {
    day: smoothstep(-6, 8, altitude),
    twilight: altitude > -9 && altitude < 12 ? clamp(1 - Math.abs(altitude - 1) / 9, 0, 1) : 0,
    sunLight: up ? 0.45 + 0.55 * smoothstep(0, 25, altitude) : 0,
    warmth: up ? 1 - smoothstep(2, 25, altitude) : 0,
  };
}

export interface SunPathSegment {
  /** Sun in front of the facade plane (s_n > 0) along this segment. */
  front: boolean;
  /** Unit directions towards the sun (three.js world). */
  dirs: Tuple3[];
}

/**
 * Sun path of a day split into segments above the horizon (altitude > minAltitude) with a constant
 * front/behind-the-facade state. Neighbouring segments share their boundary point (continuous line).
 */
export function sunPathSegments(
  path: readonly SolarPathPoint[],
  facadeAzimuth: number,
  minAltitude = 0,
): SunPathSegment[] {
  const out: SunPathSegment[] = [];
  let current: SunPathSegment | null = null;
  for (const p of path) {
    if (p.sun.altitude <= minAltitude) {
      current = null;
      continue;
    }
    const dir = sunDirection(p.sun);
    const front = sunInFacade(p.sun, facadeAzimuth).n > 0;
    if (current && current.front !== front) {
      const last: Tuple3 = current.dirs[current.dirs.length - 1];
      current = { front, dirs: [last] };
      out.push(current);
    } else if (!current) {
      current = { front, dirs: [] };
      out.push(current);
    }
    current.dirs.push(dir);
  }
  return out.filter((s) => s.dirs.length >= 2);
}

export interface HourMark {
  /** Local clock minutes (full hours). */
  minutes: number;
  dir: Tuple3;
  front: boolean;
}

/** Full-hour points of the sun path above the horizon; no 24:00 (on polar days it would sit on 00:00). */
export function hourMarks(path: readonly SolarPathPoint[], facadeAzimuth: number): HourMark[] {
  return path
    .filter((p) => p.minutes % 60 === 0 && p.minutes < 1440 && p.sun.altitude > 0)
    .map((p) => ({
      minutes: p.minutes,
      dir: sunDirection(p.sun),
      front: sunInFacade(p.sun, facadeAzimuth).n > 0,
    }));
}

// ── Shadow camera ────────────────────────────

export interface ShadowFit {
  /** Light position (three.js world); the light looks at the target. */
  position: Tuple3;
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
  /** Size of one shadow-map texel on a surface facing the sun, m. */
  texel: number;
}

const MIN_LIGHT_DISTANCE = 40;
const MAX_DEPTH_RANGE = 3000;
const scratchCamera = new OrthographicCamera();
const scratchVec = new Vector3();
const scratchTarget = new Vector3();

/**
 * Orthographic shadow camera of a directional light towards `sunDir`, fitted tightly around `fitPoints`
 * (light-space x/y), placed far enough to include `depthPoints` (casters further towards the sun) and
 * reaching deep enough to include the ground behind every fit point. Mirrors
 * DirectionalLightShadow.updateMatrices (camera at the light position, lookAt(target), up = +Y).
 */
export function fitShadowCamera(
  fitPoints: readonly Tuple3[],
  depthPoints: readonly Tuple3[],
  target: Tuple3,
  sunDir: Tuple3,
  mapSize: number,
  margin = 0.4,
): ShadowFit {
  const [sx, sy, sz] = sunDir;
  const toward = (p: Tuple3): number =>
    (p[0] - target[0]) * sx + (p[1] - target[1]) * sy + (p[2] - target[2]) * sz;
  let reach = 0;
  for (const p of fitPoints) reach = Math.max(reach, toward(p));
  for (const p of depthPoints) reach = Math.max(reach, toward(p));
  const distance = Math.max(MIN_LIGHT_DISTANCE, reach + 5);
  const position: Tuple3 = [target[0] + sx * distance, target[1] + sy * distance, target[2] + sz * distance];

  scratchCamera.position.set(position[0], position[1], position[2]);
  scratchCamera.up.set(0, 1, 0);
  scratchCamera.lookAt(scratchTarget.set(target[0], target[1], target[2]));
  scratchCamera.updateMatrixWorld(true);
  const inv = scratchCamera.matrixWorldInverse;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxDepth = 0;
  // Shadow of a fit point on the ground (y = 0) lies further along the light direction.
  const groundT = sy > 0.02 ? 1 / sy : 1 / 0.02;
  for (const p of fitPoints) {
    scratchVec.set(p[0], p[1], p[2]).applyMatrix4(inv);
    minX = Math.min(minX, scratchVec.x);
    maxX = Math.max(maxX, scratchVec.x);
    minY = Math.min(minY, scratchVec.y);
    maxY = Math.max(maxY, scratchVec.y);
    const depth = -scratchVec.z;
    maxDepth = Math.max(maxDepth, depth + Math.max(0, p[1]) * groundT);
  }
  const near = 0.5;
  const far = Math.min(near + MAX_DEPTH_RANGE, maxDepth + 5);
  const left = minX - margin;
  const right = maxX + margin;
  const bottom = minY - margin;
  const top = maxY + margin;
  return {
    position,
    left,
    right,
    top,
    bottom,
    near,
    far: Math.max(far, near + 1),
    texel: Math.max(right - left, top - bottom) / mapSize,
  };
}

// ── Camera presets ───────────────────────────

export type CameraPreset = 'default' | 'front' | 'side' | 'top' | 'sun';

export interface CameraPose {
  position: Tuple3;
  target: Tuple3;
  /** Vertical field of view, degrees. */
  fov: number;
}

/** Share of the view left free around the fitted box (overlays, breathing room). */
const VIEW_MARGIN = 0.8;
/**
 * Lowest sun altitude (degrees) for the "from the sun" preset: the lowest camera elevation the orbit allows
 * (so the camera stays above the ground and exactly on the sun ray).
 */
export const SUN_VIEW_MIN_ALTITUDE = MIN_CAMERA_ELEVATION;

/** Viewing directions (facade frame, towards the camera) of the fixed presets. */
const PRESET_DIRS: Record<Exclude<CameraPreset, 'top' | 'sun'>, FacadeVector> = {
  default: { u: 0.7, n: 1, z: 0.3 },
  front: { u: 0, n: 1, z: 0.12 },
  side: { u: 1, n: 0.16, z: 0.1 },
};

const basisRight = new Vector3();
const basisUp = new Vector3();
const basisDir = new Vector3();
const corner = new Vector3();

interface ViewCorner {
  x: number;
  y: number;
  /** Towards the camera. */
  z: number;
}

/** Corners of `box` relative to its centre in the basis of a camera looking along −dir (up = +Y). */
function viewCorners(
  box: Box3Facade,
  facadeAzimuth: number,
  dir: Tuple3,
): { centre: Tuple3; corners: ViewCorner[] } {
  const pts = boxCorners(box, facadeAzimuth);
  const centre: Tuple3 = [0, 0, 0];
  for (const p of pts) for (let i = 0; i < 3; i++) centre[i] += p[i] / pts.length;
  basisDir.set(dir[0], dir[1], dir[2]).normalize();
  basisRight.set(0, 1, 0).cross(basisDir);
  if (basisRight.lengthSq() < 1e-10) basisRight.set(1, 0, 0);
  basisRight.normalize();
  basisUp.copy(basisDir).cross(basisRight).normalize();
  const corners = pts.map((p) => {
    corner.set(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]);
    return { x: corner.dot(basisRight), y: corner.dot(basisUp), z: corner.dot(basisDir) };
  });
  return { centre, corners };
}

/**
 * Smallest camera distance (from the box centre, along `dir`) at which every corner of the box lies inside a
 * perspective view with vertical field of view `fovDeg`, leaving the VIEW_MARGIN share free.
 */
export function fitBoxDistance(
  box: Box3Facade,
  facadeAzimuth: number,
  dir: Tuple3,
  fovDeg: number,
  aspect: number,
): { centre: Tuple3; distance: number } {
  const { centre, corners } = viewCorners(box, facadeAzimuth, dir);
  const tv = Math.tan(toRad(fovDeg) / 2) * VIEW_MARGIN;
  const th = tv * Math.max(0.2, aspect);
  let distance = 0;
  for (const c of corners)
    distance = Math.max(distance, c.z + Math.max(Math.abs(c.x) / th, Math.abs(c.y) / tv));
  return { centre, distance };
}

/** Vertical field of view (degrees) that fits the box from `distance` along `dir` (see fitBoxDistance). */
export function fitBoxFov(
  box: Box3Facade,
  facadeAzimuth: number,
  dir: Tuple3,
  distance: number,
  aspect: number,
): { centre: Tuple3; fov: number } {
  const { centre, corners } = viewCorners(box, facadeAzimuth, dir);
  let tv = 0;
  for (const c of corners) {
    const d = Math.max(1, distance - c.z);
    tv = Math.max(tv, Math.abs(c.y) / d, Math.abs(c.x) / d / Math.max(0.2, aspect));
  }
  return { centre, fov: clamp(toDeg(2 * Math.atan(tv / VIEW_MARGIN)), 3, 60) };
}

/**
 * Distance at which a camera with vertical field of view `toFov` frames the plane through the target
 * exactly as a camera at `distance` with `fromFov` does (same view height at the target).
 */
export function equivalentDistance(distance: number, fromFov: number, toFov: number): number {
  return (distance * Math.tan(toRad(fromFov) / 2)) / Math.tan(toRad(toFov) / 2);
}

function normalize(v: Tuple3): Tuple3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Camera pose of a preset. 'default' frames the facade with balconies and panels obliquely; 'front' and
 * 'side' frame the panel rows; 'top' looks straight down with north up; 'sun' looks along the sun rays
 * from SUN_VIEW_DISTANCE with a narrow field of view (close to the sun's parallel projection: what is
 * visible is lit). Returns null for 'sun' while the sun is lower than SUN_VIEW_MIN_ALTITUDE.
 */
export function cameraPose(
  preset: CameraPreset,
  dims: SceneDims,
  sun: SunPosition,
  aspect: number,
): CameraPose | null {
  const { facadeAzimuth } = dims;
  if (preset === 'sun') {
    if (!(sun.altitude >= SUN_VIEW_MIN_ALTITUDE)) return null;
    const dir = sunDirection(sun);
    const { centre, fov } = fitBoxFov(dims.panels, facadeAzimuth, dir, SUN_VIEW_DISTANCE, aspect);
    return { position: offsetAlong(centre, dir, SUN_VIEW_DISTANCE), target: centre, fov };
  }
  const box = preset === 'front' || preset === 'side' ? dims.panels : dims.focus;
  const dir: Tuple3 =
    preset === 'top' ? [0, 1, 1e-3] : normalize(facadeToThree(PRESET_DIRS[preset], facadeAzimuth));
  const { centre, distance } = fitBoxDistance(box, facadeAzimuth, dir, DEFAULT_FOV, aspect);
  return { position: offsetAlong(centre, dir, distance), target: centre, fov: DEFAULT_FOV };
}

// ── Model shade overlay ──────────────────────

/**
 * Areas of a floor's panel row without direct sun according to the model (panel-plane u/v rectangles):
 * the shade cast by the floor above when lit; the whole row when the sun is behind the facade or below
 * the horizon of that floor; nothing at night.
 */
export function modelShadeRects(floor: InstantState['floors'][number], layout: PanelLayout): ShadeRect[] {
  switch (floor.state) {
    case 'lit':
      return floor.shade.rects;
    case 'behind':
    case 'horizon':
      return layout.modules.map((m) => ({ u0: m.u0, u1: m.u1, v0: 0, v1: layout.length }));
    default:
      return [];
  }
}

/**
 * Shade rectangles per floor: at most 2 per module (the window of one module meets at most two modules of
 * the shifted upper row, which have the same width).
 */
export const MAX_OVERLAY_RECTS = 2 * LIMITS.panels.count.max;

/** Vertices per overlay rectangle (two triangles, not indexed). */
export const OVERLAY_VERTICES_PER_RECT = 6;

/**
 * Triangle corners of a rectangle as (u, v) selectors (0 = u0/v0, 1 = u1/v1), counter-clockwise seen from
 * the panel front (+z, since local y = −v): (u0,v0) (u1,v1) (u1,v0) · (u0,v0) (u0,v1) (u1,v1).
 */
const CORNER_U = [0, 1, 1, 0, 0, 1] as const;
const CORNER_V = [0, 1, 0, 0, 1, 1] as const;

/**
 * Writes rectangles as triangles in panel-local coordinates (x = u, y = −v, z = offset) into preallocated
 * attribute arrays: position (3), plane = (u, v) (2), rect = (u0, v0, u1, v1) (4). Returns the number of
 * vertices written (rectangles beyond the capacity are dropped). Allocation-free (runs on every time step).
 */
export function writeOverlayRects(
  rects: readonly ShadeRect[],
  position: Float32Array,
  plane: Float32Array,
  rect: Float32Array,
  offset = OVERLAY_OFFSET,
): number {
  const capacity = Math.floor(position.length / (3 * OVERLAY_VERTICES_PER_RECT));
  const n = Math.min(capacity, rects.length);
  let vtx = 0;
  for (let i = 0; i < n; i++) {
    const r = rects[i];
    for (let c = 0; c < OVERLAY_VERTICES_PER_RECT; c++) {
      const u = CORNER_U[c] === 0 ? r.u0 : r.u1;
      const v = CORNER_V[c] === 0 ? r.v0 : r.v1;
      position[vtx * 3] = u;
      position[vtx * 3 + 1] = v === 0 ? 0 : -v;
      position[vtx * 3 + 2] = offset;
      plane[vtx * 2] = u;
      plane[vtx * 2 + 1] = v;
      rect[vtx * 4] = r.u0;
      rect[vtx * 4 + 1] = r.v0;
      rect[vtx * 4 + 2] = r.u1;
      rect[vtx * 4 + 3] = r.v1;
      vtx++;
    }
  }
  return vtx;
}
