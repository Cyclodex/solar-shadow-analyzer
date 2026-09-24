// ─────────────────────────────────────────────
// SVG PATH BUILDERS
// ─────────────────────────────────────────────

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Polyline "M x y L x y …" through the points (coordinates rounded to 0.1 px), closed with "Z" when `close`
 * (an area). Empty string for none.
 */
export function linePath(points: readonly (readonly [number, number])[], close = false): string {
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    d += `${i === 0 ? 'M' : 'L'}${r1(x)} ${r1(y)}`;
  }
  return close && d ? `${d}Z` : d;
}

/**
 * Bar segment from y (top) to y + h: rounded top corners (radius r, clipped to the size), square bottom so
 * the bar stands on its baseline. Empty string for non-positive sizes.
 */
export function roundedTopBar(x: number, y: number, w: number, h: number, r = 4): string {
  if (!(w > 0) || !(h > 0)) return '';
  const rr = Math.max(0, Math.min(r, w / 2, h));
  const x1 = x + w;
  const y1 = y + h;
  if (rr === 0) return `M${r1(x)} ${r1(y1)}V${r1(y)}H${r1(x1)}V${r1(y1)}Z`;
  return (
    `M${r1(x)} ${r1(y1)}V${r1(y + rr)}` +
    `Q${r1(x)} ${r1(y)} ${r1(x + rr)} ${r1(y)}` +
    `H${r1(x1 - rr)}Q${r1(x1)} ${r1(y)} ${r1(x1)} ${r1(y + rr)}` +
    `V${r1(y1)}Z`
  );
}
