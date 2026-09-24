// ─────────────────────────────────────────────
// 2D DRAWING HELPERS (screen space, pixels, y down)
// Pure drawing math for the SVG views: rounding, path strings, clipping, uniform world→screen fits,
// label placement. No physics or astronomy here — that lives in src/model.
// ─────────────────────────────────────────────

export interface Pt {
  x: number;
  y: number;
}

/** Screen rectangle with x0 < x1 and y0 < y1. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Straight line segment a→b. */
export type Segment = readonly [Pt, Pt];

/** Rounds a screen coordinate to 0.01 px (short, stable SVG attributes). */
export const px = (v: number): number => Math.round(v * 100) / 100 + 0;

export const pt = (x: number, y: number): Pt => ({ x, y });

export function boxWidth(b: Box): number {
  return b.x1 - b.x0;
}

export function boxHeight(b: Box): number {
  return b.y1 - b.y0;
}

/** Shrinks a box by `d` px on every side (never below zero size). */
export function insetBox(b: Box, d: number): Box {
  const dx = Math.min(d, boxWidth(b) / 2);
  const dy = Math.min(d, boxHeight(b) / 2);
  return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 - dx, y1: b.y1 - dy };
}

/** "M x y L x y …" through the points (optionally closed). Empty string for no points. */
export function pathD(points: readonly Pt[], close = false): string {
  if (points.length === 0) return '';
  const parts = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x)} ${px(p.y)}`);
  return parts.join('') + (close ? 'Z' : '');
}

/** Several polylines in one path; polylines with fewer than two points are skipped. */
export function polylinesD(lines: readonly (readonly Pt[])[]): string {
  return lines
    .filter((l) => l.length >= 2)
    .map((l) => pathD(l))
    .join('');
}

/** Quadrilateral a → b → b + off → a + off (a strip of constant width along a segment). */
export function stripD(a: Pt, b: Pt, off: Pt): string {
  return pathD([a, b, { x: b.x + off.x, y: b.y + off.y }, { x: a.x + off.x, y: a.y + off.y }], true);
}

/** Axis-aligned rectangle as a closed path (for combining many rectangles into one element). */
export function rectD(x: number, y: number, w: number, h: number): string {
  return `M${px(x)} ${px(y)}h${px(w)}v${px(h)}h${px(-w)}Z`;
}

/**
 * Clips the segment a→b to `box` (Liang–Barsky). Returns the visible part or null if it lies outside.
 */
export function clipSegment(a: Pt, b: Pt, box: Box): [Pt, Pt] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: [number, number][] = [
    [-dx, a.x - box.x0],
    [dx, box.x1 - a.x],
    [-dy, a.y - box.y0],
    [dy, box.y1 - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

/** True if two boxes overlap (touching edges do not count). */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** The box moved by (dx, dy). */
export function shiftBox(b: Box, dx: number, dy: number): Box {
  return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
}

/** Clearance between two boxes in px: the gap if they are apart, minus the penetration depth if they overlap. */
export function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(b.x0 - a.x1, a.x0 - b.x1);
  const dy = Math.max(b.y0 - a.y1, a.y0 - b.y1);
  if (dx < 0 && dy < 0) return Math.max(dx, dy);
  return Math.hypot(Math.max(0, dx), Math.max(0, dy));
}

/** True if the segment a→b passes through `box`. */
export function segmentHitsBox([a, b]: Segment, box: Box): boolean {
  return clipSegment(a, b, box) !== null;
}

/** True if `box` and the circle around `c` with radius `r` overlap. */
export function boxHitsCircle(box: Box, c: Pt, r: number): boolean {
  const dx = c.x - within(c.x, box.x0, box.x1);
  const dy = c.y - within(c.y, box.y0, box.y1);
  return dx * dx + dy * dy < r * r;
}

/** Point where the ray from `origin` in direction `dir` leaves `box` (origin inside), else null. */
export function rayExit(origin: Pt, dir: Pt, box: Box): Pt | null {
  const len = Math.hypot(dir.x, dir.y);
  if (!(len > 0)) return null;
  const far = (boxWidth(box) + boxHeight(box)) * 4 + Math.abs(origin.x) + Math.abs(origin.y);
  const end = { x: origin.x + (dir.x / len) * far, y: origin.y + (dir.y / len) * far };
  const clipped = clipSegment(origin, end, box);
  return clipped ? clipped[1] : null;
}

/**
 * Intersection parameter of the ray o + t·d (t ≥ 0) with the segment a→b; returns { t, s } with s ∈ [0, 1]
 * the position on the segment, or null if they do not meet.
 */
export function raySegment(o: Pt, d: Pt, a: Pt, b: Pt): { t: number; s: number } | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-12) return null;
  const ax = a.x - o.x;
  const ay = a.y - o.y;
  const t = (ax * ey - ay * ex) / den;
  const s = (ax * d.y - ay * d.x) / den;
  if (t < 0 || s < -1e-9 || s > 1 + 1e-9) return null;
  return { t, s: Math.min(1, Math.max(0, s)) };
}

/**
 * Circular arc path around `c` from screen angle a0 to a1 (radians; 0 = +x, positive = clockwise on
 * screen because y points down). Always draws the shorter way when |a1 − a0| ≤ π.
 */
export function arcD(c: Pt, r: number, a0: number, a1: number): string {
  const p0 = { x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) };
  const p1 = { x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) };
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M${px(p0.x)} ${px(p0.y)}A${px(r)} ${px(r)} 0 ${large} ${sweep} ${px(p1.x)} ${px(p1.y)}`;
}

/** Full circle as a path (two half arcs), e.g. for even-odd fills. */
export function circleD(c: Pt, r: number): string {
  return (
    `M${px(c.x - r)} ${px(c.y)}` +
    `A${px(r)} ${px(r)} 0 1 1 ${px(c.x + r)} ${px(c.y)}` +
    `A${px(r)} ${px(r)} 0 1 1 ${px(c.x - r)} ${px(c.y)}Z`
  );
}

/**
 * Clips a polyline to `box`; returns the visible pieces (each with ≥ 2 points). Consecutive points
 * with `breakIf(a, b)` true are not connected (e.g. sun below the horizon, azimuth wrap-around).
 */
export function clipPolyline(points: readonly Pt[], box: Box, breakIf?: (a: Pt, b: Pt) => boolean): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  const flush = (): void => {
    if (cur.length >= 2) out.push(cur);
    cur = [];
  };
  const same = (a: Pt, b: Pt): boolean => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = breakIf?.(a, b) ? null : clipSegment(a, b, box);
    if (!seg) {
      flush();
      continue;
    }
    const last = cur[cur.length - 1];
    if (!last || !same(last, seg[0])) {
      flush();
      cur.push(seg[0]);
    }
    cur.push(seg[1]);
    // The segment left the box: the next visible piece starts a new polyline.
    if (!same(seg[1], b)) flush();
  }
  flush();
  return out;
}

/** Greedy word wrap for SVG text (estimated widths). Always returns at least one line. */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(' ')) {
    const next = line ? `${line} ${w}` : w;
    if (line && textWidth(next, fontSize) > maxWidth) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  lines.push(line);
  return lines;
}

/** Rough width of a text label in px (system sans-serif; deliberately generous). */
export function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    if (/[\s.,:;'’|·]/.test(ch)) w += 0.3;
    else if (/[A-ZÄÖÜMW%]/.test(ch)) w += 0.7;
    else w += 0.58;
  }
  return w * fontSize;
}

export type Anchor = 'start' | 'middle' | 'end';

/** A placed single-line label: baseline point, anchor and text. */
export interface PlacedText {
  x: number;
  y: number;
  anchor: Anchor;
  text: string;
}

/**
 * Estimated box of a single-line label (font size `fontSize`, baseline `y`): cap height above, a small
 * descent below, horizontal extent from the anchor.
 */
export function labelBox(x: number, y: number, width: number, anchor: Anchor, fontSize: number): Box {
  const left = anchor === 'start' ? x : anchor === 'middle' ? x - width / 2 : x - width;
  return { x0: left, y0: y - fontSize * 0.9, x1: left + width, y1: y + fontSize * 0.25 };
}

/** Moves a label's anchor x so that a text of `width` px stays within [x0, x1]. */
export function clampLabelX(x: number, width: number, anchor: Anchor, x0: number, x1: number): number {
  const left = anchor === 'start' ? x : anchor === 'middle' ? x - width / 2 : x - width;
  const shift = left < x0 ? x0 - left : left + width > x1 ? x1 - (left + width) : 0;
  return x + shift;
}

/** Keeps a value inside [min, max] (min wins if the range is empty). */
export function within(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Uniform world→screen transform: world x → right, world y → up (screen y is flipped). */
export interface UniformFit {
  /** Pixels per world unit. */
  k: number;
  x: (wx: number) => number;
  y: (wy: number) => number;
  /** World point → screen point. */
  p: (wx: number, wy: number) => Pt;
  /** Screen box actually covered by the world extent. */
  box: Box;
}

export interface WorldExtent {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Fits `world` into `box` with one scale for both axes (no squashing) and aligns it horizontally
 * (`alignX`: 0 = left, 0.5 = centre, 1 = right) and vertically (`alignY`: 0 = top, 1 = bottom).
 * `maxK` caps the scale (px per world unit).
 */
export function fitUniform(
  world: WorldExtent,
  box: Box,
  alignX = 0.5,
  alignY = 0.5,
  maxK = Infinity,
): UniformFit {
  const ww = Math.max(1e-9, world.x1 - world.x0);
  const wh = Math.max(1e-9, world.y1 - world.y0);
  const k = Math.max(1e-9, Math.min(boxWidth(box) / ww, boxHeight(box) / wh, maxK));
  const ox = box.x0 + (boxWidth(box) - ww * k) * alignX;
  const oy = box.y0 + (boxHeight(box) - wh * k) * alignY;
  const x = (wx: number): number => ox + (wx - world.x0) * k;
  const y = (wy: number): number => oy + (world.y1 - wy) * k;
  return {
    k,
    x,
    y,
    p: (wx, wy) => ({ x: x(wx), y: y(wy) }),
    box: { x0: ox, y0: oy, x1: ox + ww * k, y1: oy + wh * k },
  };
}
