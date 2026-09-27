// ─────────────────────────────────────────────
// PLANAR POLYGON HELPERS
// Rings are arrays of [x, y] vertices in a right-handed plane (x = east, y = north for building
// footprints), open (the last vertex is not a copy of the first). Counter-clockwise (CCW) = positive
// signed area. Pure functions, no allocation-heavy libraries.
// ─────────────────────────────────────────────

/** A vertex [x, y]. */
export type Vertex = [number, number];
/** A read-only vertex (inputs). */
export type ReadonlyVertex = readonly [number, number];
/** An open polygon ring. */
export type Ring = Vertex[];

/** Signed area (shoelace): > 0 for counter-clockwise rings, < 0 for clockwise ones; 0 below 3 vertices. */
export function ringArea(ring: readonly ReadonlyVertex[]): number {
  const n = ring.length;
  if (n < 3) return 0;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

/** Copy of `ring` with counter-clockwise orientation; a clockwise ring is reversed, keeping its first vertex. */
export function ensureCcw(ring: readonly ReadonlyVertex[]): Ring {
  const copy = ring.map((p): Vertex => [p[0], p[1]]);
  if (ringArea(copy) >= 0 || copy.length < 3) return copy;
  return [copy[0], ...copy.slice(1).reverse()];
}

/**
 * Copy of `ring` without consecutive duplicate vertices (|Δx|, |Δy| ≤ eps) and without a closing vertex that
 * repeats the first one.
 */
export function dropDuplicateVertices(ring: readonly ReadonlyVertex[], eps = 0): Ring {
  const same = (a: ReadonlyVertex, b: ReadonlyVertex): boolean =>
    Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
  const out: Ring = [];
  for (const p of ring) if (out.length === 0 || !same(out[out.length - 1], p)) out.push([p[0], p[1]]);
  while (out.length > 1 && same(out[0], out[out.length - 1])) out.pop();
  return out;
}

/** Even-odd point-in-polygon test (points exactly on an edge may count either way). */
export function pointInRing(ring: readonly ReadonlyVertex[], x: number, y: number): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (x, y) to the segment a–b. */
export function segmentDistance(x: number, y: number, a: ReadonlyVertex, b: ReadonlyVertex): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/** Distance from (x, y) to the polygon area: 0 inside, else the distance to the nearest edge. */
export function ringDistance(ring: readonly ReadonlyVertex[], x: number, y: number): number {
  if (ring.length === 0) return Infinity;
  if (ring.length >= 3 && pointInRing(ring, x, y)) return 0;
  let best = Infinity;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) best = Math.min(best, segmentDistance(x, y, ring[j], ring[i]));
  return best;
}

/**
 * Visvalingam–Whyatt simplification to at most `maxVertices` vertices (≥ 3): repeatedly removes the vertex
 * whose triangle with its neighbours has the smallest area (ties: the earliest vertex). Coordinates are never
 * changed. Removing vertices can make two equal vertices neighbours (a keyhole ring from bridgeHoles whose
 * small courtyard is simplified away): such repeats are dropped at the end (dropDuplicateVertices), so the
 * result may have fewer than `maxVertices` vertices, and simplifying it again returns an unchanged copy
 * (idempotent; a ring that is already small enough is returned as an unchanged copy). O(n log n) (binary heap
 * of triangle areas): rings come from untrusted input (share links, files).
 */
export function simplifyRing(ring: readonly ReadonlyVertex[], maxVertices: number): Ring {
  const pts = ring.map((p): Vertex => [p[0], p[1]]);
  const target = Math.max(3, Math.floor(maxVertices));
  const n = pts.length;
  if (n <= target) return pts;
  // Circular doubly linked list over the original indices; order (and so "earliest") never changes.
  const prev = Array.from({ length: n }, (_, i) => (i - 1 + n) % n);
  const next = Array.from({ length: n }, (_, i) => (i + 1) % n);
  const removed = new Uint8Array(n);
  const version = new Uint32Array(n);
  const tri = (k: number): number => {
    const a = pts[prev[k]];
    const b = pts[k];
    const c = pts[next[k]];
    return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  };
  // Min-heap of [area, index, version]; stale entries (older version, removed vertex) are skipped when popped.
  type Entry = [number, number, number];
  const heap: Entry[] = [];
  const less = (p: Entry, q: Entry): boolean => p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]);
  const push = (e: Entry): void => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (!less(heap[i], heap[parent])) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  };
  const pop = (): Entry | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  for (let k = 0; k < n; k++) push([tri(k), k, 0]);
  for (let left = n; left > target;) {
    const e = pop();
    if (!e) break;
    const k = e[1];
    if (removed[k] || e[2] !== version[k]) continue;
    removed[k] = 1;
    left--;
    const p = prev[k];
    const q = next[k];
    next[p] = q;
    prev[q] = p;
    for (const j of [p, q]) push([tri(j), j, ++version[j]]);
  }
  return dropDuplicateVertices(pts.filter((_, i) => !removed[i]));
}

/**
 * One ring for a polygon with holes (keyhole / bridge construction): each hole is joined to the outer ring by
 * a zero-width bridge from its vertex nearest to the outer ring. The result has the same area and edges (plus
 * the bridges), so edge-based horizon sweeps and point-in-polygon tests treat courtyards correctly: a point in
 * a courtyard is outside. `outer` should be CCW and holes CW (they are re-oriented otherwise).
 */
export function bridgeHoles(
  outer: readonly ReadonlyVertex[],
  holes: readonly (readonly ReadonlyVertex[])[],
): Ring {
  let ring = ensureCcw(outer);
  for (const h of holes) {
    if (h.length < 3) continue;
    const hole = ensureCcw(h).reverse(); // clockwise
    let bi = 0;
    let bj = 0;
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      for (let j = 0; j < hole.length; j++) {
        const d = Math.hypot(ring[i][0] - hole[j][0], ring[i][1] - hole[j][1]);
        if (d < best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    const rotated = [...hole.slice(bj), ...hole.slice(0, bj)];
    const a = ring[bi];
    const b = rotated[0];
    ring = [...ring.slice(0, bi + 1), ...rotated, [b[0], b[1]], [a[0], a[1]], ...ring.slice(bi + 1)];
  }
  return ring;
}

/**
 * Sutherland–Hodgman clip of a ring to the axis-aligned box [x0, x1] × [y0, y1]. Intersection points get the
 * box coordinate exactly (e.g. x = x1), so pieces clipped on both sides of a shared box edge meet on it.
 * A concave ring whose inside part falls apart comes back as one ring with zero-width connections along the
 * box edge. Returns [] when nothing is inside.
 */
export function clipRingToBox(
  ring: readonly ReadonlyVertex[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Ring {
  type Side = {
    inside: (p: ReadonlyVertex) => boolean;
    cut: (a: ReadonlyVertex, b: ReadonlyVertex) => Vertex;
  };
  const sides: Side[] = [
    {
      inside: (p) => p[0] >= x0,
      cut: (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])],
    },
    {
      inside: (p) => p[0] <= x1,
      cut: (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])],
    },
    {
      inside: (p) => p[1] >= y0,
      cut: (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0],
    },
    {
      inside: (p) => p[1] <= y1,
      cut: (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1],
    },
  ];
  let out: Ring = ring.map((p): Vertex => [p[0], p[1]]);
  for (const side of sides) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = side.inside(cur);
      const prevIn = side.inside(prev);
      if (curIn) {
        if (!prevIn) out.push(side.cut(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(side.cut(prev, cur));
      }
    }
  }
  return dropDuplicateVertices(out);
}

/** Axis-aligned bounding box [minX, minY, maxX, maxY] of a ring ([∞, ∞, −∞, −∞] when empty). */
export function ringBounds(ring: readonly ReadonlyVertex[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}
