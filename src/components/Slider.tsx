import type { ChangeEvent } from 'react';
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

/** Native range input with a filled track and optional marks. */
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
  const handle = (e: ChangeEvent<HTMLInputElement>): void => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) onChange(v);
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
