import { compassPoint, type Lang } from '../../i18n';
import { sunInFacade } from '../../model/geometry';
import { horizonAt } from '../../model/horizon';
import type { SolarPathPoint } from '../../model/sun';
import type { FloorPlacement, HorizonProfile, PanelLayout } from '../../model/types';
import { angleDiff, toRad } from '../../model/units';
import {
  boxDistance,
  boxHitsCircle,
  boxesOverlap,
  circleD,
  clampLabelX,
  labelBox,
  pathD,
  polylinesD,
  px,
  shiftBox,
  textWidth,
  type Anchor,
  type Box,
  type PlacedText,
  type Pt,
} from './geometry2d';
import { FONT, PAD } from './constants';

// ─────────────────────────────────────────────
// SUN PATH LAYOUT (pure, no React)
// Polar diagram: zenith at the centre, radius ∝ 90° − altitude (horizon = outer ring), north up, azimuth
// clockwise. Screen point of azimuth A: (cx + r·sin A, cy − r·cos A).
// ─────────────────────────────────────────────

/** Space around the outer ring for the compass labels, px. */
export const RIM = 24;

export interface Polar {
  cx: number;
  cy: number;
  R: number;
  /** Screen point of a sky direction (altitude clamped to 0…90). */
  pos: (azimuth: number, altitude: number) => Pt;
}

export function makePolar(width: number): Polar {
  const size = Math.min(width - 2 * PAD, 540);
  const R = size / 2 - RIM;
  const cx = width / 2;
  const cy = PAD + RIM + R;
  const pos = (azimuth: number, altitude: number): Pt => {
    const r = (R * (90 - Math.min(90, Math.max(0, altitude)))) / 90;
    const a = toRad(azimuth);
    return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
  };
  return { cx, cy, R, pos };
}

/** Pieces of a sun path above the horizon, with the horizon crossings interpolated onto the ring. */
export function pathPieces(points: readonly SolarPathPoint[], polar: Polar): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const above = p.sun.altitude > 0;
    const prev = points[i - 1];
    if (prev && prev.sun.altitude > 0 !== above) {
      const t = prev.sun.altitude / (prev.sun.altitude - p.sun.altitude);
      const az = prev.sun.azimuth + angleDiff(p.sun.azimuth, prev.sun.azimuth) * t;
      cur.push(polar.pos(az, 0));
      if (!above) {
        out.push(cur);
        cur = [];
      }
    }
    if (above) cur.push(polar.pos(p.sun.azimuth, p.sun.altitude));
  }
  out.push(cur);
  return out.filter((l) => l.length >= 2);
}

export interface HourMark {
  x: number;
  y: number;
  label: string | null;
  lx: number;
  ly: number;
}

/** Font size of hour, date and ring labels (svg.module.css `.small`). */
const SMALL = 10;

export function hourMarks(points: readonly SolarPathPoint[], polar: Polar): HourMark[] {
  const out: HourMark[] = [];
  let last: Pt | null = null;
  for (const p of points) {
    // The path's 24:00 point closes the curve but is the next day's 0:00 (polar day: same place as "0").
    if (p.minutes % 60 !== 0 || p.minutes >= 1440 || p.sun.altitude <= 0) continue;
    const q = polar.pos(p.sun.azimuth, p.sun.altitude);
    // Label radially outwards (towards the horizon ring).
    const dx = q.x - polar.cx;
    const dy = q.y - polar.cy;
    const d = Math.hypot(dx, dy) || 1;
    const lx = q.x + (dx / d) * 11;
    const ly = q.y + (dy / d) * 11 + 4;
    const label = last && Math.hypot(q.x - last.x, q.y - last.y) < 18 ? null : String(p.minutes / 60);
    if (label) last = q;
    out.push({ ...q, label, lx, ly });
  }
  return out;
}

/** Highest point of a path (for its direct label), or null if the sun stays below the horizon. */
export function peak(points: readonly SolarPathPoint[]): SolarPathPoint | null {
  let best: SolarPathPoint | null = null;
  for (const p of points) if (p.sun.altitude > 0 && (!best || p.sun.altitude > best.sun.altitude)) best = p;
  return best;
}

/** Ring between the horizon profile and the outer circle (even-odd fill); null for a flat horizon. */
export function horizonArea(profile: HorizonProfile | undefined, polar: Polar): string | null {
  if (!profile) return null;
  const pts: Pt[] = [];
  let max = 0;
  for (let az = 0; az < 360; az += 1) {
    const e = horizonAt(profile, az);
    max = Math.max(max, e);
    pts.push(polar.pos(az, e));
  }
  if (max < 0.05) return null;
  return circleD({ x: polar.cx, y: polar.cy }, polar.R) + pathD(pts, true);
}

export interface Footprint {
  building: string;
  balcony: string;
  panels: string;
}

/** Small plan of the building (behind the facade line), balcony and panel row, rotated to the facade azimuth. */
export function footprint(
  polar: Polar,
  facadeAz: number,
  layout: PanelLayout,
  placement: FloorPlacement,
): Footprint {
  const g = toRad(facadeAz);
  // Facade frame on screen: u = right seen from outside, n = outward normal (screen y points south).
  const u = { x: -Math.cos(g), y: -Math.sin(g) };
  const nn = { x: Math.sin(g), y: -Math.cos(g) };
  const side = Math.max(0.4, layout.rowWidth * 0.15);
  const halfB = layout.rowWidth / 2 + side;
  const depthB = Math.max(3, halfB * 1.2);
  const railN = placement.railN;
  const outN = railN + Math.max(layout.reach, 0.05);
  const extent = Math.max(Math.hypot(halfB, depthB), Math.hypot(layout.rowWidth / 2, outN));
  const k = (polar.R * 0.18) / extent;
  const P = (uu: number, n: number): Pt => ({
    x: polar.cx + k * (uu * u.x + n * nn.x),
    y: polar.cy + k * (uu * u.y + n * nn.y),
  });
  const quad = (u0: number, u1: number, n0: number, n1: number): string =>
    pathD([P(u0, n0), P(u1, n0), P(u1, n1), P(u0, n1)], true);
  const half = layout.rowWidth / 2;
  return {
    building: quad(-halfB, halfB, -depthB, 0),
    balcony: railN > 0 ? quad(-half - 0.1, half + 0.1, 0, railN) : '',
    panels: quad(-half, half, railN, outN),
  };
}

export function frontRanges(points: readonly SolarPathPoint[], facadeAz: number): [number, number][] {
  const ranges: [number, number][] = [];
  let start: number | null = null;
  let end = 0;
  for (const p of points) {
    const front = p.sun.altitude > 0 && sunInFacade(p.sun, facadeAz).n > 0;
    if (front) {
      start ??= p.minutes;
      end = p.minutes;
    } else if (start !== null) {
      ranges.push([start, end]);
      start = null;
    }
  }
  if (start !== null) ranges.push([start, end]);
  return ranges;
}

export function compassLabels(polar: Polar, facadeAz: number, lang: Lang) {
  return [0, 45, 90, 135, 180, 225, 270, 315]
    .filter((az) => Math.abs(angleDiff(az, facadeAz)) > 14)
    .map((az) => {
      const p = polar.pos(az, 0);
      const dx = (p.x - polar.cx) / polar.R;
      const dy = (p.y - polar.cy) / polar.R;
      return { az, x: p.x + dx * 12, y: p.y + dy * 12 + 4, label: compassPoint(az, lang) };
    });
}

export interface RefPath {
  date: string;
  d: string;
  /** Direct label (highest point of the path, nudged towards the zenith, inside the figure); null if none. */
  label: PlacedText | null;
}

/** Altitudes of the labelled grid rings. */
export const RING_ALTITUDES = [30, 60] as const;

/** Estimated box of a hour / date / ring label (centred, `.small`). */
export function smallLabelBox(x: number, y: number, text: string): Box {
  return labelBox(x, y, textWidth(text, SMALL), 'middle', SMALL);
}

/** Estimated box of the facade label (bold, wider than textWidth estimates). */
export function facadeLabelBox(l: PlacedText): Box {
  return labelBox(l.x, l.y, textWidth(l.text, FONT) * 1.12, l.anchor, FONT);
}

/**
 * Azimuth for the altitude-ring labels: pole-ward (where the sun path rarely runs) or the nearest direction
 * in 15° steps where both labels stay ≥ 4 px clear of `obstacles` (label boxes) and `points` (the day's
 * path); else the direction with the most room.
 */
export function ringLabelAzimuth(
  polar: Polar,
  latitude: number,
  obstacles: readonly Box[],
  points: readonly Pt[],
): number {
  const preferred = (latitude >= 0 ? 0 : 180) + 12;
  let best = preferred;
  let bestClear = -Infinity;
  for (let i = 0; i < 24; i++) {
    const az = preferred + Math.ceil(i / 2) * 15 * (i % 2 === 0 ? 1 : -1);
    let clear = Infinity;
    for (const alt of RING_ALTITUDES) {
      const p = polar.pos(az, alt);
      const b = smallLabelBox(p.x, p.y + 4, `${alt}°`);
      for (const o of obstacles) clear = Math.min(clear, boxDistance(b, o));
      for (const q of points) clear = Math.min(clear, boxDistance(b, { x0: q.x, y0: q.y, x1: q.x, y1: q.y }));
    }
    if (clear >= 4) return az;
    if (clear > bestClear) {
      bestClear = clear;
      best = az;
    }
  }
  return best;
}

export interface Diagram {
  polar: Polar;
  refs: RefPath[];
  selected: string;
  hours: HourMark[];
  horizon: string | null;
  footprint: Footprint;
  compass: ReturnType<typeof compassLabels>;
  facadeLine: string;
  normal: string;
  backHalf: string;
  frontHalf: string;
  facadeLabel: PlacedText;
  /** Azimuth at which the altitude rings are labelled. */
  ringAz: number;
  /** Boxes of the labels other than the hours (dates, compass, facade, rings) that hour labels must avoid. */
  fixedLabels: Box[];
  front: [number, number][];
  peak: SolarPathPoint | null;
}

export interface DiagramInput {
  width: number;
  latitude: number;
  facadeAz: number;
  selectedDate: string;
  refDates: readonly string[];
  refPaths: readonly (readonly SolarPathPoint[])[];
  selected: readonly SolarPathPoint[];
  horizon: HorizonProfile | undefined;
  layout: PanelLayout;
  placement: FloorPlacement;
  lang: Lang;
  /** Label texts: the facade orientation and the reference dates (same order as refDates). */
  facadeText: string;
  refLabels: readonly string[];
}

/** Everything that does not depend on the time of day. */
export function buildDiagram(input: DiagramInput): Diagram {
  const { facadeAz, width } = input;
  const polar = makePolar(width);
  const { cx, cy, R, pos } = polar;
  const refs = input.refPaths.map((pts, i) => {
    const top = input.refDates[i] === input.selectedDate ? null : peak(pts);
    const p = top ? pos(top.sun.azimuth, top.sun.altitude) : null;
    const text = input.refLabels[i] ?? '';
    return {
      date: input.refDates[i],
      d: polylinesD(pathPieces(pts, polar)),
      label: p
        ? {
            x: clampLabelX(p.x, textWidth(text, SMALL), 'middle', PAD, width - PAD),
            y: p.y + (cy > p.y ? 13 : -6),
            anchor: 'middle' as const,
            text,
          }
        : null,
    };
  });
  const ends = [pos(facadeAz - 90, 0), pos(facadeAz + 90, 0)];
  const normalTip = pos(facadeAz, 0);
  const hours = hourMarks(input.selected, polar);
  const compass = compassLabels(polar, facadeAz, input.lang);
  const hourBoxes = hours.flatMap((h) => (h.label ? [smallLabelBox(h.lx, h.ly, h.label)] : []));
  const refBoxes = refs.flatMap((r) => (r.label ? [smallLabelBox(r.label.x, r.label.y, r.label.text)] : []));
  const compassBoxes = compass.map((c) => labelBox(c.x, c.y, textWidth(c.label, FONT), 'middle', FONT));
  const facadeLabel = placeFacadeLabel(polar, facadeAz, input.facadeText, width, [
    ...hourBoxes,
    ...refBoxes,
    ...compassBoxes,
  ]);
  const facadeBox = facadeLabelBox(facadeLabel);
  const pathPoints = input.selected
    .filter((p) => p.sun.altitude > 0)
    .map((p) => pos(p.sun.azimuth, p.sun.altitude));
  const ringAz = ringLabelAzimuth(polar, input.latitude, [...hourBoxes, ...refBoxes, facadeBox], pathPoints);
  const ringBoxes = RING_ALTITUDES.map((alt) => {
    const p = pos(ringAz, alt);
    return smallLabelBox(p.x, p.y + 4, `${alt}°`);
  });
  return {
    polar,
    refs,
    selected: polylinesD(pathPieces(input.selected, polar)),
    hours,
    horizon: horizonArea(input.horizon, polar),
    footprint: footprint(polar, facadeAz, input.layout, input.placement),
    compass,
    facadeLine: pathD(ends),
    normal: pathD([{ x: cx, y: cy }, normalTip]),
    // Half of the sky behind the facade plane (clockwise from γ + 90° through γ + 180° to γ − 90°).
    backHalf: `M${px(ends[1].x)} ${px(ends[1].y)}A${px(R)} ${px(R)} 0 0 1 ${px(ends[0].x)} ${px(ends[0].y)}Z`,
    // Half in front of the facade (clockwise from γ − 90° through γ to γ + 90°): where the sun can reach the panels.
    frontHalf: `M${px(ends[0].x)} ${px(ends[0].y)}A${px(R)} ${px(R)} 0 0 1 ${px(ends[1].x)} ${px(ends[1].y)}Z`,
    facadeLabel,
    ringAz,
    fixedLabels: [...refBoxes, ...compassBoxes, facadeBox, ...ringBoxes],
    front: frontRanges(input.selected, facadeAz),
    peak: peak(input.selected),
  };
}

/** Overlap area of two boxes, px². */
const overlapArea = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/**
 * Facade label just beyond the normal's tip, inside the figure: east/west labels reach over the ring's edge
 * into the sky disc. Slid along the facade line (up to 48 px) where it would sit on an hour, date or compass
 * label; if no spot is free, the one with the least overlap.
 */
export function placeFacadeLabel(
  polar: Polar,
  facadeAz: number,
  text: string,
  width: number,
  avoid: readonly Box[],
): PlacedText {
  const g = toRad(facadeAz);
  const tip = polar.pos(facadeAz, 0);
  const anchor: Anchor = Math.sin(g) > 0.3 ? 'start' : Math.sin(g) < -0.3 ? 'end' : 'middle';
  const w = textWidth(text, FONT) * 1.12;
  const at = (s: number): PlacedText => ({
    x: clampLabelX(tip.x + Math.sin(g) * 12 + Math.cos(g) * s, w, anchor, PAD, width - PAD),
    y: tip.y - Math.cos(g) * 12 + 4 + Math.sin(g) * s,
    anchor,
    text,
  });
  let best = at(0);
  let least = Infinity;
  for (let i = 0; i <= 16; i++) {
    const l = at(Math.ceil(i / 2) * 6 * (i % 2 === 0 ? 1 : -1));
    const b = facadeLabelBox(l);
    const area = avoid.reduce((sum, o) => sum + overlapArea(b, o), 0);
    if (area === 0) return l;
    if (area < least) {
      least = area;
      best = l;
    }
  }
  return best;
}

/** A hour label's final position. */
export interface HourLabel {
  x: number;
  y: number;
  label: string;
}

const unit = (x: number, y: number): Pt => {
  const d = Math.hypot(x, y);
  return d > 1e-6 ? { x: x / d, y: y / d } : { x: 0, y: -1 };
};

/**
 * Hour labels at their places, except where the current sun glyph (circle of radius `ext` around `sun`)
 * would cover one: that label moves just clear of the glyph (away from the sun, else radially or along the
 * path) to a spot free of the other labels (`fixed` and the other hours), or is left out if there is none.
 */
export function hourLabels(
  hours: readonly HourMark[],
  polar: Polar,
  sun: Pt | null,
  ext: number,
  fixed: readonly Box[] = [],
): HourLabel[] {
  const labelled = hours.flatMap((h) =>
    h.label ? [{ h, label: h.label, box: smallLabelBox(h.lx, h.ly, h.label) }] : [],
  );
  return labelled.flatMap(({ h, label, box }) => {
    if (!sun || !boxHitsCircle(box, sun, ext + 1)) return [{ x: h.lx, y: h.ly, label }];
    const others = [...fixed, ...labelled.filter((o) => o.h !== h).map((o) => o.box)];
    const radial = unit(h.x - polar.cx, h.y - polar.cy);
    const dirs = [
      unit((box.x0 + box.x1) / 2 - sun.x, (box.y0 + box.y1) / 2 - sun.y),
      radial,
      { x: -radial.x, y: -radial.y },
      { x: -radial.y, y: radial.x },
      { x: radial.y, y: -radial.x },
    ];
    for (const u of dirs) {
      let s = 1;
      while (s < 60 && boxHitsCircle(shiftBox(box, u.x * s, u.y * s), sun, ext + 1)) s++;
      const moved = shiftBox(box, u.x * s, u.y * s);
      if (s < 60 && !others.some((o) => boxesOverlap(moved, o))) {
        return [{ x: h.lx + u.x * s, y: h.ly + u.y * s, label }];
      }
    }
    return [];
  });
}
