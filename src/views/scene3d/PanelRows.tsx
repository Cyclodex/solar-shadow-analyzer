import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  MeshStandardMaterial,
  type Material,
  type Mesh,
  type ShaderMaterial,
} from 'three';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import type { InstantState, ShadeRect } from '../../model/types';
import { facadeLocal, panelLocal, panelRotationX } from './coords';
import { Label } from './Label';
import { floorSceneToken, type ScenePalette } from './palette';
import {
  MAX_OVERLAY_RECTS,
  MODULE_THICKNESS,
  OVERLAY_VERTICES_PER_RECT,
  TOUCH_LABEL_MIN_PX,
  modelShadeRects,
  writeOverlayRects,
  type SceneDims,
} from './sceneLayout';
import { createShadeMaterial } from './shadeMaterial';
import { createPanelTexture } from './textures';

// ─────────────────────────────────────────────
// PANEL ROWS (children of the facade group)
// One group per floor at the rail top edge, rotated by the tilt: local x = u, y = −v, z = panel normal.
// Modules are thin boxes whose front face is the model's panel plane; the model's shade rectangles are
// drawn in the same frame just in front of it, so both line up exactly.
// ─────────────────────────────────────────────

const NO_RECTS: readonly ShadeRect[] = [];

interface ShadeOverlayProps {
  rects: readonly ShadeRect[];
  material: ShaderMaterial;
  visible: boolean;
}

/** Preallocated dynamic geometry, rewritten in place when the rectangles change (every time step). */
function ShadeOverlay({ rects, material, visible }: ShadeOverlayProps) {
  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<Mesh>(null);
  const geometry = useMemo(() => {
    const cap = MAX_OVERLAY_RECTS * OVERLAY_VERTICES_PER_RECT;
    const g = new BufferGeometry();
    const attr = (size: number): BufferAttribute =>
      new BufferAttribute(new Float32Array(cap * size), size).setUsage(DynamicDrawUsage);
    g.setAttribute('position', attr(3));
    g.setAttribute('plane', attr(2));
    g.setAttribute('rect', attr(4));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const g = meshRef.current?.geometry;
    if (!g) return;
    const position = g.getAttribute('position') as BufferAttribute;
    const plane = g.getAttribute('plane') as BufferAttribute;
    const rect = g.getAttribute('rect') as BufferAttribute;
    const count = writeOverlayRects(
      rects,
      position.array as Float32Array,
      plane.array as Float32Array,
      rect.array as Float32Array,
    );
    position.needsUpdate = true;
    plane.needsUpdate = true;
    rect.needsUpdate = true;
    g.setDrawRange(0, count);
    invalidate();
  }, [rects, invalidate]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      visible={visible && rects.length > 0}
      renderOrder={3}
      frustumCulled={false}
    />
  );
}

export interface PanelRowsProps {
  palette: ScenePalette;
  dims: SceneDims;
  floors: InstantState['floors'];
  showModelShade: boolean;
  /** Storey label per floor index. */
  labels: readonly string[];
}

export function PanelRows({ palette, dims, floors, showModelShade, labels }: PanelRowsProps) {
  const anisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  const coarse = useMediaQuery('(pointer: coarse)');
  const { layout, rows } = dims;
  const { moduleWidth: w, length: L, tiltFromVertical } = layout;

  const moduleGeometry = useMemo(() => new BoxGeometry(w, L, MODULE_THICKNESS), [w, L]);
  const materials = useMemo(() => {
    const map = createPanelTexture(w, L, palette);
    map.anisotropy = anisotropy;
    const frame = new MeshStandardMaterial({
      color: palette.color('panel-edge'),
      roughness: 0.45,
      metalness: 0.3,
    });
    const front = new MeshStandardMaterial({ map, roughness: 0.62, metalness: 0 });
    const back = new MeshStandardMaterial({ color: palette.color('panel'), roughness: 0.85, metalness: 0 });
    // BoxGeometry groups: +x, −x, +y, −y, +z (front = panel plane), −z (back).
    const list: Material[] = [frame, frame, frame, frame, front, back];
    return { list, map, frame, front, back };
  }, [w, L, palette, anisotropy]);
  const shadeMaterial = useMemo(() => createShadeMaterial(palette), [palette]);
  useEffect(() => () => moduleGeometry.dispose(), [moduleGeometry]);
  useEffect(
    () => () => {
      materials.map.dispose();
      materials.frame.dispose();
      materials.front.dispose();
      materials.back.dispose();
    },
    [materials],
  );
  useEffect(() => () => shadeMaterial.dispose(), [shadeMaterial]);

  const rects = useMemo(() => floors.map((f) => modelShadeRects(f, layout)), [floors, layout]);
  const tilt = panelRotationX(tiltFromVertical);
  const labelU = -layout.rowWidth / 2 - 0.2;

  return (
    <group>
      {rows.map((row) => (
        <group key={row.floor}>
          <group position={facadeLocal({ u: 0, n: row.railN, z: row.railTopZ })} rotation-x={tilt}>
            {layout.modules.map((m, i) => (
              <mesh
                key={i}
                geometry={moduleGeometry}
                material={materials.list}
                position={panelLocal((m.u0 + m.u1) / 2, L / 2, -MODULE_THICKNESS / 2)}
                castShadow
                receiveShadow
              />
            ))}
            <ShadeOverlay
              rects={rects[row.floor] ?? NO_RECTS}
              material={shadeMaterial}
              visible={showModelShade}
            />
          </group>
          <Label
            text={labels[row.floor] ?? ''}
            position={facadeLocal({
              u: labelU,
              // Clear of the wall when the rows hang flat on it (balcony depth 0).
              n: Math.max(row.railN + layout.reach / 2, dims.labelHeight / 2 + 0.05),
              z: row.railTopZ - layout.drop / 2,
            })}
            height={dims.labelHeight}
            minPx={coarse ? TOUCH_LABEL_MIN_PX : 0}
            palette={palette}
            dot={floorSceneToken(row.floor)}
            anchor="right"
          />
        </group>
      ))}
    </group>
  );
}
