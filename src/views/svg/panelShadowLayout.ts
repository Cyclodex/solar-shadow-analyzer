import { CELLS_ACROSS_SHORT_SIDE, SUBSTRINGS_PER_MODULE } from '../../model/geometry';
import type { PanelLayout, ShadeRect } from '../../model/types';
import { pathD, rectD, type Box, type Pt } from './geometry2d';
import { PAD } from './constants';

// ─────────────────────────────────────────────
// PANEL SHADOW LAYOUT (pure, no React)
// The panel row seen perpendicular to its plane: u to the right (as seen from outside), v down the slope
// from the railing (top edge), one uniform scale. Cell grid and substrings follow the partition used by
// substringBeamLoss in the model (CELLS_ACROSS_SHORT_SIDE cells across the short side, SUBSTRINGS_PER_MODULE
// substrings parallel to the long side).
// ─────────────────────────────────────────────

/** Space above/beside the row where the cast shadow of the row above is still drawn, px. */
export const MARGIN_TOP = 34;
export const MARGIN_SIDE = 14;
export const INSET = 78;

export interface RowGeometry {
  /** Plot box (row + margins). */
  box: Box;
  k: number;
  ux: (u: number) => number;
  vy: (v: number) => number;
  modules: string;
  cells: string;
  substrings: string;
  railY: number;
  bottom: number;
  colW: number;
}

/** Cell grid and substring bands of one module (same partition as substringBeamLoss in the model). */
export function moduleGrid(layout: PanelLayout, u0: number): { cells: [Pt, Pt][]; subs: [Pt, Pt][] } {
  const { length: L, moduleWidth: w } = layout;
  const landscape = w >= L;
  const long = landscape ? w : L;
  const short = landscape ? L : w;
  const cs = short / CELLS_ACROSS_SHORT_SIDE;
  const nAlong = Math.max(1, Math.round(long / cs));
  const cl = long / nAlong;
  // Local (a = along the long side, c = across) → (u, v).
  const uv = (a: number, c: number): Pt => (landscape ? { x: u0 + a, y: c } : { x: u0 + c, y: a });
  const cells: [Pt, Pt][] = [];
  const subs: [Pt, Pt][] = [];
  const perSub = CELLS_ACROSS_SHORT_SIDE / SUBSTRINGS_PER_MODULE;
  for (let p = 1; p < CELLS_ACROSS_SHORT_SIDE; p++) {
    const line: [Pt, Pt] = [uv(0, p * cs), uv(long, p * cs)];
    (p % perSub === 0 ? subs : cells).push(line);
  }
  for (let q = 1; q < nAlong; q++) cells.push([uv(q * cl, 0), uv(q * cl, short)]);
  return { cells, subs };
}

export function buildRow(width: number, layout: PanelLayout): RowGeometry {
  const { rowWidth, length: L } = layout;
  const maxRowH = Math.min(260, Math.max(110, width * 0.42));
  const availW = width - 2 * PAD - 2 * MARGIN_SIDE;
  const k = Math.min(availW / rowWidth, maxRowH / L);
  const rowW = rowWidth * k;
  const x0 = (width - rowW) / 2;
  const y0 = PAD + MARGIN_TOP;
  const ux = (u: number): number => x0 + (u + rowWidth / 2) * k;
  const vy = (v: number): number => y0 + v * k;
  let modules = '';
  const cellLines: [Pt, Pt][] = [];
  const subLines: [Pt, Pt][] = [];
  for (const m of layout.modules) {
    modules += rectD(ux(m.u0), vy(0), (m.u1 - m.u0) * k, L * k);
    const g = moduleGrid(layout, m.u0);
    cellLines.push(...g.cells);
    subLines.push(...g.subs);
  }
  const toScreen = ([a, b]: [Pt, Pt]): string =>
    pathD([
      { x: ux(a.x), y: vy(a.y) },
      { x: ux(b.x), y: vy(b.y) },
    ]);
  // Skip the cell grid when cells would be smaller than ~3 px.
  const cellPx = (Math.min(layout.length, layout.moduleWidth) / CELLS_ACROSS_SHORT_SIDE) * k;
  return {
    box: { x0: PAD, y0: PAD + 16, x1: width - PAD, y1: vy(L) + 10 },
    k,
    ux,
    vy,
    modules,
    cells: cellPx >= 3 ? cellLines.map(toScreen).join('') : '',
    substrings: subLines.map(toScreen).join(''),
    railY: vy(0),
    bottom: vy(L),
    colW: layout.moduleWidth * k,
  };
}

/** Rectangle (u0…u1 × v0…v1, metres) clipped to the plot box, as a path (empty if outside). */
export function clippedRect(row: RowGeometry, u0: number, u1: number, v0: number, v1: number): string {
  const x0 = Math.max(row.box.x0, row.ux(u0));
  const x1 = Math.min(row.box.x1, row.ux(u1));
  const y0 = Math.max(row.box.y0, row.vy(v0));
  const y1 = Math.min(row.box.y1, row.vy(v1));
  return x1 - x0 > 0.5 && y1 - y0 > 0.5 ? rectD(x0, y0, x1 - x0, y1 - y0) : '';
}

/** Substring bands of each module touched by a shade rectangle. */
export function hitSubstrings(
  layout: PanelLayout,
  rects: readonly ShadeRect[],
): { u0: number; u1: number; v0: number; v1: number }[] {
  const { length: L, moduleWidth: w } = layout;
  // Substrings run parallel to the long side: bands along u (landscape) or along v (portrait).
  const landscape = w >= L;
  const n = SUBSTRINGS_PER_MODULE;
  const out: { u0: number; u1: number; v0: number; v1: number }[] = [];
  for (const m of layout.modules) {
    for (let i = 0; i < n; i++) {
      const band = landscape
        ? { u0: m.u0, u1: m.u1, v0: (i * L) / n, v1: ((i + 1) * L) / n }
        : { u0: m.u0 + (i * w) / n, u1: m.u0 + ((i + 1) * w) / n, v0: 0, v1: L };
      const hit = rects.some(
        (r) =>
          Math.min(r.u1, band.u1) - Math.max(r.u0, band.u0) > 1e-9 &&
          Math.min(r.v1, band.v1) - Math.max(r.v0, band.v0) > 1e-9,
      );
      if (hit) out.push(band);
    }
  }
  return out;
}
