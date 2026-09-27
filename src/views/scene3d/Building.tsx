import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BoxGeometry,
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Matrix4,
  type InstancedMesh,
  type LineBasicMaterial,
  type MeshStandardMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vertex } from '../../model/polygon';
import type { FacadeVector } from '../../model/types';
import { blockingPrisms, ownBodyParts, prismBoxes, prismMesh, type ScenePrism } from './buildingsGeometry';
import { threeToFacade } from './coords';
import type { ScenePalette } from './palette';
import {
  MODULE_THICKNESS,
  RAIL_CLEARANCE,
  RAIL_THICKNESS as RAIL,
  SLAB_THICKNESS,
  hasRailing,
  rowTargets,
  type SceneDims,
} from './sceneLayout';

// ─────────────────────────────────────────────
// BUILDING AND BALCONIES (children of the facade group: x = u, y = z, z = n; facade wall at z = 0)
// ─────────────────────────────────────────────

const WINDOW_WIDTH = 1.3;
const WINDOW_PITCH = 2.6;
/** Windows in front of the wall, m (less when the panels hang closer to the wall, so they stay in front). */
const WINDOW_OFFSET = 0.012;
/**
 * Distance from the panel plane to anything drawn behind vertical panels (windows, slab front): the
 * modules' back face plus a gap, so that nothing is coplanar with them.
 */
const BEHIND_PANELS = MODULE_THICKNESS + 0.003;
const POST = 0.04;
const MAX_POST_SPACING = 1.3;
/** Opacity of a wing of the own building that hides part of the panel rows (as the neighbours). */
const WING_FADED_OPACITY = 0.22;
/** Camera position in the facade frame (scratch, written every frame). */
const WING_CAM: FacadeVector = { u: 0, n: 0, z: 0 };

/** Prism geometry of rings in the facade frame (local axes x = u, y = z, z = n; prismMesh maps b → z = −b). */
function facadePrismGeometry(rings: readonly Vertex[][], top: number): BufferGeometry {
  const mesh = prismMesh(
    rings.map((ring, i) => ({
      id: `own${i}`,
      kind: 'imported',
      ring: ring.map(([u, n]): Vertex => [u, -n]),
      base: 0,
      top,
    })),
  );
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(mesh.normals, 3));
  return g;
}

function setWingFaded(material: MeshStandardMaterial | LineBasicMaterial, faded: boolean): void {
  material.transparent = faded;
  material.opacity = faded ? WING_FADED_OPACITY : 1;
  material.depthWrite = !faded;
  // `transparent` selects another shader program variant.
  material.needsUpdate = true;
}

/**
 * A wing of the own building in front of the facade (the facade in the inner corner of an L): translucent
 * while it hides part of the panel rows from the camera, like the neighbours (not in the "from the sun" view);
 * its shadow stays. Before, the default camera of such a facade saw only this wing's wall.
 */
function OwnWing({
  ring,
  top,
  palette,
  targets,
  facadeAzimuth,
  fade,
}: {
  ring: Vertex[];
  top: number;
  palette: ScenePalette;
  targets: readonly FacadeVector[];
  facadeAzimuth: number;
  fade: boolean;
}) {
  const geometry = useMemo(() => facadePrismGeometry([ring], top), [ring, top]);
  const edges = useMemo(() => new EdgesGeometry(geometry, 20), [geometry]);
  useEffect(
    () => () => {
      geometry.dispose();
      edges.dispose();
    },
    [geometry, edges],
  );
  const prisms = useMemo(
    (): ScenePrism[] => [{ id: 'wing', kind: 'imported', ring, base: 0, top }],
    [ring, top],
  );
  const boxes = useMemo(() => prismBoxes(prisms), [prisms]);
  const points = useMemo(() => targets.map((p) => ({ x: p.u, y: p.n, z: p.z })), [targets]);
  const bodyRef = useRef<MeshStandardMaterial>(null);
  const edgeRef = useRef<LineBasicMaterial>(null);
  const faded = useRef(false);
  useFrame(({ camera }) => {
    const cam = threeToFacade(camera.position, facadeAzimuth, WING_CAM);
    const blocked = fade && blockingPrisms({ x: cam.u, y: cam.n, z: cam.z }, points, prisms, boxes).size > 0;
    const body = bodyRef.current;
    const edge = edgeRef.current;
    if (blocked === faded.current || !body || !edge) return;
    faded.current = blocked;
    setWingFaded(body, blocked);
    setWingFaded(edge, blocked);
  });
  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          ref={bodyRef}
          color={palette.color('wall')}
          roughness={0.92}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={2}
          polygonOffsetUnits={2}
        />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial ref={edgeRef} color={palette.color('wall-edge')} />
      </lineSegments>
    </group>
  );
}

interface WindowRect {
  x: number;
  y0: number;
  y1: number;
}

/**
 * Window openings per storey (balcony doors on the panel storeys, `doorStoreys` as "2,3,4") across the body
 * from u0 to u1: columns every WINDOW_PITCH on the grid of a schematic building `gridWidth` wide centred on
 * the panel rows (so the doors stay behind the panels), storeys 0 … topStorey.
 */
function windowRects(
  u0: number,
  u1: number,
  gridWidth: number,
  H: number,
  topStorey: number,
  doorStoreys: string,
): WindowRect[] {
  const panelStoreys = new Set(doorStoreys ? doorStoreys.split(',').map(Number) : []);
  const cols = Math.max(1, Math.floor((gridWidth - 1) / WINDOW_PITCH));
  const phase = -((cols - 1) * WINDOW_PITCH) / 2;
  const margin = 0.5 + WINDOW_WIDTH / 2;
  const kMin = Math.ceil((u0 + margin - phase) / WINDOW_PITCH - 1e-9);
  const kMax = Math.floor((u1 - margin - phase) / WINDOW_PITCH + 1e-9);
  const out: WindowRect[] = [];
  for (let s = 0; s <= topStorey; s++) {
    const slab = s * H;
    const door = panelStoreys.has(s);
    const y0 = slab + (door ? 0.05 : Math.min(0.9, H * 0.3));
    const y1 = slab + Math.min(door ? 2.2 : 2.3, H - 0.3);
    if (y1 - y0 < 0.3) continue;
    for (let k = kMin; k <= kMax; k++) out.push({ x: phase + k * WINDOW_PITCH, y0, y1 });
  }
  return out;
}

/**
 * Railing of one balcony (width w, height h, at railN from the wall) relative to its slab top (y = 0):
 * posts, top and bottom rail, side rails. Null when it does not fit between the wall and the panel plane
 * (panels mounted directly on the facade).
 */
function railingGeometry(w: number, railN: number, h: number): BufferGeometry | null {
  if (!hasRailing(railN)) return null;
  const parts: BufferGeometry[] = [];
  const n = railN - RAIL / 2 - RAIL_CLEARANCE; // ≥ RAIL / 2: clear of the wall
  const add = (sx: number, sy: number, sz: number, x: number, y: number, z: number): void => {
    parts.push(new BoxGeometry(sx, sy, sz).translate(x, y, z));
  };
  add(w, RAIL, RAIL, 0, h - RAIL / 2, n); // handrail (top at the rail top = panel top edge)
  add(w, RAIL * 0.6, RAIL * 0.6, 0, 0.12, n); // bottom rail
  const posts = Math.max(2, Math.ceil(w / MAX_POST_SPACING) + 1);
  for (let i = 0; i < posts; i++) {
    const x = -w / 2 + POST / 2 + (i * (w - POST)) / (posts - 1);
    add(POST, h, POST, x, h / 2, n);
  }
  if (railN > 0.3) {
    for (const side of [-1, 1]) {
      const x = side * (w / 2 - RAIL / 2);
      add(RAIL, RAIL, railN, x, h - RAIL / 2, railN / 2);
      add(POST, h, POST, x, h / 2, POST / 2 + 0.01);
    }
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

export interface BuildingProps {
  palette: ScenePalette;
  dims: SceneDims;
  /** 0 = night … 1 = day: windows glow faintly at night. */
  day: number;
  /** Fade wings of the own building that hide the panel rows (not in the "from the sun" view). */
  fade?: boolean;
}

export const Building = memo(function Building({ palette, dims, day, fade = true }: BuildingProps) {
  const invalidate = useThree((s) => s.invalidate);
  const { railN, balconyWidth, railHeight, storeyHeight, topStorey, own } = dims;
  const bw = dims.buildingWidth;
  const bd = dims.buildingDepth;
  const bh = own ? own.top : dims.buildingHeight;
  // Windows across the facade: the schematic box, or the flat stretch of the own building's facade.
  const u0 = own ? own.u0 : -bw / 2;
  const u1 = own ? own.u1 : bw / 2;
  const doorStoreys = dims.rows.map((r) => r.storey).join(',');
  // A taller real building gets windows up to its roof.
  const windowTop = Math.max(topStorey, Math.floor((bh - storeyHeight) / storeyHeight + 1e-9));

  // The own footprint: the part behind the facade line always opaque, wings in front of it fade (OwnWing).
  const parts = useMemo(() => (own ? ownBodyParts(own) : null), [own]);
  // Keyed on the sizes they use, not on dims: a tilt step changes dims but none of these.
  const body = useMemo(() => {
    if (!parts) return new BoxGeometry(bw, bh, bd).translate(0, bh / 2, -bd / 2);
    return facadePrismGeometry(parts.behind, bh);
  }, [parts, bw, bh, bd]);
  const targets = useMemo(() => (parts && parts.wings.length > 0 ? rowTargets(dims) : []), [parts, dims]);
  const edges = useMemo(() => new EdgesGeometry(body, 20), [body]);
  const windows = useMemo(
    () => windowRects(u0, u1, bw, storeyHeight, windowTop, doorStoreys),
    [u0, u1, bw, storeyHeight, windowTop, doorStoreys],
  );
  const railing = useMemo(
    () => railingGeometry(balconyWidth, railN, railHeight),
    [balconyWidth, railN, railHeight],
  );
  // The slab ends just behind vertical panels (its front would otherwise lie in their plane).
  const slabDepth = railN >= 0.05 ? railN - BEHIND_PANELS : 0;
  const slab = useMemo(
    () => (slabDepth > 0 ? new BoxGeometry(dims.balconyWidth, SLAB_THICKNESS, slabDepth) : null),
    [dims.balconyWidth, slabDepth],
  );
  useEffect(
    () => () => {
      body.dispose();
      edges.dispose();
    },
    [body, edges],
  );
  useEffect(() => () => railing?.dispose(), [railing]);
  useEffect(() => () => slab?.dispose(), [slab]);

  const windowRef = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = windowRef.current;
    if (!mesh) return;
    const m = new Matrix4();
    // Behind the panels' back face when they hang closer to the wall than the usual window offset.
    const n = Math.min(WINDOW_OFFSET, Math.max(0, railN - BEHIND_PANELS));
    windows.forEach((w, i) => {
      m.makeScale(WINDOW_WIDTH, w.y1 - w.y0, 1).setPosition(w.x, (w.y0 + w.y1) / 2, n);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [windows, railN, invalidate]);

  const glow = Math.max(0, 1 - day) * 0.18;

  return (
    <group>
      {/*
        Wall faces pushed back: the coplanar outline wins the depth test (no dashed edges), and so do
        windows and panel fronts in the wall plane (balcony depth 0).
      */}
      <mesh geometry={body} castShadow receiveShadow>
        <meshStandardMaterial
          color={palette.color('wall')}
          roughness={0.92}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={2}
          polygonOffsetUnits={2}
        />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={palette.color('wall-edge')} />
      </lineSegments>
      {parts?.wings.map((ring, i) => (
        <OwnWing
          key={i}
          ring={ring}
          top={bh}
          palette={palette}
          targets={targets}
          facadeAzimuth={dims.facadeAzimuth}
          fade={fade}
        />
      ))}
      {windows.length > 0 && (
        <instancedMesh
          key={windows.length}
          ref={windowRef}
          args={[undefined, undefined, windows.length]}
          receiveShadow
        >
          <planeGeometry args={[1, 1]} />
          <meshStandardMaterial
            color={palette.glass}
            roughness={0.25}
            metalness={0}
            emissive={palette.color('sun')}
            emissiveIntensity={glow}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </instancedMesh>
      )}
      {dims.rows.map((r) => (
        <group key={r.floor} position-y={r.slabZ}>
          {/* A ground-floor slab would be coplanar with the ground (z-fighting): the ground is the terrace. */}
          {slab && r.slabZ >= SLAB_THICKNESS && (
            <mesh geometry={slab} position={[0, -SLAB_THICKNESS / 2, slabDepth / 2]} castShadow receiveShadow>
              <meshStandardMaterial color={palette.color('wall-edge')} roughness={0.9} metalness={0} />
            </mesh>
          )}
          {railing && (
            <mesh geometry={railing} castShadow receiveShadow>
              <meshStandardMaterial color={palette.color('railing')} roughness={0.5} metalness={0.2} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
});
