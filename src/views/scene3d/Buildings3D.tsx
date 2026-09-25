import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Float32BufferAttribute, type Color } from 'three';
import type { FacadeVector } from '../../model/types';
import { facadeToEnu } from './coords';
import type { ScenePalette } from './palette';
import {
  blockingPrisms,
  prismBoxes,
  prismMesh,
  rangeIndex,
  type EnuPoint,
  type PrismKind,
  type ScenePrism,
} from './buildingsGeometry';

// ─────────────────────────────────────────────
// SURROUNDING BUILDINGS IN 3D (owned by the buildings feature, docs/ARCHITECTURE.md "Umgebung")
// Imported and manual buildings as extruded prisms in world coordinates (the facade origin is the world
// origin): one merged triangle list with per-vertex colours (swisstopo like the obstacles, edited ones warm,
// manual ones green, as in the site plan; removed and own ones are not passed in), casting and receiving
// shadows. Two index buffers over the same vertices split it into an opaque and a faded mesh: prisms that
// hide the panel rows from the camera fade like the obstacles (not in the "from the sun" view).
// ─────────────────────────────────────────────

/** Opacity of a prism that hides part of the panel rows. */
const FADED_OPACITY = 0.22;
/** Camera movement (m) below which the view test is not repeated. */
const CAMERA_EPS = 0.05;

export interface Buildings3DProps {
  prisms: readonly ScenePrism[];
  palette: ScenePalette;
  /** Points of the panel rows (facade frame) the prisms should not hide. */
  targets: readonly FacadeVector[];
  facadeAzimuth: number;
  /** Fade prisms that hide the panel rows. */
  fade: boolean;
}

function kindColor(kind: PrismKind, palette: ScenePalette): Color {
  if (kind === 'edited') return palette.neighbourEdited;
  if (kind === 'manual') return palette.neighbourManual;
  return palette.obstacle;
}

/** Surrounding buildings in the 3D scene (inside <Canvas>, world frame). */
export const Buildings3D = memo(function Buildings3D({
  prisms,
  palette,
  targets,
  facadeAzimuth,
  fade,
}: Buildings3DProps) {
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useMemo(() => prismMesh(prisms), [prisms]);
  const boxes = useMemo(() => prismBoxes(prisms), [prisms]);
  const enuTargets = useMemo(
    () => targets.map((p): EnuPoint => facadeToEnu(p, facadeAzimuth)),
    [targets, facadeAzimuth],
  );

  // Shared vertex attributes; the opaque and faded meshes (and outlines) differ only in their index.
  const geometries = useMemo(() => {
    const position = new Float32BufferAttribute(mesh.positions, 3);
    const normal = new Float32BufferAttribute(mesh.normals, 3);
    const color = new Float32BufferAttribute(new Float32Array(mesh.positions.length), 3);
    const make = (): BufferGeometry => {
      const g = new BufferGeometry();
      g.setAttribute('position', position);
      g.setAttribute('normal', normal);
      g.setAttribute('color', color);
      return g;
    };
    const linePosition = new Float32BufferAttribute(mesh.lines, 3);
    const makeLines = (): BufferGeometry => {
      const g = new BufferGeometry();
      g.setAttribute('position', linePosition);
      return g;
    };
    return { opaque: make(), faded: make(), opaqueLines: makeLines(), fadedLines: makeLines(), color };
  }, [mesh]);
  useEffect(
    () => () => {
      geometries.opaque.dispose();
      geometries.faded.dispose();
      geometries.opaqueLines.dispose();
      geometries.fadedLines.dispose();
    },
    [geometries],
  );

  // Colours per prism kind (re-written for a new palette).
  useLayoutEffect(() => {
    const { color } = geometries;
    const arr = color.array as Float32Array;
    mesh.triangles.forEach((r, i) => {
      const c = kindColor(prisms[i].kind, palette);
      for (let v = r.start; v < r.start + r.count; v++) {
        arr[3 * v] = c.r;
        arr[3 * v + 1] = c.g;
        arr[3 * v + 2] = c.b;
      }
    });
    color.needsUpdate = true;
    invalidate();
  }, [geometries, mesh, prisms, palette, invalidate]);

  /** Faded prisms of the current index split, and the camera position of the last view test. */
  const appliedKey = useRef<string | null>(null);
  const lastCamera = useRef<EnuPoint | null>(null);
  const applySplit = (faded: ReadonlySet<number>): void => {
    const key = [...faded].join(',');
    if (appliedKey.current === key) return;
    const { opaque, faded: fadedGeom, opaqueLines, fadedLines } = geometries;
    opaque.setIndex(
      new BufferAttribute(
        rangeIndex(mesh.triangles, (i) => !faded.has(i)),
        1,
      ),
    );
    fadedGeom.setIndex(
      new BufferAttribute(
        rangeIndex(mesh.triangles, (i) => faded.has(i)),
        1,
      ),
    );
    opaqueLines.setIndex(
      new BufferAttribute(
        rangeIndex(mesh.lineRanges, (i) => !faded.has(i)),
        1,
      ),
    );
    fadedLines.setIndex(
      new BufferAttribute(
        rangeIndex(mesh.lineRanges, (i) => faded.has(i)),
        1,
      ),
    );
    opaque.computeBoundingSphere();
    fadedGeom.computeBoundingSphere();
    appliedKey.current = key;
  };
  // New geometry: nothing faded until the first frame tests the view (also for a PNG export).
  useLayoutEffect(() => {
    appliedKey.current = null;
    lastCamera.current = null;
    applySplit(new Set());
    invalidate();
    // applySplit reads only the geometries and the mesh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometries, mesh, invalidate]);
  // Another fade mode (the sun view) or other panel rows: test again at the next frame.
  useEffect(() => {
    lastCamera.current = null;
    invalidate();
  }, [fade, enuTargets, invalidate]);

  useFrame(({ camera }) => {
    const cam: EnuPoint = { x: camera.position.x, y: -camera.position.z, z: camera.position.y };
    const last = lastCamera.current;
    if (
      last &&
      Math.abs(last.x - cam.x) < CAMERA_EPS &&
      Math.abs(last.y - cam.y) < CAMERA_EPS &&
      Math.abs(last.z - cam.z) < CAMERA_EPS
    ) {
      return;
    }
    lastCamera.current = cam;
    applySplit(fade ? blockingPrisms(cam, enuTargets, prisms, boxes) : new Set<number>());
  });

  if (prisms.length === 0) return null;
  const edge = palette.color('wall-edge');
  return (
    <group>
      {/* Faces pushed back slightly: the coplanar outline wins the depth test (no dashed edges). */}
      <mesh geometry={geometries.opaque} castShadow receiveShadow>
        <meshStandardMaterial
          vertexColors
          roughness={0.95}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <mesh geometry={geometries.faded} castShadow receiveShadow>
        <meshStandardMaterial
          vertexColors
          roughness={0.95}
          metalness={0}
          transparent
          opacity={FADED_OPACITY}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={geometries.opaqueLines}>
        <lineBasicMaterial color={edge} />
      </lineSegments>
      <lineSegments geometry={geometries.fadedLines}>
        <lineBasicMaterial color={edge} transparent opacity={FADED_OPACITY} depthWrite={false} />
      </lineSegments>
    </group>
  );
});
