import type { FloorPlacement, PanelLayout } from '../../model/types';
import { toRad } from '../../model/units';
import {
  fitUniform,
  pathD,
  rayExit,
  raySegment,
  rectD,
  textWidth,
  type Box,
  type Pt,
  type UniformFit,
} from './geometry2d';
import { SUN_GLYPH_EXTENT } from './primitives';
import { FONT, PAD } from './constants';

// ─────────────────────────────────────────────
// SIDE VIEW LAYOUT (pure, no React)
// Section perpendicular to the facade: n = distance from the facade wall (right), z = height (up), metres,
// one uniform scale. All floors are drawn when they fit at a readable scale, else the analysed pair.
// ─────────────────────────────────────────────

/** Wall thickness and visible interior depth, m. */
export const WALL_T = 0.3;
export const INTERIOR = 0.3;
export const SLAB_T = 0.2;
/** Below this scale (px per m) only the analysed floor pair is drawn. */
export const MIN_SCALE_ALL = 38;

export interface Scene {
  fit: UniformFit;
  /** World extent drawn (n: x0…x1, z: y0…y1), m. */
  world: { x0: number; x1: number; y0: number; y1: number };
  box: Box;
  /** Floors drawn: all, or the analysed pair when all floors would be too small. */
  shown: FloorPlacement[];
  lower: FloorPlacement;
  upper: FloorPlacement | null;
  labelX: number;
  bottom: number;
  panelWidth: number;
}

export function buildScene(
  width: number,
  layout: PanelLayout,
  placements: readonly FloorPlacement[],
  focus: number,
  labelWidth: number,
): Scene {
  const n = placements.length;
  const lowerIdx = n >= 2 ? Math.min(focus, n - 2) : 0;
  const lower = placements[lowerIdx];
  const upper = n >= 2 ? placements[lowerIdx + 1] : null;
  const { drop, reach, floorHeight: H } = layout;
  const railN = lower.railN;
  const nMin = -WALL_T - INTERIOR;
  const nMax = railN + reach + 0.45;
  const extent = (a: FloorPlacement, b: FloorPlacement) => ({
    x0: nMin,
    x1: nMax,
    y0: Math.min(a.slabZ - SLAB_T, a.railTopZ - drop - 0.45),
    y1: b.slabZ + H + 0.05,
  });
  const mL = labelWidth + 20;
  const mR = 36;
  const maxH = Math.min(560, Math.max(280, width * 0.95));
  const box: Box = { x0: PAD + mL, y0: PAD + 6, x1: width - PAD - mR, y1: PAD + 6 + maxH };
  const all = extent(placements[0], placements[n - 1]);
  const fitAll = fitUniform(all, box, 0, 0);
  const showAll = n <= 2 || fitAll.k >= MIN_SCALE_ALL;
  const shown = showAll ? [...placements] : [lower, upper ?? lower];
  const world = showAll ? all : extent(lower, upper ?? lower);
  const fit = fitUniform(world, box, 0, 0);
  return {
    fit,
    world,
    box: { x0: PAD, y0: PAD, x1: width - PAD, y1: fit.box.y1 },
    shown,
    lower,
    upper,
    labelX: fit.x(nMin) - 8,
    bottom: fit.box.y1,
    panelWidth: Math.max(3, Math.min(6, 0.035 * fit.k)),
  };
}

/** The long label if it fits along a dimension line of `px` pixels, else the bare value. */
export function fitLabel(long: string, short: string, lengthPx: number): string {
  return textWidth(long, FONT) <= lengthPx + 16 ? long : short;
}

/**
 * Point on the panel of floor `p` at slope distance v (0 = top edge at the railing), facade frame (n, z):
 * n = railN + v·sin θ, z = railTop − v·cos θ (sin/cos θ from the model's panel normal, exact at 0°/90°).
 */
export function panelPoint(p: FloorPlacement, layout: PanelLayout, v: number): { n: number; z: number } {
  return { n: p.railN + v * layout.normal.z, z: p.railTopZ - v * layout.normal.n };
}

export interface Building {
  interior: string;
  wall: string;
  slabs: string;
  railings: string;
  ground: string | null;
}

export function buildBuilding(scene: Scene, layout: PanelLayout): Building {
  const { fit, shown, world } = scene;
  const { x, y, k } = fit;
  const H = layout.floorHeight;
  const zBottomWorld = world.y0;
  const zTopWorld = world.y1;
  const railN = shown[0].railN;
  const nMin = -WALL_T - INTERIOR;
  const rect = (n0: number, n1: number, zA: number, zB: number): string =>
    rectD(x(n0), y(zB), (n1 - n0) * k, (zB - zA) * k);

  const wall = rect(-WALL_T, 0, zBottomWorld, zTopWorld);

  // Slabs (interior floor + cantilevered balcony), incl. the ceiling above the top shown floor.
  let slabs = '';
  for (const p of shown) slabs += rect(nMin, railN, p.slabZ - SLAB_T, p.slabZ);
  const top = shown[shown.length - 1];
  slabs += rect(nMin, railN, top.slabZ + H - SLAB_T, Math.min(zTopWorld, top.slabZ + H));

  let railings = '';
  for (const p of shown) {
    railings += pathD([
      { x: x(railN), y: y(p.slabZ) },
      { x: x(railN), y: y(p.railTopZ) },
    ]);
  }
  return {
    interior: rect(nMin, -WALL_T, zBottomWorld, zTopWorld),
    wall,
    slabs,
    railings,
    ground: zBottomWorld < 0 ? rectD(x(0), y(0), fit.box.x1 - x(0), (0 - zBottomWorld) * k) : null,
  };
}

export interface RayGeometry {
  from: Pt;
  to: Pt;
  sun: Pt;
  origin: Pt;
}

/** Sun ray through `origin` at profile angle `p`: outward part to the drawing edge, inward part to the lower panel/wall. */
export function sunRay(
  origin: Pt,
  profileDeg: number,
  box: Box,
  wallX: number,
  lowerPanel: [Pt, Pt] | null,
): RayGeometry | null {
  const a = toRad(profileDeg);
  const dir = { x: Math.cos(a), y: -Math.sin(a) };
  const glyph = 8 * SUN_GLYPH_EXTENT + 2;
  const inner: Box = { x0: box.x0 + glyph, y0: box.y0 + glyph, x1: box.x1 - glyph, y1: box.y1 - 2 };
  const out = rayExit(origin, dir, inner);
  if (!out) return null;
  const back = { x: -dir.x, y: -dir.y };
  let to: Pt | null = null;
  if (lowerPanel) {
    const hit = raySegment(origin, back, lowerPanel[0], lowerPanel[1]);
    if (hit) to = { x: origin.x + back.x * hit.t, y: origin.y + back.y * hit.t };
  }
  to ??= rayExit(origin, back, { x0: Math.max(box.x0, wallX), y0: box.y0, x1: box.x1, y1: box.y1 });
  const sun = out;
  const from = { x: out.x - dir.x * glyph, y: out.y - dir.y * glyph };
  return { from, to: to ?? origin, sun, origin };
}

/** Screen geometry of the analysed pair (static per config and width). */
export interface PairGeometry {
  /** Panel point of floor `fp` at slope distance v (m) on screen. */
  P: (fp: FloorPlacement, v: number) => Pt;
  lowerTop: Pt;
  lowerSeg: [Pt, Pt];
  /** Lower edge of the upper panel (null for a single floor). */
  upperBottom: Pt | null;
  /** End of the critical-angle ray (null if there is no meaningful critical angle). */
  criticalEnd: Pt | null;
  /** θ vertex (top edge of the upper or single panel) and β vertex (tip of the lower panel). */
  pivot: Pt;
  tip: Pt;
  arcR: number;
  /** Screen offsets perpendicular to the panel: towards the sun side (8 px) and towards the railing. */
  front: Pt;
  back: Pt;
  gapX: number;
  panelPx: number;
  showBeta: boolean;
}

export function buildPair(scene: Scene, layout: PanelLayout): PairGeometry {
  const { fit, lower, upper } = scene;
  const P = (fp: FloorPlacement, v: number): Pt => {
    const q = panelPoint(fp, layout, v);
    return { x: fit.x(q.n), y: fit.y(q.z) };
  };
  const L = layout.length;
  const lowerTop = P(lower, 0);
  const upperBottom = upper ? P(upper, L) : null;
  const meaningful = upperBottom !== null && layout.verticalGap >= 0 && layout.reach > 1e-6;
  const criticalEnd = meaningful
    ? rayExit(lowerTop, { x: upperBottom.x - lowerTop.x, y: upperBottom.y - lowerTop.y }, scene.box)
    : null;
  // Panel normal (n, z) = (cos θ, sin θ); on screen y points down.
  const { n: cosT, z: sinT } = layout.normal;
  const panelPx = L * fit.k;
  return {
    P,
    lowerTop,
    lowerSeg: [lowerTop, P(lower, L)],
    upperBottom,
    criticalEnd,
    pivot: P(upper ?? lower, 0),
    tip: P(lower, L),
    arcR: Math.max(14, Math.min(30, 0.4 * panelPx)),
    front: { x: cosT * 8, y: -sinT * 8 },
    back: { x: -cosT * scene.panelWidth, y: sinT * scene.panelWidth },
    gapX: fit.x(lower.railN + layout.reach) + 14,
    panelPx,
    // β sits at the lower panel's tip; skip it where it would crowd the θ label (short single panel).
    showBeta: layout.tiltFromHorizontal >= 2 && (upper !== null ? panelPx >= 40 : panelPx >= 90),
  };
}
