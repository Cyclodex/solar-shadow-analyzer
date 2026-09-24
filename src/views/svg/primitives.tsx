import type { ReactNode } from 'react';
import { LINE } from './constants';
import { arcD, pathD, px, type Anchor, type Pt } from './geometry2d';
import s from './svg.module.css';

// ─────────────────────────────────────────────
// SVG PRIMITIVES shared by the 2D views: sun glyph, dimension line, angle arc, arrow, multi-line text
// (hatch fills: components/svg/HatchPattern). All sizes in px (user units); colours come from svg.module.css (theme tokens).
// ─────────────────────────────────────────────

/** Outer radius of a SunGlyph (rays / glow) relative to its core radius. */
export const SUN_GLYPH_EXTENT = 1.95;

export interface SunGlyphProps {
  x: number;
  y: number;
  /** Core radius, px. */
  r?: number;
  /** Greyed out (sun blocked: behind the facade or below the horizon profile). */
  dim?: boolean;
}

/** Sun symbol: core disc and eight rays; `dim` = blocked sun. Extends SUN_GLYPH_EXTENT·r from (x, y). */
export function SunGlyph({ x, y, r = 8, dim = false }: SunGlyphProps) {
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    rays += pathD([
      { x: x + c * r * 1.4, y: y + sn * r * 1.4 },
      { x: x + c * r * SUN_GLYPH_EXTENT, y: y + sn * r * SUN_GLYPH_EXTENT },
    ]);
  }
  return (
    <g>
      {!dim && <circle cx={px(x)} cy={px(y)} r={px(r * SUN_GLYPH_EXTENT)} className={s.sunGlow} />}
      <path d={rays} className={dim ? s.sunDimRays : s.sunRays} />
      <circle cx={px(x)} cy={px(y)} r={px(r)} className={dim ? s.sunDimCore : s.sunCore} />
    </g>
  );
}

export type LabelSide = 'left' | 'right' | 'above' | 'below';

export interface DimensionLineProps {
  a: Pt;
  b: Pt;
  label: string;
  /** Where the label sits relative to the line's midpoint. */
  side: LabelSide;
  /** 'bad' = conflict (e.g. overlapping rows). */
  tone?: 'default' | 'bad';
  /** Optional extension lines from the measured points to the dimension line. */
  from?: [Pt, Pt];
  /** Rotate the label to run along a vertical line (side 'left' / 'right'). */
  rotate?: boolean;
}

/** Architectural dimension line with 45° end ticks and a value label. */
export function DimensionLine({
  a,
  b,
  label,
  side,
  tone = 'default',
  from,
  rotate = false,
}: DimensionLineProps) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  // Tick direction: the line direction rotated by 45°.
  const tx = ((ux - uy) / Math.SQRT2) * 4;
  const ty = ((ux + uy) / Math.SQRT2) * 4;
  const tick = (p: Pt): string =>
    pathD([
      { x: p.x - tx, y: p.y - ty },
      { x: p.x + tx, y: p.y + ty },
    ]);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const pos: Record<LabelSide, { x: number; y: number; anchor: Anchor }> = {
    left: { x: mid.x - 7, y: mid.y + 4, anchor: 'end' },
    right: { x: mid.x + 7, y: mid.y + 4, anchor: 'start' },
    above: { x: mid.x, y: mid.y - 6, anchor: 'middle' },
    below: { x: mid.x, y: mid.y + 14, anchor: 'middle' },
  };
  const vertical = rotate && (side === 'left' || side === 'right');
  const p = vertical
    ? { x: mid.x + (side === 'left' ? -6 : 14), y: mid.y, anchor: 'middle' as const }
    : pos[side];
  const lineClass = tone === 'bad' ? s.dimBad : s.dim;
  return (
    <g>
      {from && <path d={pathD([from[0], a]) + pathD([from[1], b])} className={s.guide} />}
      <path d={pathD([a, b]) + tick(a) + tick(b)} className={lineClass} />
      <text
        x={px(p.x)}
        y={px(p.y)}
        textAnchor={p.anchor}
        transform={vertical ? `rotate(-90 ${px(p.x)} ${px(p.y)})` : undefined}
        className={[s.label, s.num, s.halo, tone === 'bad' ? s.badText : ''].filter(Boolean).join(' ')}
      >
        {label}
      </text>
    </g>
  );
}

export interface AngleArcProps {
  /** Vertex. */
  c: Pt;
  r: number;
  /** Screen angles in radians (0 = +x, clockwise positive). */
  a0: number;
  a1: number;
  label: string;
  /** Radius of the label position on the bisector (default r + 10). */
  labelR?: number;
  /** Explicit label position (baseline) and anchor instead of the bisector (placed by the caller). */
  labelAt?: { x: number; y: number; anchor: Anchor };
  className?: string;
  textClassName?: string;
}

/** Angle marker: arc between two directions at a vertex and a label (on the bisector unless `labelAt`). */
export function AngleArc({ c, r, a0, a1, label, labelR, labelAt, className, textClassName }: AngleArcProps) {
  const mid = (a0 + a1) / 2;
  const lr = labelR ?? r + 10;
  const cos = Math.cos(mid);
  const at: { x: number; y: number; anchor: Anchor } = labelAt ?? {
    x: c.x + cos * lr,
    y: c.y + Math.sin(mid) * lr + 4,
    anchor: cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle',
  };
  return (
    <g>
      <path d={arcD(c, r, a0, a1)} className={className ?? s.arc} />
      <text
        x={px(at.x)}
        y={px(at.y)}
        textAnchor={at.anchor}
        className={[s.label, s.num, s.halo, textClassName].filter(Boolean).join(' ')}
      >
        {label}
      </text>
    </g>
  );
}

export interface ArrowProps {
  from: Pt;
  to: Pt;
  /** Arrowhead length, px. */
  head?: number;
  lineClassName?: string;
  headClassName?: string;
}

/** Straight arrow with a filled triangular head at `to`. */
export function Arrow({ from, to, head = 7, lineClassName, headClassName }: ArrowProps) {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(len > 0.5)) return null;
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  const h = Math.min(head, len);
  const base = { x: to.x - ux * h, y: to.y - uy * h };
  const w = h * 0.45;
  const headPts = [
    to,
    { x: base.x - uy * w, y: base.y + ux * w },
    { x: base.x + uy * w, y: base.y - ux * w },
  ];
  return (
    <g>
      <path d={pathD([from, base])} className={lineClassName ?? s.arrowLine} />
      <path d={pathD(headPts, true)} className={headClassName ?? s.arrow} />
    </g>
  );
}

export interface TextLinesProps {
  x: number;
  /** Baseline of the first line. */
  y: number;
  lines: readonly ReactNode[];
  lineHeight?: number;
  anchor?: Anchor;
  className?: string;
}

/** Multi-line SVG text (one <tspan> per line). */
export function TextLines({ x, y, lines, lineHeight = LINE, anchor = 'start', className }: TextLinesProps) {
  return (
    <text x={px(x)} y={px(y)} textAnchor={anchor} className={className}>
      {lines.map((line, i) => (
        <tspan key={i} x={px(x)} dy={i === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}
