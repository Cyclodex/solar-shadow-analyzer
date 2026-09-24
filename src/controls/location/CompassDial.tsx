import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
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
 */
export function CompassDial({ value, onChange, label, valueText, describedBy, className }: CompassDialProps) {
  const lang = useLang();
  const dragging = useRef(false);

  const set = (deg: number): void => {
    const next = wrap(deg);
    if (next !== value) onChange(next);
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < 2) return; // centre: direction undefined
    set(toDeg(Math.atan2(dx, -dy)));
  };

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
        e.preventDefault(); // no text selection / native drag
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragging.current = true;
        fromPointer(e);
      }}
      onPointerMove={(e) => {
        if (dragging.current) fromPointer(e);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
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
