import { useRef, type ChangeEvent, type PointerEvent } from 'react';
import { cssVars } from './cssVars';
import styles from './Slider.module.css';

export interface SliderMark {
  value: number;
  /** Short visible label (also the tooltip). */
  label: string;
  /** Colour of the tick. Default 'default'. */
  tone?: 'default' | 'accent' | 'sun';
}

export interface SliderProps {
  id?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Called live while dragging / on every key press. */
  onChange: (value: number) => void;
  /** aria-valuetext, e.g. v => `${v} cm` or "12:30". */
  valueText?: (value: number) => string;
  /** Ticks below the track (e.g. sunrise/sunset, optimum). Marks outside min…max are not shown. */
  marks?: readonly SliderMark[];
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  disabled?: boolean;
  className?: string;
}

const frac = (v: number, min: number, max: number): number =>
  max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0;

/** Horizontal finger movement (px, more than vertical) after which a touch on the slider is a drag. */
export const TOUCH_DRAG_SLOP = 6;

/** A touch on the slider whose purpose (drag, tap or page scroll) is not known yet. */
interface TouchGesture {
  pointerId: number;
  x: number;
  y: number;
  dragging: boolean;
  /** Value set by the browser while the purpose was unknown (held back). */
  held: number | null;
}

/**
 * Native range input with a filled track and optional marks.
 *
 * Touch: Blink moves the thumb to the finger already on touchstart, also when the finger then scrolls the
 * page (the browser sends pointercancel once it scrolls). So a touch holds its value back until it is a
 * drag (horizontal movement, then live as usual) or a tap on the track (pointerup); a scroll drops it.
 * Mouse, pen, keyboard and assistive technology change the value immediately.
 */
export function Slider({
  id,
  value,
  min,
  max,
  step,
  onChange,
  valueText,
  marks,
  disabled,
  className,
  ...aria
}: SliderProps) {
  const visibleMarks = (marks ?? []).filter((m) => m.value >= min && m.value <= max);
  const touch = useRef<TouchGesture | null>(null);
  const commit = (v: number): void => {
    if (v !== value) onChange(v);
  };
  const handle = (e: ChangeEvent<HTMLInputElement>): void => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    const g = touch.current;
    // Held back: React resets the input to `value`, so the thumb stays until the touch turns out to be a drag.
    if (g && !g.dragging) g.held = v;
    else commit(v);
  };
  const onPointerDown = (e: PointerEvent<HTMLInputElement>): void => {
    touch.current =
      e.pointerType === 'touch'
        ? { pointerId: e.pointerId, x: e.clientX, y: e.clientY, dragging: false, held: null }
        : null;
  };
  const onPointerMove = (e: PointerEvent<HTMLInputElement>): void => {
    const g = touch.current;
    if (!g || g.dragging || e.pointerId !== g.pointerId) return;
    const dx = Math.abs(e.clientX - g.x);
    if (dx >= TOUCH_DRAG_SLOP && dx > Math.abs(e.clientY - g.y)) {
      g.dragging = true;
      if (g.held !== null) commit(g.held);
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLInputElement>): void => {
    const g = touch.current;
    if (!g || e.pointerId !== g.pointerId) return;
    touch.current = null;
    // A tap on the track (or a drag that never moved sideways enough): the value the browser set.
    if (!g.dragging && g.held !== null) commit(g.held);
  };
  const onPointerCancel = (e: PointerEvent<HTMLInputElement>): void => {
    // The browser took the touch for scrolling: the value from touchstart is dropped.
    if (touch.current?.pointerId === e.pointerId) touch.current = null;
  };
  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <input
        id={id}
        type="range"
        className={styles.range}
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={handle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        disabled={disabled}
        aria-valuetext={valueText?.(value)}
        style={cssVars({ '--fill': frac(value, min, max) })}
        {...aria}
      />
      {visibleMarks.length > 0 && (
        <div className={styles.marks} aria-hidden="true">
          {visibleMarks.map((m) => (
            <span
              key={`${m.label}-${m.value}`}
              className={[styles.mark, m.tone && styles[m.tone]].filter(Boolean).join(' ')}
              style={cssVars({ '--pos': frac(m.value, min, max) })}
              title={m.label}
            >
              <span className={styles.markLabel}>{m.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
