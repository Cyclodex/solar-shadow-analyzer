import { describe, expect, it } from 'vitest';
import { Object3D, Plane, Ray, Vector3 } from 'three';
import { DEFAULT_CONFIG } from '../../model/defaults';
import { floorPlacements, panelLayout, shadeFromAbove, sunInFacade } from '../../model/geometry';
import { sunVectorEnu } from '../../model/sun';
import type { Config, FacadeVector, SunPosition } from '../../model/types';
import {
  enuToThree,
  facadeLocal,
  facadeRotationY,
  facadeToEnu,
  facadeToThree,
  panelLocal,
  panelPointFacade,
  panelRotationX,
  threeToEnu,
  threeToFacade,
  type Tuple3,
} from './coords';

const sun = (altitude: number, azimuth: number): SunPosition => ({
  altitude,
  azimuth,
  declination: 0,
  equationOfTime: 0,
});

function config(patch: {
  building?: Partial<Config['building']>;
  panels?: Partial<Config['panels']>;
}): Config {
  return {
    ...DEFAULT_CONFIG,
    building: { ...DEFAULT_CONFIG.building, ...patch.building },
    panels: { ...DEFAULT_CONFIG.panels, ...patch.panels },
  };
}

function expectClose(actual: readonly number[], expected: readonly number[], digits = 9): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], digits));
}

/** Facade group → panel group of one floor, as built by the scene. */
function panelGroup(cfg: Config, floor: number): { facade: Object3D; panel: Object3D } {
  const layout = panelLayout(cfg);
  const row = floorPlacements(cfg)[floor];
  const facade = new Object3D();
  facade.rotation.y = facadeRotationY(cfg.building.facadeAzimuth);
  const panel = new Object3D();
  panel.position.set(...facadeLocal({ u: 0, n: row.railN, z: row.railTopZ }));
  panel.rotation.x = panelRotationX(layout.tiltFromVertical);
  facade.add(panel);
  facade.updateMatrixWorld(true);
  return { facade, panel };
}

const world = (o: Object3D, local: Tuple3): Tuple3 =>
  o.localToWorld(new Vector3(...local)).toArray() as Tuple3;

describe('ENU ↔ three.js', () => {
  it('maps east → +X, north → −Z, up → +Y', () => {
    expect(enuToThree({ x: 1, y: 0, z: 0 })).toEqual([1, 0, 0]);
    expect(enuToThree({ x: 0, y: 1, z: 0 })).toEqual([0, 0, -1]);
    expect(enuToThree({ x: 0, y: 0, z: 1 })).toEqual([0, 1, 0]);
  });

  it('round-trips', () => {
    const v = { x: 1.5, y: -2.25, z: 3 };
    expect(threeToEnu(enuToThree(v))).toEqual(v);
  });

  it('is a proper rotation (right-handed frames stay right-handed)', () => {
    const e = new Vector3(...enuToThree({ x: 1, y: 0, z: 0 }));
    const n = new Vector3(...enuToThree({ x: 0, y: 1, z: 0 }));
    const u = new Vector3(...enuToThree({ x: 0, y: 0, z: 1 }));
    // ENU: east × north = up
    expectClose(e.clone().cross(n).toArray(), u.toArray());
  });
});

describe('facade frame → three.js', () => {
  it.each([0, 90, 180, 202, 270, 359])('the facade normal points to azimuth %d°', (az) => {
    const [x, y, z] = facadeToThree({ u: 0, n: 1, z: 0 }, az);
    expect(y).toBe(0);
    // Back to a compass azimuth: east = +X, north = −Z.
    const azimuth = ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
    expect(azimuth).toBeCloseTo(az, 9);
  });

  it('u points right for a person looking at the facade from outside', () => {
    // South facade: looking north from outside, right = east.
    const s = facadeToEnu({ u: 1, n: 0, z: 0 }, 180);
    expect(s.x).toBeCloseTo(1, 12);
    expect(s.y).toBeCloseTo(0, 12);
    // West facade (270°): looking east from outside, right = south.
    const w = facadeToEnu({ u: 1, n: 0, z: 0 }, 270);
    expect(w.x).toBeCloseTo(0, 12);
    expect(w.y).toBeCloseTo(-1, 12);
  });

  it.each([0, 45, 180, 202, 311])('the facade group rotation equals facadeToThree (γ = %d°)', (az) => {
    const group = new Object3D();
    group.rotation.y = facadeRotationY(az);
    group.updateMatrixWorld(true);
    for (const p of [
      { u: 1, n: 0, z: 0 },
      { u: 0, n: 1, z: 0 },
      { u: 0, n: 0, z: 1 },
      { u: -2.5, n: 3.25, z: 7 },
    ] satisfies FacadeVector[]) {
      expectClose(world(group, facadeLocal(p)), facadeToThree(p, az));
    }
  });

  it.each([0, 45, 180, 202, 311])('threeToFacade inverts facadeToThree (γ = %d°)', (az) => {
    const out: FacadeVector = { u: 0, n: 0, z: 0 };
    for (const p of [
      { u: 1, n: 0, z: 0 },
      { u: 0, n: 1, z: 0 },
      { u: -2.5, n: 3.25, z: 7 },
    ] satisfies FacadeVector[]) {
      const [x, y, z] = facadeToThree(p, az);
      expect(threeToFacade(new Vector3(x, y, z), az, out)).toBe(out);
      expectClose([out.u, out.n, out.z], [p.u, p.n, p.z]);
    }
  });

  it('puts the model sun vector in the facade frame onto the ENU sun vector', () => {
    for (const [alt, az, facade] of [
      [30, 120, 202],
      [65, 180, 150],
      [5, 290, 250],
      [40, 45, 0],
    ]) {
      const s = sun(alt, az);
      expectClose(facadeToThree(sunInFacade(s, facade), facade), enuToThree(sunVectorEnu(s)));
    }
  });
});

describe('panel plane → three.js', () => {
  it.each([0, 30, 45, 70, 90])('panel group points match the model formulas (θ = %d°)', (tilt) => {
    const cfg = config({ panels: { tiltFromVertical: tilt }, building: { facadeAzimuth: 202 } });
    const layout = panelLayout(cfg);
    const rows = floorPlacements(cfg);
    const { panel } = panelGroup(cfg, 1);
    for (const [u, v] of [
      [0, 0],
      [0.4, 0.3],
      [-1.2, layout.length],
    ]) {
      const expected = facadeToThree(panelPointFacade(rows[1], layout, u, v), 202);
      expectClose(world(panel, panelLocal(u, v)), expected);
    }
    // Local +Z is the model's panel normal.
    const origin = new Vector3(...world(panel, [0, 0, 0]));
    const normal = new Vector3(...world(panel, [0, 0, 1])).sub(origin);
    expectClose(normal.toArray(), facadeToThree(layout.normal, 202));
  });

  it('panelPointFacade is the rail top edge at v = 0 and hangs outward/down by the tilt', () => {
    const cfg = config({ panels: { tiltFromVertical: 45 } });
    const layout = panelLayout(cfg);
    const row = floorPlacements(cfg)[0];
    expect(panelPointFacade(row, layout, 0, 0)).toEqual({ u: 0, n: row.railN, z: row.railTopZ });
    const bottom = panelPointFacade(row, layout, 0, layout.length);
    expect(bottom.n - row.railN).toBeCloseTo(layout.reach, 12);
    expect(row.railTopZ - bottom.z).toBeCloseTo(layout.drop, 12);
  });

  it('the model shade rectangle is exactly where rays towards the sun hit the upper row', () => {
    const cfg = config({
      building: { facadeAzimuth: 180 },
      panels: { tiltFromVertical: 50, count: 2, gap: 5 },
    });
    const layout = panelLayout(cfg);
    const s = sun(70, 140); // high sun, 40° east of the facade normal: shade band shifted sideways
    const sf = sunInFacade(s, 180);
    const shade = shadeFromAbove(sf, layout);
    expect(shade.rects.length).toBeGreaterThan(0);
    const lower = panelGroup(cfg, 0).panel;
    const upper = panelGroup(cfg, 1).panel;
    const dir = new Vector3(...enuToThree(sunVectorEnu(s)));
    const upperOrigin = new Vector3(...world(upper, [0, 0, 0]));
    const upperNormal = new Vector3(...world(upper, [0, 0, 1])).sub(upperOrigin);
    const plane = new Plane().setFromNormalAndCoplanarPoint(upperNormal, upperOrigin);
    const inv = upper.matrixWorld.clone().invert();

    /** Does the ray from lower-row point (u, v) towards the sun hit a module of the upper row? */
    const hitsUpper = (u: number, v: number): boolean => {
      const start = new Vector3(...world(lower, panelLocal(u, v)));
      const hit = new Ray(start, dir).intersectPlane(plane, new Vector3());
      if (!hit) return false;
      const local = hit.applyMatrix4(inv); // (u, −v, 0) in the upper panel group
      const hu = local.x;
      const hv = -local.y;
      return hv >= 0 && hv <= layout.length && layout.modules.some((m) => hu >= m.u0 && hu <= m.u1);
    };

    const eps = 1e-3;
    for (const r of shade.rects) {
      // Inside the rectangle: shaded; just outside across its lower edge (v1 < L): lit.
      expect(hitsUpper((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2)).toBe(true);
      expect(hitsUpper(r.u0 + eps, r.v0 + eps)).toBe(true);
      expect(hitsUpper(r.u1 - eps, r.v1 - eps)).toBe(true);
      if (r.v1 < layout.length - eps) expect(hitsUpper((r.u0 + r.u1) / 2, r.v1 + eps)).toBe(false);
      // Lateral edges inside a lower module (not clipped by the module edge) border lit area.
      const module = layout.modules.find((m) => r.u0 >= m.u0 - eps && r.u1 <= m.u1 + eps);
      expect(module).toBeDefined();
      const vMid = (r.v0 + r.v1) / 2;
      if (module && r.u0 > module.u0 + eps) expect(hitsUpper(r.u0 - eps, vMid)).toBe(false);
      if (module && r.u1 < module.u1 - eps) expect(hitsUpper(r.u1 + eps, vMid)).toBe(false);
    }
    // The upper row is shifted sideways across the module gap: at least one module holds two rectangles.
    expect(shade.rects.length).toBeGreaterThan(layout.count);
  });
});
