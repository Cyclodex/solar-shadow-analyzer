import { useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { compassPoint, useLang } from '../../i18n';
import { normalizeDeg, toDeg, toRad } from '../../model/units';
import styles from './CompassDial.module.css';

export interface CompassDialProps {
  /** Facade azimuth, 0…359° (0 = north, clockwise). */
  value: number;
  onChange: (azimuth: number) => void;
  /** Accessible name of the slider. */
  label: string;
  /** aria-valuetext, e.g. "202° SSW". */
  valueText: (azimuth: number) => string;
  /** Id of a help text (aria-describedby). */
  describedBy?: string;
  className?: string;
}

/** Largest azimuth (LIMITS.building.facadeAzimuth.max). */
const MAX = 359;
/** Outer radius of the tick ring (viewBox units); the letters sit outside it. */
const RING = 76;
const LABEL_R = 88;

/** Max. finger travel (px) that still counts as a tap; a touch drag starts beyond it, sideways only. */
const TOUCH_SLOP = 8;

/** Integer azimuth in 0…359 (360 wraps to 0). */
const wrap = (deg: number): number => normalizeDeg(Math.round(deg));

/** Next (+1) or previous (−1) multiple of 45° from `v` (the 8 compass directions). */
function stepCompass(v: number, dir: 1 | -1): number {
  const k = dir > 0 ? Math.floor(v / 45) + 1 : Math.ceil(v / 45) - 1;
  return wrap(k * 45);
}

/** Tick marks every 10°, longer every 30° and at the cardinal points (static geometry). */
const TICKS = Array.from({ length: 36 }, (_, i) => {
  const a = i * 10;
  const len = a % 90 === 0 ? 11 : a % 30 === 0 ? 7 : 4;
  const s = Math.sin(toRad(a));
  const c = -Math.cos(toRad(a));
  return { a, major: a % 30 === 0, x1: s * (RING - len), y1: c * (RING - len), x2: s * RING, y2: c * RING };
});

const CARDINALS = [0, 90, 180, 270] as const;

/**
 * Circular slider for the facade azimuth (role="slider"): the building is drawn from above with its facade
 * (accent line), the panel row in front of it and an arrow along the outward normal. Drag or click on the
 * dial to turn it; keys: ←/→ or ↓/↑ ±1° (Shift ±10°), Page Up/Down to the next 45° direction, Home/End 0°/359°.
 * Touch: a tap sets the direction, a drag turns the dial only once it moves sideways (touch-action: pan-y),
 * so a vertical swipe scrolls the page and leaves the value alone (a scroll taken over by the browser after
 * the dial had started turning restores the value from before the touch).
 */
export function CompassDial({ value, onChange, label, valueText, describedBy, className }: CompassDialProps) {
  const lang = useLang();
  const dragging = useRef(false);
  /** The current press: start point, value before it, pointer; `touch` while it may still be a tap. */
  const press = useRef<{ x: number; y: number; value: number; id: number; touch: boolean } | null>(null);
  /** A touch tap that ended (pointerup) and is set by the click that follows it. */
  const tap = useRef<{ x: number; y: number } | null>(null);

  const set = (deg: number): void => {
    const next = wrap(deg);
    if (next !== value) onChange(next);
  };

  const fromPoint = (el: HTMLElement, clientX: number, clientY: number): void => {
    const r = el.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < 2) return; // centre: direction undefined
    set(toDeg(Math.atan2(dx, -dy)));
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>): void =>
    fromPoint(e.currentTarget, e.clientX, e.clientY);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const big = e.shiftKey ? 10 : 1;
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = value + big;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = value - big;
        break;
      case 'PageUp':
        next = stepCompass(value, 1);
        break;
      case 'PageDown':
        next = stepCompass(value, -1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = MAX;
        break;
      default:
        return;
    }
    e.preventDefault();
    set(next);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>): void => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    const p = press.current;
    press.current = null;
    // A touch that never turned into a drag: a tap if it stayed put. It is set on the click that follows,
    // which the browser sends for a real tap only (not for a long press or a tap that stops a fling).
    if (p?.touch && !dragging.current && p.id === e.pointerId) {
      tap.current =
        Math.hypot(e.clientX - p.x, e.clientY - p.y) <= TOUCH_SLOP ? { x: e.clientX, y: e.clientY } : null;
    }
    endDrag(e);
  };

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>): void => {
    // The browser took the gesture (a scroll): undo what the press changed.
    const p = press.current;
    press.current = null;
    tap.current = null;
    if (p && p.id === e.pointerId && p.value !== value) onChange(p.value);
    endDrag(e);
  };

  const onClick = (e: MouseEvent<HTMLDivElement>): void => {
    const t = tap.current;
    tap.current = null;
    if (!t || Math.hypot(e.clientX - t.x, e.clientY - t.y) > TOUCH_SLOP) return;
    e.currentTarget.focus();
    fromPoint(e.currentTarget, e.clientX, e.clientY);
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={MAX}
      aria-valuenow={value}
      aria-valuetext={valueText(value)}
      aria-describedby={describedBy}
      className={[styles.dial, className].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const touch = e.pointerType === 'touch';
        press.current = { x: e.clientX, y: e.clientY, value, id: e.pointerId, touch };
        tap.current = null;
        // Touch: nothing yet — the finger may be scrolling the page (see onPointerMove / onClick).
        if (touch) return;
        e.preventDefault(); // no text selection / native drag
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragging.current = true;
        fromPointer(e);
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (p?.touch && !dragging.current && p.id === e.pointerId) {
          const dx = Math.abs(e.clientX - p.x);
          if (dx > TOUCH_SLOP && dx > Math.abs(e.clientY - p.y)) {
            dragging.current = true;
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }
        }
        if (dragging.current) fromPointer(e);
      }}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
    >
      <svg viewBox="-100 -100 200 200" className={styles.svg} aria-hidden="true" focusable="false">
        <circle r={99} className={styles.face} />
        <circle r={RING} className={styles.ring} />
        {TICKS.map((k) => (
          <line
            key={k.a}
            x1={k.x1}
            y1={k.y1}
            x2={k.x2}
            y2={k.y2}
            className={k.major ? styles.tickMajor : styles.tick}
          />
        ))}
        {CARDINALS.map((a) => (
          <text
            key={a}
            x={Math.sin(toRad(a)) * LABEL_R}
            y={-Math.cos(toRad(a)) * LABEL_R}
            className={a === 0 ? styles.north : styles.cardinal}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {compassPoint(a, lang)}
          </text>
        ))}
        {/* Unrotated, the facade faces north (−y); rotate(value) turns it clockwise to the azimuth. */}
        <g transform={`rotate(${value})`}>
          <rect x={-30} y={0} width={60} height={28} rx={2} className={styles.house} />
          <rect x={-24} y={-9} width={48} height={5} rx={1} className={styles.panels} />
          <line x1={-30} y1={0} x2={30} y2={0} className={styles.facade} />
          <line x1={0} y1={-14} x2={0} y2={-52} className={styles.arrow} />
          <path d="M0 -64 L-7 -50 L7 -50 Z" className={styles.arrowHead} />
          <circle cy={-RING} r={7.5} className={styles.handle} />
        </g>
      </svg>
    </div>
  );
}
