import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry, Matrix4, type BufferGeometry, type InstancedMesh } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ScenePalette } from './palette';
import { SLAB_THICKNESS, type SceneDims } from './sceneLayout';

// ─────────────────────────────────────────────
// BUILDING AND BALCONIES (children of the facade group: x = u, y = z, z = n; facade wall at z = 0)
// ─────────────────────────────────────────────

const WINDOW_WIDTH = 1.3;
const WINDOW_PITCH = 2.6;
const WINDOW_OFFSET = 0.012;
const RAIL = 0.05;
const POST = 0.04;
const MAX_POST_SPACING = 1.3;
/** Clearance between the railing front and the panel plane (no z-fighting with vertical panels), m. */
const RAIL_CLEARANCE = 0.015;

interface WindowRect {
  x: number;
  y0: number;
  y1: number;
}

/** Window openings per storey (balcony doors on panel floors). */
function windowRects(dims: SceneDims): WindowRect[] {
  const { buildingWidth, storeyHeight: H, topStorey, rows } = dims;
  const panelStoreys = new Set(rows.map((r) => r.storey));
  const cols = Math.max(1, Math.floor((buildingWidth - 1) / WINDOW_PITCH));
  const span = (cols - 1) * WINDOW_PITCH;
  const out: WindowRect[] = [];
  for (let s = 0; s <= topStorey; s++) {
    const slab = s * H;
    const door = panelStoreys.has(s);
    const y0 = slab + (door ? 0.05 : Math.min(0.9, H * 0.3));
    const y1 = slab + Math.min(door ? 2.2 : 2.3, H - 0.3);
    if (y1 - y0 < 0.3) continue;
    for (let c = 0; c < cols; c++) out.push({ x: -span / 2 + c * WINDOW_PITCH, y0, y1 });
  }
  return out;
}

/** Railing of one balcony relative to its slab top (y = 0): posts, top and bottom rail, side rails. */
function railingGeometry(dims: SceneDims): BufferGeometry {
  const { balconyWidth: w, railN, railHeight: h } = dims;
  const parts: BufferGeometry[] = [];
  const n = Math.max(RAIL / 2, railN - RAIL / 2 - RAIL_CLEARANCE);
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
}

export const Building = memo(function Building({ palette, dims, day }: BuildingProps) {
  const invalidate = useThree((s) => s.invalidate);
  const { buildingWidth: bw, buildingHeight: bh, buildingDepth: bd } = dims;

  const body = useMemo(() => new BoxGeometry(bw, bh, bd), [bw, bh, bd]);
  const edges = useMemo(() => new EdgesGeometry(body), [body]);
  const windows = useMemo(() => windowRects(dims), [dims]);
  const railing = useMemo(() => railingGeometry(dims), [dims]);
  const slab = useMemo(
    () => (dims.railN >= 0.05 ? new BoxGeometry(dims.balconyWidth, SLAB_THICKNESS, dims.railN) : null),
    [dims],
  );
  useEffect(
    () => () => {
      body.dispose();
      edges.dispose();
    },
    [body, edges],
  );
  useEffect(() => () => railing.dispose(), [railing]);
  useEffect(() => () => slab?.dispose(), [slab]);

  const windowRef = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = windowRef.current;
    if (!mesh) return;
    const m = new Matrix4();
    windows.forEach((w, i) => {
      m.makeScale(WINDOW_WIDTH, w.y1 - w.y0, 1).setPosition(w.x, (w.y0 + w.y1) / 2, WINDOW_OFFSET);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [windows, invalidate]);

  const glow = Math.max(0, 1 - day) * 0.18;

  return (
    <group>
      <mesh geometry={body} position={[0, bh / 2, -bd / 2]} castShadow receiveShadow>
        <meshStandardMaterial color={palette.color('wall')} roughness={0.92} metalness={0} />
      </mesh>
      <lineSegments geometry={edges} position={[0, bh / 2, -bd / 2]}>
        <lineBasicMaterial color={palette.color('wall-edge')} />
      </lineSegments>
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
          />
        </instancedMesh>
      )}
      {dims.rows.map((r) => (
        <group key={r.floor} position-y={r.slabZ}>
          {/* A ground-floor slab would be coplanar with the ground (z-fighting): the ground is the terrace. */}
          {slab && r.slabZ >= SLAB_THICKNESS && (
            <mesh
              geometry={slab}
              position={[0, -SLAB_THICKNESS / 2, dims.railN / 2]}
              castShadow
              receiveShadow
            >
              <meshStandardMaterial color={palette.color('wall-edge')} roughness={0.9} metalness={0} />
            </mesh>
          )}
          <mesh geometry={railing} castShadow receiveShadow>
            <meshStandardMaterial color={palette.color('railing')} roughness={0.5} metalness={0.2} />
          </mesh>
        </group>
      ))}
    </group>
  );
});
