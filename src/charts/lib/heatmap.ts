import { HEATMAP_NIGHT } from '../../model/analysis';
import { daysInYear } from '../../model/time';
import type { HeatmapData } from '../../model/types';
import { CELL, CELL_CLASS_COUNT, SHADE_STEP_BOUNDS_PCT, cellClass } from './colors';
import type { Rgba } from '../../styles/tokens';
import { flowLayout, type MeasureText } from './text';

// ─────────────────────────────────────────────
// SHADE HEATMAP: DATA PREP, LAYOUT, CANVAS DRAWING
// x = day of the year, y = local clock time (morning at the top), cells = cell classes (colors.ts).
// Pure functions except drawHeatmap (canvas). Everything is laid out in CSS px; the cells are written as
// ImageData in device pixels (crisp at any devicePixelRatio, hatching included), text and axes on top.
// ─────────────────────────────────────────────

export interface SlotRange {
  /** First visible slot (inclusive). */
  first: number;
  /** Number of visible slots. */
  count: number;
}

/**
 * Slots that are not night on at least one day, widened to whole hours with one extra hour on both sides
 * (clamped to the day). The whole day if no slot has sun.
 */
export function visibleSlots(h: HeatmapData): SlotRange {
  const { days, slotsPerDay, values, slotMinutes } = h;
  let lo = slotsPerDay;
  let hi = -1;
  for (let s = 0; s < slotsPerDay; s++) {
    for (let d = 0; d < days; d++) {
      if (values[d * slotsPerDay + s] !== HEATMAP_NIGHT) {
        if (s < lo) lo = s;
        hi = s;
        break;
      }
    }
  }
  if (hi < 0) return { first: 0, count: slotsPerDay };
  const perHour = Math.max(1, Math.round(60 / slotMinutes));
  const first = Math.max(0, (Math.floor(lo / perHour) - 1) * perHour);
  const end = Math.min(slotsPerDay, (Math.ceil((hi + 1) / perHour) + 1) * perHour);
  return { first, count: end - first };
}

/** Cell class per [day][visible row] (row-major, `range.count` rows per day). */
export function classifyCells(h: HeatmapData, range: SlotRange): Uint8Array {
  const out = new Uint8Array(h.days * range.count);
  for (let d = 0; d < h.days; d++) {
    const src = d * h.slotsPerDay + range.first;
    const dst = d * range.count;
    for (let r = 0; r < range.count; r++) out[dst + r] = cellClass(h.values[src + r]);
  }
  return out;
}

/** 0-based day index of the first day of every month (12 values) plus the day count (13th value). */
export function monthStartDays(year: number): number[] {
  const out: number[] = [];
  const start = Date.UTC(year, 0, 1);
  for (let m = 0; m <= 12; m++) out.push(Math.round((Date.UTC(year, m, 1) - start) / 86_400_000));
  return out;
}

/**
 * "YYYY-MM-DD" of the calendar day of `date` in `year` (29 Feb becomes 28 Feb in a common year). Maps the
 * selected date onto a heatmap of another year by month and day, not by day of the year.
 */
export function sameDayIn(year: number, date: string): string {
  const md = date.slice(5);
  return `${year}-${md === '02-29' && daysInYear(year) === 365 ? '02-28' : md}`;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LegendEntry {
  cls: number;
  label: string;
  x: number;
  y: number;
}

export interface HeatmapLayout {
  width: number;
  height: number;
  plot: Rect;
  /** Categorical legend entries (swatch at x, y; 12 × 12 px). */
  entries: LegendEntry[];
  /** Shade ramp (null when the floor cannot be shaded). */
  ramp: { x: number; y: number; stepW: number; labelX: number; label: string } | null;
  fontSize: number;
}

export interface HeatmapLegendText {
  night: string;
  behind: string;
  horizon: string;
  sun: string;
  /** Label in front of the shade ramp. */
  shaded: string;
}

const MARGIN = { left: 44, right: 8, top: 8, axis: 22 };
const SWATCH = 12;
const LEGEND_ROW = 18;
const RAMP_STEP_W = 30;

/** Positions of plot, legend entries and ramp for a given width. */
export function layoutHeatmap(
  width: number,
  text: HeatmapLegendText,
  showRamp: boolean,
  measure: MeasureText,
): HeatmapLayout {
  const fontSize = 12;
  const plotH = width < 480 ? 200 : 240;
  const plot: Rect = {
    x: MARGIN.left,
    y: MARGIN.top,
    w: Math.max(40, width - MARGIN.left - MARGIN.right),
    h: plotH,
  };
  const legendTop = plot.y + plot.h + MARGIN.axis + 8;
  const cats = [
    { cls: CELL.night, label: text.night },
    { cls: CELL.behind, label: text.behind },
    { cls: CELL.horizon, label: text.horizon },
    { cls: CELL.sun, label: text.sun },
  ];
  const flow = flowLayout(
    cats.map((c) => SWATCH + 6 + measure(c.label)),
    plot.w,
    16,
  );
  const entries = cats.map((c, i) => ({
    ...c,
    x: plot.x + flow.positions[i].x,
    y: legendTop + flow.positions[i].row * LEGEND_ROW,
  }));
  let height = legendTop + flow.rows * LEGEND_ROW;
  let ramp: HeatmapLayout['ramp'] = null;
  if (showRamp) {
    const labelW = measure(text.shaded);
    // Steps plus room for the last boundary label ("100 %") that is centred on the ramp's right end.
    const rampW = (SHADE_STEP_BOUNDS_PCT.length - 1) * RAMP_STEP_W + 20;
    // Label left of the ramp when both fit on one line, else above it.
    const inline = labelW + 8 + rampW <= plot.w;
    const y = height + 4 + (inline ? 0 : LEGEND_ROW);
    ramp = {
      x: plot.x + (inline ? labelW + 8 : 0),
      y,
      stepW: RAMP_STEP_W,
      labelX: plot.x,
      label: text.shaded,
    };
    height = y + SWATCH + 16;
  }
  return { width, height: Math.ceil(height + 4), plot, entries, ramp, fontSize };
}

/** Cell under a point in CSS px relative to the plot's top-left corner, or null outside. */
export function cellAt(
  layout: HeatmapLayout,
  days: number,
  rows: number,
  x: number,
  y: number,
): { day: number; row: number } | null {
  const { w, h } = layout.plot;
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  return {
    day: Math.min(days - 1, Math.floor((x / w) * days)),
    row: Math.min(rows - 1, Math.floor((y / h) * rows)),
  };
}

export interface HeatmapPalette {
  /** Colour per cell class (index = class). */
  cells: readonly Rgba[];
  /** Hatch line colour. */
  hatch: Rgba;
  text: string;
  axis: string;
  font: string;
}

export interface HeatmapDrawInput {
  layout: HeatmapLayout;
  classes: Uint8Array;
  days: number;
  range: SlotRange;
  slotMinutes: number;
  year: number;
  dpr: number;
  palette: HeatmapPalette;
  monthLabels: readonly string[];
  formatTime: (minutes: number) => string;
  /** Labels of the ramp boundaries (SHADE_STEP_BOUNDS_PCT). */
  rampLabels: readonly string[];
}

/** Blends b over a with weight t (0…1), opaque result. */
export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    255,
  ];
}

const HATCH_MIX = 0.55;

/** Draws cells, axes and legend onto `ctx` (canvas already sized to layout × dpr). */
export function drawHeatmap(ctx: CanvasRenderingContext2D, input: HeatmapDrawInput): void {
  const { layout, classes, days, range, dpr, palette } = input;
  const { plot } = layout;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // ── Cells (device pixels) ──
  const px0 = Math.round(plot.x * dpr);
  const py0 = Math.round(plot.y * dpr);
  const pw = Math.max(1, Math.round(plot.w * dpr));
  const ph = Math.max(1, Math.round(plot.h * dpr));
  const img = ctx.createImageData(pw, ph);
  const data = img.data;
  const rows = range.count;
  const colDay = new Int32Array(pw);
  for (let i = 0; i < pw; i++) colDay[i] = Math.min(days - 1, Math.floor((i * days) / pw)) * rows;
  const period = Math.max(4, Math.round(5 * dpr));
  const lineW = Math.max(1, Math.round(1.25 * dpr));
  const base = palette.cells;
  const hatched: Rgba[] = base.map((c) => mix(c, palette.hatch, HATCH_MIX));
  for (let j = 0; j < ph; j++) {
    const row = Math.min(rows - 1, Math.floor((j * rows) / ph));
    let o = j * pw * 4;
    for (let i = 0; i < pw; i++, o += 4) {
      const cls = classes[colDay[i] + row];
      let c = base[cls] ?? base[CELL.night];
      // Texture so that "behind the facade" (45°) and "below the horizon" (135°) never rely on colour.
      if (cls === CELL.behind && (i + j) % period < lineW) c = hatched[cls];
      else if (cls === CELL.horizon && (((i - j) % period) + period) % period < lineW) c = hatched[cls];
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, px0, py0);

  // ── Axes and legend (CSS px) ──
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `${layout.fontSize - 1}px ${palette.font}`;
  ctx.fillStyle = palette.text;
  ctx.strokeStyle = palette.axis;
  ctx.lineWidth = 1;
  const px = (v: number): number => Math.round(v) + 0.5;
  const bottom = plot.y + plot.h;

  // Month boundaries (ticks below the plot) and labels centred in each month.
  const starts = monthStartDays(input.year);
  const dayW = plot.w / days;
  const minMonthW = Math.min(...starts.slice(1).map((s, m) => (s - starts[m]) * dayW));
  const maxLabelW = Math.max(...input.monthLabels.map((l) => ctx.measureText(l).width));
  const short = minMonthW < maxLabelW + 6;
  ctx.beginPath();
  for (const s of starts) {
    const x = px(plot.x + Math.min(s, days) * dayW);
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, bottom + 4);
  }
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let m = 0; m < 12; m++) {
    const label = short ? input.monthLabels[m].slice(0, 1) : input.monthLabels[m];
    ctx.fillText(label, plot.x + ((starts[m] + starts[m + 1]) / 2) * dayW, bottom + 6);
  }

  // Hour ticks and labels on the left.
  const rowH = plot.h / rows;
  const slotsPerHour = 60 / input.slotMinutes;
  const hourPx = rowH * slotsPerHour;
  const stepH = [1, 2, 3, 4, 6].find((hStep) => hStep * hourPx >= 22) ?? 6;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.beginPath();
  const firstMin = range.first * input.slotMinutes;
  const lastMin = (range.first + rows) * input.slotMinutes;
  for (let m = Math.ceil(firstMin / (stepH * 60)) * stepH * 60; m <= lastMin; m += stepH * 60) {
    const y = plot.y + ((m - firstMin) / input.slotMinutes) * rowH;
    ctx.moveTo(plot.x - 4, px(y));
    ctx.lineTo(plot.x, px(y));
    ctx.fillText(input.formatTime(m), plot.x - 6, y);
  }
  ctx.stroke();

  // Legend: categorical swatches.
  ctx.font = `${layout.fontSize}px ${palette.font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const swatch = (x: number, y: number, cls: number, w = SWATCH, h = SWATCH): void => {
    const c = base[cls];
    ctx.fillStyle = `rgb(${c[0]} ${c[1]} ${c[2]})`;
    ctx.fillRect(x, y, w, h);
    if (cls === CELL.behind || cls === CELL.horizon) {
      const hc = hatched[cls];
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.strokeStyle = `rgb(${hc[0]} ${hc[1]} ${hc[2]})`;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let k = -h; k < w + h; k += 5) {
        if (cls === CELL.behind) {
          ctx.moveTo(x + k, y + h);
          ctx.lineTo(x + k + h, y);
        } else {
          ctx.moveTo(x + k, y);
          ctx.lineTo(x + k + h, y + h);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
    if (cls === CELL.night) {
      ctx.strokeStyle = palette.axis;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  };
  for (const e of layout.entries) {
    swatch(e.x, e.y + 3, e.cls);
    ctx.fillStyle = palette.text;
    ctx.fillText(e.label, e.x + SWATCH + 6, e.y + 3 + SWATCH / 2);
  }

  // Legend: shade ramp with boundary labels.
  const ramp = layout.ramp;
  if (ramp) {
    const steps = CELL_CLASS_COUNT - CELL.shade;
    ctx.fillStyle = palette.text;
    ctx.textAlign = 'left';
    if (ramp.x > ramp.labelX) ctx.fillText(ramp.label, ramp.labelX, ramp.y + SWATCH / 2);
    else ctx.fillText(ramp.label, ramp.labelX, ramp.y - LEGEND_ROW + SWATCH / 2 + 3);
    for (let s = 0; s < steps; s++) swatch(ramp.x + s * ramp.stepW, ramp.y, CELL.shade + s, ramp.stepW - 2);
    ctx.font = `${layout.fontSize - 1}px ${palette.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = palette.text;
    input.rampLabels.forEach((label, i) => {
      ctx.fillText(label, ramp.x + i * ramp.stepW - 1, ramp.y + SWATCH + 3);
    });
  }
}
