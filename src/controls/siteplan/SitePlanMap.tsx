import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Button } from '../../components/Button';
import { MinusIcon, PlusIcon, ResetIcon } from '../../components/icons';
import { useElementWidth } from '../../components/svg/useElementWidth';
import type { FacadeEdge } from '../../model/buildings';
import {
  pointInRing,
  ringArea,
  segmentDistance,
  type ReadonlyVertex,
  type Vertex,
} from '../../model/polygon';
import { clamp, toRad } from '../../model/units';
import {
  fitView,
  placementAt,
  placementPoint,
  scaleBarLength,
  zoomView,
  type MapView,
  type Placement,
} from './sitePlanModel';
import styles from './SitePlan.module.css';
import { useSun } from './useSun';

// ─────────────────────────────────────────────
// SITE PLAN MAP (SVG top view, north up; owned by the buildings feature)
// Footprints in a world group (anchor ENU metres, y flipped, non-scaling strokes), markers in screen pixels.
// Touch rules (docs/ARCHITECTURE.md "Touch"): one finger scrolls the page (touch-action: pan-y); a tap acts
// on the click the browser sends for a real tap; a sideways drag pans the plan only after TOUCH_SLOP px of
// sideways movement; two fingers zoom and pan. The balcony handle (an HTML target HIT_TOUCH px around it) leaves
// the page the pan across its facade (touch-action pan-y for a facade running sideways on screen, pan-x for one
// running up and down) and moves the balcony once the finger travels TOUCH_SLOP px along the facade (before, only
// sideways: along a facade running up and down the page scrolled instead). The mouse wheel scrolls the page;
// Ctrl/⌘ + wheel (and trackpad pinch) zooms. Buttons and keys zoom as well.
// ─────────────────────────────────────────────

/** Finger travel (px) that still counts as a tap; a sideways drag starts beyond it. */
const TOUCH_SLOP = 8;
/** Mouse travel (px) before a press becomes a pan (below: a click). */
const MOUSE_SLOP = 3;
/** Hit radius around facade edges and the balcony handle (px): fingers, mouse. */
const HIT_TOUCH = 22;
const HIT_MOUSE = 12;
/**
 * A tap this close to a party wall (px) always explains it; farther away (within the hit radius) a tap inside
 * another building selects that building: the neighbours of a narrow row house lie within the finger's reach
 * of its party walls.
 */
const PARTY_EXACT_PX = 6;
/** Room the zoom buttons take at the top right (px): marker labels stay out of it. */
const ZOOM_COLUMN_W = 60;
const ZOOM_COLUMN_H = 160;
/** Estimated width per character of a marker label (12 px, semi-bold). */
const LABEL_CHAR_PX = 7.2;
/** Zoom step of the buttons and keys. */
const ZOOM_STEP = 1.6;
/** Keyboard pan step, share of the view. */
const PAN_STEP = 0.15;
/** Map height: this share of its width, within MIN_H…MAX_H px. */
const ASPECT = 0.78;
const MIN_H = 240;
const MAX_H = 440;
/** The wheel hint stays this long (ms). */
const WHEEL_HINT_MS = 1800;

export type MapBuildingKind = 'own' | 'neighbour' | 'edited' | 'manual' | 'removed';

export interface MapBuilding {
  id: string;
  footprint: readonly ReadonlyVertex[];
  kind: MapBuildingKind;
}

export interface SitePlanMapLabels {
  map: string;
  help: string;
  zoomIn: string;
  zoomOut: string;
  recenter: string;
  wheelHint: string;
  north: string;
  location: string;
}

export interface SitePlanMapProps {
  buildings: readonly MapBuilding[];
  /** Own footprint (initial view), null when unknown. */
  own: readonly ReadonlyVertex[] | null;
  /** Facade candidates of the own building. */
  edges: readonly FacadeEdge[];
  /** Balcony shown (draft, configured or suggested). */
  placement: Placement | null;
  /** Width of the panel rows, m (drawn along the facade) … */
  rowWidth: number;
  /** … at this distance in front of it (the railing), m. */
  rowOffset: number;
  /** Address point (or import centre) with its label. */
  marker: { point: Vertex; label: string } | null;
  /** The configured location when it is not the shown balcony (e.g. still the address point). */
  location: Vertex | null;
  selectedId: string | null;
  /** Sun direction ray at the selected time, from this site (null = off). */
  sunSite: { latitude: number; longitude: number } | null;
  /** The view re-fits when this changes (another own building or anchor). */
  fitKey: string;
  labels: SitePlanMapLabels;
  /** Text alternative of the drawing (screen readers). */
  description: string;
  /** A selectable edge was tapped (or the balcony dragged along its facade). */
  onPlace: (placement: Placement) => void;
  /** A party wall of the own building was tapped. */
  onPartyWall: (edge: FacadeEdge) => void;
  /** A building was tapped (null: empty ground). */
  onSelect: (id: string | null) => void;
}

type Gesture =
  | { kind: 'press'; id: number; x0: number; y0: number; touch: boolean; handle: boolean }
  | { kind: 'pan'; id: number; x0: number; y0: number; view0: MapView }
  | { kind: 'drag'; id: number }
  | { kind: 'pinch'; d0: number; world: Vertex; span0: number }
  | { kind: 'idle' };

/** Screen transform of a view on a W × H map: px = tx + x·s, py = ty − y·s. */
interface Screen {
  s: number;
  tx: number;
  ty: number;
  w: number;
  h: number;
}

function screenOf(view: MapView, w: number, h: number): Screen {
  const s = w / view.span;
  return { s, tx: w / 2 - view.cx * s, ty: h / 2 + view.cy * s, w, h };
}

const toScreen = (sc: Screen, p: ReadonlyVertex): Vertex => [sc.tx + p[0] * sc.s, sc.ty - p[1] * sc.s];
const toWorld = (sc: Screen, px: number, py: number): Vertex => [(px - sc.tx) / sc.s, (sc.ty - py) / sc.s];

/** SVG path of a footprint in world metres with y flipped (the world group scales by s, −s). */
function ringPath(ring: readonly ReadonlyVertex[]): string {
  return `M${ring.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z`;
}

const KIND_CLASS: Record<MapBuildingKind, string | undefined> = {
  own: styles.own,
  neighbour: styles.neighbour,
  edited: styles.edited,
  manual: styles.manual,
  removed: styles.removed,
};

/** Footprints (memoised: pan and zoom only change the group transform). */
const Footprints = memo(function Footprints({
  buildings,
  selectedId,
}: {
  buildings: readonly MapBuilding[];
  selectedId: string | null;
}) {
  const paths = useMemo(() => buildings.map((b) => ({ ...b, d: ringPath(b.footprint) })), [buildings]);
  return (
    <>
      {paths.map((b) => (
        <path
          key={b.id}
          d={b.d}
          className={[styles.footprint, KIND_CLASS[b.kind], b.id === selectedId && styles.selected]
            .filter(Boolean)
            .join(' ')}
          data-building={b.id}
        />
      ))}
    </>
  );
});

/** Unit screen direction (x right, y down) of a true-north azimuth. */
const screenDir = (azimuth: number): Vertex => [Math.sin(toRad(azimuth)), -Math.cos(toRad(azimuth))];

/** Ray from the balcony towards the sun (to the edge of the map); nothing while the sun is down. */
function SunRay({
  site,
  from,
  sc,
}: {
  site: { latitude: number; longitude: number };
  from: Vertex;
  sc: Screen;
}) {
  const sun = useSun(site);
  if (sun.altitude <= 0) return null;
  const [dx, dy] = screenDir(sun.azimuth);
  // Distance to the map border along the ray (at least 40 px, so a balcony near the border still shows it).
  const tx = dx > 1e-9 ? (sc.w - from[0]) / dx : dx < -1e-9 ? -from[0] / dx : Infinity;
  const ty = dy > 1e-9 ? (sc.h - from[1]) / dy : dy < -1e-9 ? -from[1] / dy : Infinity;
  const len = Math.max(40, Math.min(tx, ty) - 14);
  const end: Vertex = [from[0] + dx * len, from[1] + dy * len];
  return (
    <g className={styles.sun}>
      <line x1={from[0]} y1={from[1]} x2={end[0]} y2={end[1]} className={styles.sunRay} />
      <circle cx={end[0]} cy={end[1]} r={7} className={styles.sunDisc} />
    </g>
  );
}

/**
 * The site plan drawing with zoom buttons. Stateless apart from the view (centre and width), which re-fits
 * when `fitKey` changes; taps and drags report through the callbacks.
 */
export function SitePlanMap({
  buildings,
  own,
  edges,
  placement,
  rowWidth,
  rowOffset,
  marker,
  location,
  selectedId,
  sunSite,
  fitKey,
  labels,
  description,
  onPlace,
  onPartyWall,
  onSelect,
}: SitePlanMapProps) {
  const [widthRef, width] = useElementWidth<HTMLDivElement>({ fallback: 320, min: 200 });
  const height = Math.round(clamp(width * ASPECT, MIN_H, MAX_H));
  const helpId = useId();
  const descId = useId();

  const fitted = useMemo(() => {
    const points: Vertex[] = [];
    if (placement) points.push(placementPoint(placement));
    if (marker) points.push(marker.point);
    return fitView(own, points, height / width);
    // Re-fit only for another site (fitKey) or map size, not for every balcony move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, width, height]);
  const [viewState, setViewState] = useState<{ key: string; view: MapView } | null>(null);
  const view = viewState?.key === fitKey ? viewState.view : fitted;
  const setView = (next: MapView): void => setViewState({ key: fitKey, view: next });
  const sc = screenOf(view, width, height);

  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture>({ kind: 'idle' });
  const pointers = useRef(new Map<number, Vertex>());
  /** The press moved the plan or the balcony: the click that follows it does nothing. */
  const moved = useRef(false);
  const lastTouch = useRef(false);
  const [wheelHint, setWheelHint] = useState(false);
  /** The latest view and size for the native wheel listener (updated after each render and by the wheel). */
  const latest = useRef({ view, width, height });
  useLayoutEffect(() => {
    latest.current = { view, width, height };
  });

  /** Pointer position in map pixels. */
  const local = (clientX: number, clientY: number): Vertex => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return [clientX, clientY];
    return [((clientX - r.left) * width) / r.width, ((clientY - r.top) * height) / r.height];
  };

  const balcony = placement ? toScreen(sc, placementPoint(placement)) : null;
  /** Screen direction (unit, y down) of the balcony's facade edge. */
  const edgeDir: Vertex | null = placement
    ? [
        (placement.edge.b[0] - placement.edge.a[0]) / placement.edge.length,
        -(placement.edge.b[1] - placement.edge.a[1]) / placement.edge.length,
      ]
    : null;

  // Ctrl/⌘ + wheel zooms at the cursor (trackpad pinch sends ctrlKey); a plain wheel scrolls the page and
  // shows how to zoom. A native listener: React's onWheel is passive and cannot prevent the page zoom.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) {
        setWheelHint(true);
        clearTimeout(timer);
        timer = setTimeout(() => setWheelHint(false), WHEEL_HINT_MS);
        return;
      }
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const cur = latest.current;
      const s = screenOf(cur.view, cur.width, cur.height);
      const px = r.width > 0 ? ((e.clientX - r.left) * s.w) / r.width : s.w / 2;
      const py = r.height > 0 ? ((e.clientY - r.top) * s.h) / r.height : s.h / 2;
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      const next = zoomView(cur.view, Math.exp(-delta * 0.0025), toWorld(s, px, py));
      latest.current = { ...cur, view: next }; // several wheel events may arrive before the next render
      setViewState({ key: fitKey, view: next });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      svg.removeEventListener('wheel', onWheel);
      clearTimeout(timer);
    };
  }, [fitKey]);

  const nearHandle = (px: number, py: number, touch: boolean): boolean =>
    balcony !== null && Math.hypot(px - balcony[0], py - balcony[1]) <= (touch ? HIT_TOUCH : HIT_MOUSE);

  const dragTo = (px: number, py: number): void => {
    if (!placement) return;
    const next = placementAt(placement.edge, toWorld(sc, px, py));
    if (next.along !== placement.along) onPlace(next);
  };

  const startPinch = (): void => {
    const [a, b] = [...pointers.current.values()];
    const mid: Vertex = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    gesture.current = {
      kind: 'pinch',
      d0: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])),
      world: toWorld(sc, mid[0], mid[1]),
      span0: view.span,
    };
    moved.current = true;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const touch = e.pointerType === 'touch';
    lastTouch.current = touch;
    const [px, py] = local(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, [px, py]);
    if (touch && pointers.current.size === 2) {
      // Two fingers: zoom and pan the plan (never the page: touch-action has no pinch-zoom here).
      for (const id of pointers.current.keys()) e.currentTarget.setPointerCapture?.(id);
      startPinch();
      return;
    }
    if (pointers.current.size > 1) return;
    moved.current = false;
    const handle = nearHandle(px, py, touch);
    gesture.current = { kind: 'press', id: e.pointerId, x0: px, y0: py, touch, handle };
    if (touch) return; // may be a scroll: wait for a tap (click) or a sideways drag
    e.preventDefault(); // no text selection
    frameRef.current?.focus({ preventScroll: true });
    if (handle) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      gesture.current = { kind: 'drag', id: e.pointerId };
      moved.current = true;
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(e.pointerId)) return;
    const [px, py] = local(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, [px, py]);
    const g = gesture.current;
    if (g.kind === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const d = Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]));
      const mid: Vertex = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const span = zoomView({ cx: 0, cy: 0, span: g.span0 }, d / g.d0).span;
      const s = width / span;
      setView({
        cx: g.world[0] - (mid[0] - width / 2) / s,
        cy: g.world[1] + (mid[1] - height / 2) / s,
        span,
      });
      return;
    }
    if (g.kind === 'press' && g.id === e.pointerId) {
      const dx = px - g.x0;
      const dy = py - g.y0;
      // On the handle a drag follows its facade (the page keeps only the pan across it).
      let start: boolean;
      if (!g.touch) start = Math.hypot(dx, dy) > MOUSE_SLOP;
      else if (g.handle && edgeDir) {
        const along = dx * edgeDir[0] + dy * edgeDir[1];
        const across = dy * edgeDir[0] - dx * edgeDir[1];
        start = Math.abs(along) > TOUCH_SLOP && Math.abs(along) >= Math.abs(across);
      } else start = Math.abs(dx) > TOUCH_SLOP && Math.abs(dx) > Math.abs(dy);
      if (!start) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      moved.current = true;
      if (g.handle) {
        gesture.current = { kind: 'drag', id: e.pointerId };
        dragTo(px, py);
      } else {
        gesture.current = { kind: 'pan', id: e.pointerId, x0: g.x0, y0: g.y0, view0: view };
      }
    }
    const cur = gesture.current;
    if (cur.kind === 'drag' && cur.id === e.pointerId) dragTo(px, py);
    else if (cur.kind === 'pan' && cur.id === e.pointerId) {
      const v = cur.view0;
      const s = width / v.span;
      setView({ ...v, cx: v.cx - (px - cur.x0) / s, cy: v.cy + (py - cur.y0) / s });
    }
  };

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const g = gesture.current;
    if (g.kind === 'pinch' ? pointers.current.size === 0 : g.kind !== 'idle' && g.id === e.pointerId) {
      gesture.current = { kind: 'idle' };
    }
    // The browser took the touch for a scroll: nothing happened here (no click follows).
    if (e.type === 'pointercancel') moved.current = false;
  };

  const onClick = (e: MouseEvent<HTMLDivElement>): void => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    const [px, py] = local(e.clientX, e.clientY);
    const hit = lastTouch.current ? HIT_TOUCH : HIT_MOUSE;
    // Nearest own edge within reach (screen distance): place the balcony there, or explain a party wall.
    let best: FacadeEdge | null = null;
    let bestD = hit;
    for (const edge of edges) {
      if (edge.interior) continue;
      const d = segmentDistance(px, py, toScreen(sc, edge.a), toScreen(sc, edge.b));
      if (d <= bestD) {
        bestD = d;
        best = edge;
      }
    }
    if (best?.selectable) {
      onPlace(placementAt(best, toWorld(sc, px, py)));
      return;
    }
    // The smallest footprint under the pointer.
    const [x, y] = toWorld(sc, px, py);
    let found: MapBuilding | null = null;
    let area = Infinity;
    for (const b of buildings) {
      if (!pointInRing(b.footprint, x, y)) continue;
      const a = Math.abs(ringArea(b.footprint));
      if (a < area) {
        area = a;
        found = b;
      }
    }
    if (best?.party && (bestD <= PARTY_EXACT_PX || !found || found.kind === 'own')) {
      onPartyWall(best);
      return;
    }
    onSelect(found?.id ?? null);
  };

  const zoomBy = (factor: number): void => setView(zoomView(view, factor));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const step = view.span * PAN_STEP;
    const pan: Record<string, Vertex> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (pan[e.key]) {
      setView({ ...view, cx: view.cx + pan[e.key][0], cy: view.cy + pan[e.key][1] });
    } else if (e.key === '+' || e.key === '=') {
      zoomBy(ZOOM_STEP);
    } else if (e.key === '-' || e.key === '_') {
      zoomBy(1 / ZOOM_STEP);
    } else if (e.key === '0' || e.key === 'Home') {
      setViewState(null);
    } else {
      return;
    }
    e.preventDefault();
  };

  // Scale bar: a round length of at most 30 % of the width.
  const barM = scaleBarLength(view.span * 0.3);
  const barPx = barM * sc.s;

  // Facade edges of the own building in screen pixels.
  const edgeLines = edges
    .filter((edge) => !edge.interior)
    .map((edge) => ({ edge, a: toScreen(sc, edge.a), b: toScreen(sc, edge.b) }));

  let balconyMarks: ReactNode = null;
  if (placement && balcony) {
    const { edge } = placement;
    const [ux, uy] = [(edge.b[0] - edge.a[0]) / edge.length, (edge.b[1] - edge.a[1]) / edge.length];
    const half = Math.max(rowWidth / 2, 3 / sc.s);
    const p = placementPoint(placement);
    const nx = Math.sin(toRad(edge.azimuth)) * rowOffset;
    const ny = Math.cos(toRad(edge.azimuth)) * rowOffset;
    const r0 = toScreen(sc, [p[0] + nx - ux * half, p[1] + ny - uy * half]);
    const r1 = toScreen(sc, [p[0] + nx + ux * half, p[1] + ny + uy * half]);
    const [dx, dy] = screenDir(edge.azimuth);
    const tip: Vertex = [balcony[0] + dx * 34, balcony[1] + dy * 34];
    const side: Vertex = [-dy, dx];
    const [a, b] = [toScreen(sc, edge.a), toScreen(sc, edge.b)];
    balconyMarks = (
      <g>
        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={styles.edgeChosen} />
        <line
          x1={balcony[0]}
          y1={balcony[1]}
          x2={tip[0] - dx * 6}
          y2={tip[1] - dy * 6}
          className={styles.arrow}
        />
        <path
          d={`M${tip[0]} ${tip[1]}L${tip[0] - dx * 10 + side[0] * 6} ${tip[1] - dy * 10 + side[1] * 6}L${tip[0] - dx * 10 - side[0] * 6} ${tip[1] - dy * 10 - side[1] * 6}Z`}
          className={styles.arrowHead}
        />
        <line x1={r0[0]} y1={r0[1]} x2={r1[0]} y2={r1[1]} className={styles.row} />
        <circle cx={balcony[0]} cy={balcony[1]} r={HIT_TOUCH} className={styles.handleHit} />
        <circle cx={balcony[0]} cy={balcony[1]} r={8} className={styles.handle} data-handle="" />
      </g>
    );
  }

  const markerPx = marker ? toScreen(sc, marker.point) : null;
  // The label goes left of the marker where it would run under the zoom buttons or off the map.
  const markerLeft =
    markerPx !== null &&
    marker !== null &&
    ((): boolean => {
      const right = markerPx[0] + 10 + marker.label.length * LABEL_CHAR_PX;
      const underButtons = markerPx[1] < ZOOM_COLUMN_H && right > width - ZOOM_COLUMN_W;
      return underButtons || right > width - 4;
    })();
  const locationPx = location ? toScreen(sc, location) : null;

  return (
    <div className={styles.mapWrap} ref={widthRef}>
      {/* The drawing is a keyboard-operable group (pan and zoom); its content is described in text. */}
      <div
        ref={frameRef}
        className={styles.frame}
        role="group"
        tabIndex={0}
        aria-label={labels.map}
        aria-describedby={`${descId} ${helpId}`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClick={onClick}
      >
        <svg
          ref={svgRef}
          className={styles.map}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
          focusable="false"
        >
          <rect width={width} height={height} className={styles.ground} />
          <g transform={`matrix(${sc.s} 0 0 ${-sc.s} ${sc.tx} ${sc.ty})`}>
            <Footprints buildings={buildings} selectedId={selectedId} />
          </g>
          {edgeLines.map(({ edge, a, b }) => (
            <g key={edge.index} data-edge={edge.index} data-selectable={edge.selectable || undefined}>
              <line
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                className={edge.selectable ? styles.edge : edge.party ? styles.party : styles.edgeShort}
              />
              {edge.selectable && <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={styles.edgeHit} />}
            </g>
          ))}
          {locationPx && (
            <g className={styles.locationMark}>
              <circle cx={locationPx[0]} cy={locationPx[1]} r={6} />
              <title>{labels.location}</title>
            </g>
          )}
          {markerPx && marker && (
            <g className={styles.marker}>
              <path
                d={`M${markerPx[0]} ${markerPx[1] - 7}L${markerPx[0] + 7} ${markerPx[1]}L${markerPx[0]} ${markerPx[1] + 7}L${markerPx[0] - 7} ${markerPx[1]}Z`}
              />
              <text
                x={markerLeft ? markerPx[0] - 10 : markerPx[0] + 10}
                y={markerPx[1] + 4}
                textAnchor={markerLeft ? 'end' : 'start'}
                className={styles.markerText}
              >
                {marker.label}
              </text>
            </g>
          )}
          {sunSite && balcony && <SunRay site={sunSite} from={balcony} sc={sc} />}
          {balconyMarks}
          <g className={styles.north} transform="translate(22 26)" aria-hidden="true">
            <path d="M0 -14L7 6L0 1L-7 6Z" />
            <text y={22} textAnchor="middle">
              {labels.north}
            </text>
          </g>
          <g className={styles.scale} transform={`translate(12 ${height - 14})`}>
            <path d={`M0 -6V0H${barPx.toFixed(1)}V-6`} />
            <text x={barPx / 2} y={-9} textAnchor="middle">
              {`${barM >= 1000 ? `${barM / 1000} km` : `${barM} m`}`}
            </text>
          </g>
        </svg>
        {balcony && (
          // Touch target of the balcony: its touch-action follows the facade (see the header).
          <span
            className={styles.handleTouch}
            style={{
              left: `${balcony[0]}px`,
              top: `${balcony[1]}px`,
              // The page may pan across the facade only: a drag along it moves the balcony.
              touchAction: edgeDir && Math.abs(edgeDir[1]) > Math.abs(edgeDir[0]) ? 'pan-x' : 'pan-y',
            }}
            aria-hidden="true"
            data-handle-touch=""
          />
        )}
      </div>
      <div className={styles.zoom}>
        <Button size="sm" variant="secondary" iconOnly icon={<PlusIcon />} onClick={() => zoomBy(ZOOM_STEP)}>
          {labels.zoomIn}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          iconOnly
          icon={<MinusIcon />}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          {labels.zoomOut}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          iconOnly
          icon={<ResetIcon />}
          onClick={() => setViewState(null)}
        >
          {labels.recenter}
        </Button>
      </div>
      {wheelHint && (
        <p className={styles.wheelHint} aria-hidden="true">
          {labels.wheelHint}
        </p>
      )}
      <p id={descId} className="sr-only">
        {description}
      </p>
      <p id={helpId} className="sr-only">
        {labels.help}
      </p>
    </div>
  );
}
