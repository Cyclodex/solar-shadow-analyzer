import { criticalAngleKind } from '../../model/geometry';
import type { FloorPlacement, PanelLayout } from '../../model/types';
import { toRad } from '../../model/units';
import {
  boxesOverlap,
  clampLabelX,
  fitUniform,
  labelBox,
  pathD,
  rayExit,
  raySegment,
  rectD,
  segmentHitsBox,
  textWidth,
  type PlacedText,
  type Box,
  type Pt,
  type Segment,
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
    // Floor labels end left of the rotated floor-height label, which reaches ~15 px left of its line at
    // n = −WALL_T − INTERIOR/2 (at most 11 px further left than usual: within the margin's 12 px spare).
    labelX: Math.min(fit.x(nMin) - 8, fit.x(-WALL_T - INTERIOR / 2) - 19),
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

/**
 * Sun ray through `origin` at profile angle `p`. Outward part: to the drawing edge (where the sun glyph
 * sits). Inward part (towards the facade): to the nearest of `obstacles` (panels, slabs, railings), else to
 * the facade wall or the drawing edge. `obstacles` null = the ray ends at `origin` (absorbed there).
 */
export function sunRay(
  origin: Pt,
  profileDeg: number,
  box: Box,
  wallX: number,
  obstacles: readonly Segment[] | null,
): RayGeometry | null {
  const a = toRad(profileDeg);
  const dir = { x: Math.cos(a), y: -Math.sin(a) };
  const glyph = 8 * SUN_GLYPH_EXTENT + 2;
  const inner: Box = { x0: box.x0 + glyph, y0: box.y0 + glyph, x1: box.x1 - glyph, y1: box.y1 - 2 };
  const out = rayExit(origin, dir, inner);
  if (!out) return null;
  const back = { x: -dir.x, y: -dir.y };
  let to = origin;
  if (obstacles) {
    let tMin = Infinity;
    for (const [p, q] of obstacles) {
      const hit = raySegment(origin, back, p, q);
      if (hit && hit.t < tMin) tMin = hit.t;
    }
    const facade: Box = { x0: Math.max(box.x0, wallX), y0: box.y0, x1: box.x1, y1: box.y1 };
    to = Number.isFinite(tMin)
      ? { x: origin.x + back.x * tMin, y: origin.y + back.y * tMin }
      : (rayExit(origin, back, facade) ?? origin);
  }
  const sun = out;
  const from = { x: out.x - dir.x * glyph, y: out.y - dir.y * glyph };
  return { from, to, sun, origin };
}

/** Vertical offset of the reach dimension line below the lower panel's tip, px. */
export const REACH_DIM_DY = 14;

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
  /** Reach dimension below the lower panel (only when it is long enough to read). */
  showReach: boolean;
  /** Where the drawn sun ray meets the panels: lower edge of the upper panel, or the single panel's middle. */
  rayOrigin: Pt;
  /**
   * Opaque segments the inward part of the sun ray ends on: slab tops, slab fronts with the railings and the
   * panels below the ray origin. Null for a single floor: the ray ends on the panel it lights.
   */
  rayObstacles: Segment[] | null;
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
  const meaningful = upperBottom !== null && criticalAngleKind(layout, true) === 'angle';
  const criticalEnd = meaningful
    ? rayExit(lowerTop, { x: upperBottom.x - lowerTop.x, y: upperBottom.y - lowerTop.y }, scene.box)
    : null;
  // Panel normal (n, z) = (cos θ, sin θ); on screen y points down.
  const { n: cosT, z: sinT } = layout.normal;
  const panelPx = L * fit.k;
  // The ray only runs down towards the facade, so slab undersides and the ceiling never stop it; the upper
  // panel is left out because the ray starts on it.
  const obstacles: Segment[] = [];
  for (const p of scene.shown) {
    obstacles.push([fit.p(0, p.slabZ), fit.p(p.railN, p.slabZ)]);
    obstacles.push([fit.p(p.railN, p.slabZ - SLAB_T), fit.p(p.railN, p.railTopZ)]);
    if (p.floor !== upper?.floor) obstacles.push([P(p, 0), P(p, L)]);
  }
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
    showReach: layout.reach * fit.k > 14,
    rayOrigin: upperBottom ?? P(lower, L / 2),
    rayObstacles: upper ? obstacles : null,
  };
}

/**
 * Reach label below its dimension line: centred on the line, but never left of the railing, where it would
 * run into the balcony slab; kept inside the drawing.
 */
export function reachLabel(scene: Scene, pair: PairGeometry, text: string): PlacedText {
  const rail = scene.fit.x(scene.lower.railN);
  const w = textWidth(text, FONT);
  const centred = (rail + pair.tip.x) / 2 - w / 2;
  const x = Math.min(Math.max(centred, rail + 4), scene.box.x1 - w);
  return { x, y: pair.tip.y + REACH_DIM_DY + 14, anchor: 'start', text };
}

/** Estimated screen box of a placed label (FONT). */
export function placedBox(l: PlacedText): Box {
  return labelBox(l.x, l.y, textWidth(l.text, FONT), l.anchor, FONT);
}

/**
 * θ label: on the wall side of the vertical guide below the pivot (inside the balcony, clear of the panel
 * it measures), kept above the balcony floor. Without room between wall and railing (shallow balcony) it
 * goes in front of the panel, next to the arc.
 */
export function thetaLabel(scene: Scene, pair: PairGeometry, layout: PanelLayout, text: string): PlacedText {
  const { fit } = scene;
  const { pivot, arcR } = pair;
  const floor = scene.upper ?? scene.lower;
  // Clear of the railing stroke and of a near-vertical panel's thickness (drawn towards the railing).
  const inside: PlacedText = {
    x: pivot.x - scene.panelWidth - 3,
    y: Math.min(pivot.y + arcR + 4, fit.y(floor.slabZ) - 5),
    anchor: 'end',
    text,
  };
  if (placedBox(inside).x0 >= fit.x(0) + 4) return inside;
  // Point on the panel at the arc radius (down the slope: n += sin θ, z −= cos θ), pushed off its front face.
  const onPanel = { x: pivot.x + layout.normal.z * arcR, y: pivot.y + layout.normal.n * arcR };
  return {
    x: onPanel.x + pair.front.x * 1.5,
    y: onPanel.y + pair.front.y * 1.5 + 4,
    anchor: 'start',
    text,
  };
}

/**
 * Critical-angle label, clear of the gap dimension, the wall, the upper floor and the drawing edge: on the
 * arc's bisector when that is free, else on the other side of the critical ray (in the air above the lower
 * railing), with the bare value (`short`) where the long text does not fit. Null without a critical ray.
 */
export function criticalLabel(
  scene: Scene,
  pair: PairGeometry,
  layout: PanelLayout,
  long: string,
  short: string,
): PlacedText | null {
  const { fit, upper, box } = scene;
  if (!pair.criticalEnd || !upper || !pair.upperBottom) return null;
  const c = toRad(layout.criticalProfileAngle);
  const lt = pair.lowerTop;
  const lr = pair.arcR + 16;
  const blocked: Box[] = [
    // Gap dimension: line with ±3 px ticks, rotated label right of it, extension lines at both ends.
    { x0: pair.gapX - 6, y0: pair.upperBottom.y - 3, x1: pair.gapX + 18, y1: lt.y + 3 },
    // Upper balcony slab.
    {
      x0: fit.x(-WALL_T - INTERIOR),
      y0: fit.y(upper.slabZ) - 2,
      x1: fit.x(upper.railN) + 2,
      y1: fit.y(upper.slabZ - SLAB_T) + 2,
    },
  ];
  const segments: Segment[] = [
    [fit.p(upper.railN, upper.slabZ), fit.p(upper.railN, upper.railTopZ)],
    [pair.P(upper, 0), pair.upperBottom],
    // Extension lines of the gap dimension.
    [pair.upperBottom, { x: pair.gapX, y: pair.upperBottom.y }],
    [lt, { x: pair.gapX, y: lt.y }],
  ];
  const free = (l: PlacedText): boolean => {
    const b = placedBox(l);
    if (b.x0 < Math.max(box.x0, fit.x(0) + 4) || b.x1 > box.x1 || b.y0 < box.y0) return false;
    return !blocked.some((o) => boxesOverlap(b, o)) && !segments.some((sg) => segmentHitsBox(sg, b));
  };
  const mid = -c / 2;
  const onBisector = (text: string): PlacedText => ({
    x: lt.x + Math.cos(mid) * lr,
    y: lt.y + Math.sin(mid) * lr + 4,
    anchor: 'start',
    text,
  });
  // Other side of the ray: the text's bottom-right corner stays 5 px left of the dashed ray.
  const fy = lt.y - lr * Math.sin(c) + 4;
  const flipped = (text: string): PlacedText => ({
    x: lt.x + (lt.y - (fy + 3)) / Math.tan(c) - 5,
    y: fy,
    anchor: 'end',
    text,
  });
  // Last choice: beside the ray beyond the upper panel's lower edge (open air on the sun side).
  const q = { x: pair.upperBottom.x + Math.cos(c) * 24, y: pair.upperBottom.y - Math.sin(c) * 24 };
  const beyond = (text: string): PlacedText => ({
    x: q.x + 6 / Math.tan(c) + 5,
    y: q.y + 4,
    anchor: 'start',
    text,
  });
  const best = [
    onBisector(long),
    flipped(long),
    flipped(short),
    onBisector(short),
    beyond(long),
    beyond(short),
  ].find(free);
  if (best) return best;
  const last = flipped(short);
  return { ...last, x: clampLabelX(last.x, textWidth(short, FONT), 'end', box.x0, box.x1) };
}
