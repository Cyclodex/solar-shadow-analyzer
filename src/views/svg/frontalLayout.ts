import { compassPoint, floorLabel, type Format, type Lang } from '../../i18n';
import { panelsOverlap } from '../../model/geometry';
import { horizonAt } from '../../model/horizon';
import type { SolarPathPoint } from '../../model/sun';
import type { FloorPlacement, HorizonProfile, InstantState, PanelLayout } from '../../model/types';
import { angleDiff, normalizeDeg } from '../../model/units';
import {
  boxHitsCircle,
  boxesOverlap,
  clipPolyline,
  fitUniform,
  labelBox,
  pathD,
  polylinesD,
  rectD,
  textWidth,
  type Box,
  type Pt,
  type UniformFit,
} from './geometry2d';
import { FONT, PAD } from './constants';

// ─────────────────────────────────────────────
// FRONT VIEW LAYOUT (pure, no React)
// Sky window: x = azimuth relative to the facade normal, mirrored so that "left/right" matches a viewer
// outside looking at the facade (x = centre − rel·k), y = altitude; one px-per-degree scale for both.
// Facade: to scale in metres (u right, z up), auto-fitted below the sky window.
// ─────────────────────────────────────────────

/** Half width of the sky window in degrees of relative azimuth (±90° = facade plane). */
export const REL_MAX = 120;
export const SUN_R = 7;
export const AXIS_ROW = 18;
/** Slab thickness drawn at the balcony edge, m. */
export const SLAB_T = 0.18;

// ── Sky ──────────────────────────────────────

export interface HourMark {
  x: number;
  y: number;
  label: string | null;
}

export interface Sky {
  box: Box;
  x: (rel: number) => number;
  y: (alt: number) => number;
  altTicks: number[];
  selected: string;
  refs: string;
  hours: HourMark[];
  horizon: string | null;
  lowHorizon: string | null;
  compass: { x: number; label: string; strong: boolean }[];
  /** y below the compass axis row. */
  bottom: number;
}

export function maxAltitude(paths: readonly (readonly SolarPathPoint[])[]): number {
  let m = 0;
  for (const p of paths) for (const q of p) m = Math.max(m, q.sun.altitude);
  return m;
}

export function horizonSamples(profile: HorizonProfile, facadeAz: number): { rel: number; el: number }[] {
  const out: { rel: number; el: number }[] = [];
  for (let rel = -REL_MAX; rel <= REL_MAX; rel += 1) {
    out.push({ rel, el: horizonAt(profile, normalizeDeg(facadeAz + rel)) });
  }
  return out;
}

export function buildSky(
  width: number,
  facadeAz: number,
  selected: readonly SolarPathPoint[],
  refs: readonly (readonly SolarPathPoint[])[],
  topHorizon: HorizonProfile | undefined,
  lowHorizon: HorizonProfile | undefined,
  lang: Lang,
): Sky {
  const x0 = PAD + 30;
  const x1 = width - PAD - 6;
  const kDeg = (x1 - x0) / (2 * REL_MAX);
  // Altitude range: the year's highest sun (solstices) or the selected day, whichever is higher.
  const altTop = Math.min(90, Math.max(20, Math.ceil((maxAltitude([selected, ...refs]) + 6) / 10) * 10));
  const y0 = PAD + 16;
  const y1 = y0 + altTop * kDeg;
  const box: Box = { x0, y0, x1, y1 };
  const cx = (x0 + x1) / 2;
  const x = (rel: number): number => cx - rel * kDeg;
  const y = (alt: number): number => y1 - alt * kDeg;
  const toScreen = (p: SolarPathPoint): Pt => ({
    x: x(angleDiff(p.sun.azimuth, facadeAz)),
    y: y(p.sun.altitude),
  });
  // Relative azimuth wraps at ±180°: never connect across the wrap.
  const wraps = (a: Pt, b: Pt): boolean => Math.abs(a.x - b.x) > 180 * kDeg;
  const pathOf = (pts: readonly SolarPathPoint[]): string =>
    polylinesD(clipPolyline(pts.map(toScreen), box, wraps));

  const hours: HourMark[] = [];
  let lastLabel: Pt | null = null;
  for (const p of selected) {
    // The path's 24:00 point closes the curve but is the next day's 0:00 (polar day: same place as "0").
    if (p.minutes % 60 !== 0 || p.minutes >= 1440 || p.sun.altitude <= 0) continue;
    const q = toScreen(p);
    if (q.x < x0 || q.x > x1) continue;
    const label =
      lastLabel && Math.hypot(q.x - lastLabel.x, q.y - lastLabel.y) < 17 ? null : String(p.minutes / 60);
    if (label) lastLabel = q;
    hours.push({ ...q, label });
  }

  const area = (profile: HorizonProfile | undefined): { d: string; line: string } | null => {
    if (!profile) return null;
    const samples = horizonSamples(profile, facadeAz);
    const max = samples.reduce((m, v) => Math.max(m, v.el), 0);
    if (max < 0.05) return null;
    const pts = samples.map((v) => ({ x: x(v.rel), y: y(Math.min(altTop, Math.max(0, v.el))) }));
    const d = pathD([{ x: x(-REL_MAX), y: y1 }, ...pts, { x: x(REL_MAX), y: y1 }], true);
    return { d, line: pathD(pts) };
  };
  const top = area(topHorizon);
  const low = lowHorizon && lowHorizon !== topHorizon ? area(lowHorizon) : null;
  // Only show the lowest floor's horizon when it differs visibly from the top floor's.
  const lowDiffers =
    low !== null &&
    topHorizon !== undefined &&
    lowHorizon !== undefined &&
    horizonSamples(lowHorizon, facadeAz).some(
      (v) => Math.abs(v.el - horizonAt(topHorizon, normalizeDeg(facadeAz + v.rel))) > 0.25,
    );

  const step = altTop <= 40 ? 10 : 30;
  const altTicks: number[] = [];
  for (let a = step; a < altTop; a += step) altTicks.push(a);

  const allCompass = [-90, -45, 0, 45, 90].map((rel) => {
    const az = normalizeDeg(facadeAz + rel);
    return {
      x: x(rel),
      label: rel === 0 ? `${compassPoint(az, lang)} ${Math.round(az)}°` : compassPoint(az, lang),
      strong: rel === 0,
    };
  });
  // Narrow figures (320 px phones): leave out a direction that would run into the bold facade direction
  // (estimated bold width, 4 px clear on each side).
  const main = allCompass[2];
  const mainBox = labelBox(main.x, 0, textWidth(main.label, FONT) * 1.12 + 8, 'middle', FONT);
  const compass = allCompass.filter(
    (c) => c.strong || !boxesOverlap(labelBox(c.x, 0, textWidth(c.label, FONT), 'middle', FONT), mainBox),
  );

  return {
    box,
    x,
    y,
    altTicks,
    selected: pathOf(selected),
    refs: refs.map(pathOf).join(''),
    hours,
    horizon: top?.d ?? null,
    lowHorizon: lowDiffers && low ? low.line : null,
    compass,
    bottom: y1 + AXIS_ROW + 8,
  };
}

/** A hour label's final position (baseline, centred). */
export interface HourLabel {
  x: number;
  y: number;
  label: string;
}

/** Font size of the hour labels (svg.module.css `.small`). */
const HOUR_FONT = 10;

/**
 * Hour labels above their dots (below near the top edge). Where the current sun glyph (circle of radius
 * `ext` around `sun`) would cover a label, it moves just above the glyph, or below it near the top edge.
 */
export function hourLabels(sky: Sky, sun: Pt | null, ext: number): HourLabel[] {
  const top = sky.box.y0 + 4;
  return sky.hours.flatMap((h) => {
    if (!h.label) return [];
    const w = textWidth(h.label, HOUR_FONT);
    let y = h.y - 7 < top ? h.y + 15 : h.y - 7;
    if (sun && boxHitsCircle(labelBox(h.x, y, w, 'middle', HOUR_FONT), sun, ext + 1)) {
      const above = sun.y - ext - 4;
      y = above >= top ? above : sun.y + ext + 11;
    }
    return [{ x: h.x, y, label: h.label }];
  });
}

// ── Facade ───────────────────────────────────

export interface FloorGeometry {
  floor: number;
  label: string;
  /** Label baseline centre (panel row middle). */
  yMid: number;
  modules: string;
}

export interface Facade {
  fit: UniformFit;
  wall: string;
  cut: string | null;
  ground: { y: number } | null;
  openings: string;
  mullions: string;
  slabs: string;
  railTops: string;
  balusters: string;
  overlap: string;
  floors: FloorGeometry[];
  leftX: number;
  rightX: number;
  bottom: number;
}

export function buildFacade(
  width: number,
  top: number,
  layout: PanelLayout,
  placements: readonly FloorPlacement[],
  lang: Lang,
): Facade {
  const labels = placements.map((p) => floorLabel(p.storey, lang));
  const leftCol = Math.max(...labels.map((l) => textWidth(l, FONT))) + 22;
  const rightCol = textWidth('100 %', FONT) + 14;
  const { rowWidth, drop, floorHeight: H } = layout;
  const lowest = placements[0];
  const highest = placements[placements.length - 1];
  const side = Math.max(0.4, rowWidth * 0.15);
  const halfW = rowWidth / 2 + side;
  const balcHalf = rowWidth / 2 + Math.min(0.12, side / 2);
  const panelBottom = lowest.railTopZ - drop;
  const onGround = lowest.storey === 0;
  const zBottom = Math.min(onGround ? 0 : lowest.slabZ - 0.4 * H, panelBottom - 0.15);
  const zTop = highest.slabZ + H;
  const floorsShown = zTop - zBottom;
  const maxH = Math.min(560, Math.max(220, width * 0.58) + Math.max(0, floorsShown / H - 3) * 26);
  const box: Box = { x0: PAD + leftCol, y0: top, x1: width - PAD - rightCol, y1: top + maxH };
  const fit = fitUniform({ x0: -halfW, x1: halfW, y0: zBottom, y1: zTop }, box, 0.5, 0);
  const { x, y, k } = fit;
  const rect = (u0: number, u1: number, z0: number, z1: number, minH = 0): string => {
    const h = Math.max(minH, (z1 - z0) * k);
    return rectD(x(u0), y(z1), (u1 - u0) * k, h);
  };

  // Glazed balcony front (door + windows) behind the railing, with mullions about every metre.
  const glassHalf = Math.max(Math.min(balcHalf - 0.15, 1.6), Math.min(0.45, balcHalf * 0.8));
  const panes = Math.max(1, Math.round((2 * glassHalf) / 1.1));
  let openings = '';
  let mullions = '';
  let slabs = '';
  let railTops = '';
  let balusters = '';
  const spacing = Math.max(0.11, 7 / k);
  const floors: FloorGeometry[] = placements.map((p, i) => {
    const glassTop = p.slabZ + Math.min(2.2, H - 0.45);
    openings += rect(-glassHalf, glassHalf, p.slabZ, glassTop);
    for (let j = 1; j < panes; j++) {
      const u = -glassHalf + (2 * glassHalf * j) / panes;
      mullions += pathD([
        { x: x(u), y: y(p.slabZ) },
        { x: x(u), y: y(glassTop) },
      ]);
    }
    slabs += rect(-balcHalf, balcHalf, p.slabZ - SLAB_T, p.slabZ, 2);
    railTops += pathD([
      { x: x(-balcHalf), y: y(p.railTopZ) },
      { x: x(balcHalf), y: y(p.railTopZ) },
    ]);
    const n = Math.max(2, Math.round((2 * balcHalf) / spacing) + 1);
    for (let j = 0; j < n; j++) {
      const u = -balcHalf + (2 * balcHalf * j) / (n - 1);
      balusters += pathD([
        { x: x(u), y: y(p.slabZ) },
        { x: x(u), y: y(p.railTopZ) },
      ]);
    }
    const modules = layout.modules.map((m) => rect(m.u0, m.u1, p.railTopZ - drop, p.railTopZ, 1.5)).join('');
    return {
      floor: p.floor,
      label: labels[i],
      yMid: y(p.railTopZ - drop / 2),
      modules,
    };
  });

  // Physically overlapping rows: the part of each lower row covered by the row above.
  let overlap = '';
  if (placements.length > 1 && panelsOverlap(layout)) {
    for (let i = 1; i < placements.length; i++) {
      const lower = placements[i - 1];
      const upperBottom = placements[i].railTopZ - drop;
      overlap += rect(
        -rowWidth / 2,
        rowWidth / 2,
        Math.max(upperBottom, lower.railTopZ - drop),
        lower.railTopZ,
      );
    }
  }

  const bottomY = y(zBottom);
  let cut: string | null = null;
  if (!onGround) {
    // Zig-zag break line: the building continues below.
    const pts: Pt[] = [];
    const x0 = x(-halfW);
    const x1 = x(halfW);
    const n = Math.max(4, Math.round((x1 - x0) / 10));
    for (let j = 0; j <= n; j++)
      pts.push({ x: x0 + ((x1 - x0) * j) / n, y: bottomY + (j % 2 === 0 ? -2 : 2) });
    cut = pathD(pts);
  }

  return {
    fit,
    wall: rect(-halfW, halfW, zBottom, zTop),
    cut,
    ground: onGround ? { y: y(0) } : null,
    openings,
    mullions,
    slabs,
    railTops,
    balusters,
    overlap,
    floors,
    leftX: x(-halfW) - 8,
    rightX: x(halfW) + 8,
    bottom: bottomY + (onGround ? 10 : 6),
  };
}

// ── Dynamic parts (selected instant) ─────────

export function shadeRects(
  instant: InstantState,
  layout: PanelLayout,
  placements: readonly FloorPlacement[],
  fit: UniformFit,
): string {
  const cosT = layout.normal.n;
  let d = '';
  for (const fl of instant.floors) {
    const p = placements[fl.floor];
    if (!p) continue;
    for (const r of fl.shade.rects) {
      // Panel-plane point (u, v) → facade plane: z = railTop − v·cos θ.
      const zTop = p.railTopZ - r.v0 * cosT;
      const zBot = p.railTopZ - r.v1 * cosT;
      const h = Math.max(1.5, (zTop - zBot) * fit.k);
      d += rectD(fit.x(r.u0), fit.y(zTop), (r.u1 - r.u0) * fit.k, h);
    }
  }
  return d;
}

export function floorValue(instant: InstantState, floor: number, f: Format): string {
  const fl = instant.floors[floor];
  if (!fl || fl.state !== 'lit') return '–';
  return f.pct(fl.shade.fraction * 100);
}
