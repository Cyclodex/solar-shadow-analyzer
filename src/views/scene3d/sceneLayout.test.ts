import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { DEFAULT_CONFIG } from '../../model/defaults';
import { floorPlacements, panelLayout, shadeFromAbove, sunInFacade } from '../../model/geometry';
import { solarPath } from '../../model/sun';
import type { Config, InstantState, ShadeRect, SunPosition } from '../../model/types';
import { panelPointFacade, type Tuple3 } from './coords';
import {
  BUILDING_SIDE_MARGIN,
  MAX_OVERLAY_RECTS,
  OVERLAY_VERTICES_PER_RECT,
  SUN_VIEW_DISTANCE,
  boxCorners,
  cameraPose,
  fitShadowCamera,
  hourMarks,
  modelShadeRects,
  sceneDims,
  skyState,
  sunDirection,
  sunPathSegments,
  writeOverlayRects,
  type CameraPreset,
  type SceneDims,
} from './sceneLayout';

const sun = (altitude: number, azimuth: number): SunPosition => ({
  altitude,
  azimuth,
  declination: 0,
  equationOfTime: 0,
});

function dimsOf(
  patch: { building?: Partial<Config['building']>; panels?: Partial<Config['panels']> } = {},
): SceneDims {
  const cfg: Config = {
    ...DEFAULT_CONFIG,
    building: { ...DEFAULT_CONFIG.building, ...patch.building },
    panels: { ...DEFAULT_CONFIG.panels, ...patch.panels },
  };
  const rows = floorPlacements(cfg);
  return sceneDims(panelLayout(cfg), rows, cfg.building.facadeAzimuth, rows[0].railTopZ - rows[0].slabZ);
}

/** Extreme configurations within LIMITS. */
const EXTREMES = [
  {},
  {
    building: { numFloors: 8, floorHeight: 500, lowestFloor: 0 },
    panels: { count: 8, width: 250, tiltFromVertical: 0 },
  },
  { building: { numFloors: 1, balconyDepth: 0 }, panels: { tiltFromVertical: 90, count: 1 } },
  {
    building: { numFloors: 8, lowestFloor: 40, facadeAzimuth: 17 },
    panels: { length: 250, tiltFromVertical: 70 },
  },
  { building: { facadeAzimuth: 359, floorHeight: 200 }, panels: { width: 30, length: 30, gap: 30 } },
];

describe('sceneDims', () => {
  it.each(EXTREMES)('sizes the building around the rows (%o)', (patch) => {
    const d = dimsOf(patch);
    expect(d.buildingWidth).toBeGreaterThanOrEqual(d.layout.rowWidth + BUILDING_SIDE_MARGIN);
    const top = d.rows[d.rows.length - 1];
    expect(d.buildingHeight).toBeGreaterThanOrEqual(top.slabZ + 3);
    expect(d.balconyWidth).toBeLessThanOrEqual(d.buildingWidth);
    // Every panel corner lies in the focus box and in the panels box.
    for (const row of d.rows) {
      for (const u of [-d.layout.rowWidth / 2, d.layout.rowWidth / 2]) {
        for (const v of [0, d.layout.length]) {
          const p = panelPointFacade(row, d.layout, u, v);
          for (const box of [d.focus, d.panels]) {
            expect(p.u).toBeGreaterThanOrEqual(box.min.u - 1e-9);
            expect(p.u).toBeLessThanOrEqual(box.max.u + 1e-9);
            expect(p.n).toBeGreaterThanOrEqual(box.min.n - 1e-9);
            expect(p.n).toBeLessThanOrEqual(box.max.n + 1e-9);
            expect(p.z).toBeGreaterThanOrEqual(box.min.z - 1e-9);
            expect(p.z).toBeLessThanOrEqual(box.max.z + 1e-9);
          }
        }
      }
    }
    expect(d.sunDistance).toBeGreaterThanOrEqual(30);
    expect(d.sunDistance).toBeLessThanOrEqual(60);
  });
});

describe('skyState', () => {
  it('has no direct light while the sun is down and full light high up', () => {
    expect(skyState(-10)).toMatchObject({ sunLight: 0, day: 0, warmth: 0 });
    expect(skyState(0).sunLight).toBe(0);
    expect(skyState(0.1).sunLight).toBeGreaterThan(0);
    expect(skyState(60)).toMatchObject({ sunLight: 1, day: 1, twilight: 0, warmth: 0 });
  });

  it('brightens monotonically and tints the horizon around sunrise', () => {
    let last = -1;
    for (let a = -12; a <= 20; a += 0.5) {
      const s = skyState(a);
      expect(s.day).toBeGreaterThanOrEqual(last);
      last = s.day;
    }
    expect(skyState(1).twilight).toBe(1);
    expect(skyState(-4).twilight).toBeGreaterThan(0);
  });
});

describe('sun path', () => {
  const path = solarPath('2025-06-21', 47.1, 7.45, 'Europe/Zurich', 10);

  it('splits at the facade plane and skips the night', () => {
    const segments = sunPathSegments(path, 202);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments.some((s) => s.front)).toBe(true);
    expect(segments.some((s) => !s.front)).toBe(true);
    for (const s of segments) for (const d of s.dirs) expect(d[1]).toBeGreaterThan(-0.02); // above the horizon
    // Neighbouring segments share their boundary point (continuous line).
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1].dirs;
      if (prev.length && segments[i].front !== segments[i - 1].front) {
        expect(segments[i].dirs[0]).toEqual(prev[prev.length - 1]);
      }
    }
  });

  it('has hour marks at full hours with the sun up', () => {
    const marks = hourMarks(path, 202);
    expect(marks.length).toBeGreaterThan(12);
    for (const m of marks) {
      expect(m.minutes % 60).toBe(0);
      expect(m.dir[1]).toBeGreaterThan(0);
    }
  });

  it('points the sun direction to the sun (east = +X, north = −Z)', () => {
    const [x, y, z] = sunDirection(sun(0, 90));
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(0, 12);
    expect(sunDirection(sun(90, 0))[1]).toBeCloseTo(1, 12);
  });
});

describe('fitShadowCamera', () => {
  it.each([
    [60, 180],
    [15, 100],
    [3, 290],
    [89.9, 10],
  ])('contains every fit point and its ground shadow (alt %d°, az %d°)', (alt, az) => {
    const d = dimsOf();
    const pts = boxCorners({ min: { u: -4, n: -10, z: 0 }, max: { u: 4, n: 2.5, z: 9 } }, d.facadeAzimuth);
    const dir = sunDirection(sun(alt, az));
    const fit = fitShadowCamera(pts, [], d.target, dir, 2048);
    const cam = new PerspectiveCamera(); // any camera: only its view matrix (lookAt) is used
    cam.position.set(...fit.position);
    cam.lookAt(new Vector3(...d.target));
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse;
    const s = new Vector3(...dir);
    for (const p of pts) {
      const v = new Vector3(...p).applyMatrix4(inv);
      expect(v.x).toBeGreaterThanOrEqual(fit.left);
      expect(v.x).toBeLessThanOrEqual(fit.right);
      expect(v.y).toBeGreaterThanOrEqual(fit.bottom);
      expect(v.y).toBeLessThanOrEqual(fit.top);
      expect(-v.z).toBeGreaterThan(fit.near);
      expect(-v.z).toBeLessThan(fit.far);
      // Ground shadow of the point (capped at the maximum depth range for grazing sun).
      if (p[1] > 0 && dir[1] > 0.05) {
        const ground = new Vector3(...p).addScaledVector(s, -p[1] / dir[1]).applyMatrix4(inv);
        expect(-ground.z).toBeLessThan(fit.far);
      }
    }
    // Tight: the box touches the frustum (within the margin) on every side.
    const xs = pts.map((p) => new Vector3(...p).applyMatrix4(inv));
    expect(Math.min(...xs.map((v) => v.x)) - fit.left).toBeLessThan(0.5);
    expect(fit.right - Math.max(...xs.map((v) => v.x))).toBeLessThan(0.5);
    expect(fit.texel).toBeGreaterThan(0);
  });

  it('moves the light beyond distant casters towards the sun', () => {
    const d = dimsOf();
    const far: Tuple3 = [0, 30, 400];
    const fit = fitShadowCamera(boxCorners(d.focus, d.facadeAzimuth), [far], d.target, [0, 0.6, 0.8], 2048);
    const toward = (p: readonly number[]): number =>
      (p[0] - d.target[0]) * 0 + (p[1] - d.target[1]) * 0.6 + (p[2] - d.target[2]) * 0.8;
    expect(toward(fit.position)).toBeGreaterThan(toward(far));
  });
});

describe('cameraPose', () => {
  const PRESETS: CameraPreset[] = ['default', 'front', 'side', 'top'];

  it.each(EXTREMES)('frames the target box above the ground (%o)', (patch) => {
    const d = dimsOf(patch);
    for (const aspect of [16 / 9, 0.6]) {
      for (const preset of PRESETS) {
        const pose = cameraPose(preset, d, sun(40, 180), aspect);
        expect(pose).not.toBeNull();
        if (!pose) continue;
        expect(pose.position[1]).toBeGreaterThan(0);
        const cam = new PerspectiveCamera(pose.fov, aspect, 0.1, 5000);
        cam.position.set(...pose.position);
        cam.lookAt(new Vector3(...pose.target));
        cam.updateMatrixWorld(true);
        const box = preset === 'front' || preset === 'side' ? d.panels : d.focus;
        for (const c of boxCorners(box, d.facadeAzimuth)) {
          const ndc = new Vector3(...c).project(cam);
          expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1 + 1e-9);
          expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });

  it('looks along the sun rays from the sun, and is unavailable at night', () => {
    const d = dimsOf();
    const s = sun(35, 200);
    const pose = cameraPose('sun', d, s, 1.6);
    expect(pose).not.toBeNull();
    if (!pose) return;
    const offset = new Vector3(...pose.position).sub(new Vector3(...pose.target));
    expect(offset.length()).toBeCloseTo(SUN_VIEW_DISTANCE, 6);
    const dir = offset.normalize().toArray();
    sunDirection(s).forEach((c, i) => expect(dir[i]).toBeCloseTo(c, 9));
    expect(pose.fov).toBeLessThan(15); // nearly parallel projection
    expect(cameraPose('sun', d, sun(-5, 200), 1.6)).toBeNull();
    expect(cameraPose('sun', d, sun(0.5, 200), 1.6)).toBeNull();
  });

  it('puts north up in the top view', () => {
    const d = dimsOf();
    const pose = cameraPose('top', d, sun(40, 180), 1);
    expect(pose).not.toBeNull();
    if (!pose) return;
    // Camera offset slightly to the south (+Z): the screen's up direction is north (−Z).
    expect(pose.position[2]).toBeGreaterThan(pose.target[2]);
    expect(pose.position[1] - pose.target[1]).toBeGreaterThan(100 * (pose.position[2] - pose.target[2]));
  });
});

describe('model shade overlay', () => {
  const layout = panelLayout(DEFAULT_CONFIG);
  const rect: ShadeRect = { u0: -1, u1: 0.5, v0: 0, v1: 0.3 };
  const floor = (state: InstantState['floors'][number]['state'], rects: ShadeRect[] = []) => ({
    floor: 0,
    state,
    shade: { fraction: 0, perModule: [], rects, du: 0, dv: 0 },
    cosIncidence: 0.5,
  });

  it('shows the model shade when lit, whole rows when blocked, nothing at night', () => {
    expect(modelShadeRects(floor('lit', [rect]), layout)).toEqual([rect]);
    expect(modelShadeRects(floor('lit'), layout)).toEqual([]);
    for (const state of ['behind', 'horizon'] as const) {
      const rects = modelShadeRects(floor(state), layout);
      expect(rects).toHaveLength(layout.count);
      rects.forEach((r, i) => expect(r).toEqual({ ...layout.modules[i], v0: 0, v1: layout.length }));
    }
    expect(modelShadeRects(floor('night'), layout)).toEqual([]);
  });

  it('writes counter-clockwise triangles in panel-local coordinates', () => {
    const cap = 2;
    const position = new Float32Array(cap * OVERLAY_VERTICES_PER_RECT * 3);
    const plane = new Float32Array(cap * OVERLAY_VERTICES_PER_RECT * 2);
    const rectAttr = new Float32Array(cap * OVERLAY_VERTICES_PER_RECT * 4);
    const count = writeOverlayRects([rect, rect, rect], position, plane, rectAttr, 0.004);
    expect(count).toBe(cap * OVERLAY_VERTICES_PER_RECT); // capacity respected
    for (let t = 0; t < count / 3; t++) {
      const p = (i: number): Vector3 =>
        new Vector3(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
      const [a, b, c] = [p(3 * t), p(3 * t + 1), p(3 * t + 2)];
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      expect(n.z).toBeGreaterThan(0); // front face towards the panel normal (+z)
      expect(a.z).toBeCloseTo(0.004, 6);
    }
    // plane = (u, v) with v down the slope (local y = −v); rect attribute = the rectangle.
    for (let i = 0; i < OVERLAY_VERTICES_PER_RECT; i++) {
      expect(plane[i * 2]).toBeCloseTo(position[i * 3], 6);
      expect(plane[i * 2 + 1]).toBeCloseTo(-position[i * 3 + 1], 6);
      expect(Array.from(rectAttr.slice(i * 4, i * 4 + 4))).toEqual(
        [rect.u0, rect.v0, rect.u1, rect.v1].map((v) => Math.fround(v)),
      );
    }
    const us = Array.from({ length: 6 }, (_, i) => plane[i * 2]);
    const vs = Array.from({ length: 6 }, (_, i) => plane[i * 2 + 1]);
    expect(Math.min(...us)).toBeCloseTo(rect.u0, 6);
    expect(Math.max(...us)).toBeCloseTo(rect.u1, 6);
    expect(Math.min(...vs)).toBeCloseTo(rect.v0, 6);
    expect(Math.max(...vs)).toBeCloseTo(rect.v1, 6);
  });

  it('never needs more than MAX_OVERLAY_RECTS rectangles per floor', () => {
    for (const panels of [
      { count: 8, width: 30, gap: 30, length: 250, tiltFromVertical: 80 },
      { count: 8, width: 250, gap: 0, length: 30, tiltFromVertical: 30 },
      { count: 5, width: 60, gap: 12, length: 120, tiltFromVertical: 60 },
    ]) {
      const cfg: Config = { ...DEFAULT_CONFIG, panels: { ...DEFAULT_CONFIG.panels, ...panels } };
      const l = panelLayout(cfg);
      let most = 0;
      for (let alt = 2; alt < 90; alt += 4) {
        for (let az = 0; az < 360; az += 5) {
          most = Math.max(most, shadeFromAbove(sunInFacade(sun(alt, az), 180), l).rects.length);
        }
      }
      expect(most).toBeGreaterThan(0);
      expect(most).toBeLessThanOrEqual(MAX_OVERLAY_RECTS);
    }
  });
});
