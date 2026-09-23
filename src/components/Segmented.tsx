import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Segmented.module.css';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Tooltip; also the accessible name when `label` is not text. */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string | number> {
  /** Group name (radiogroup label). */
  label: string;
  /** Show the label above the control (default false: accessible name only). */
  showLabel?: boolean;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** Stretch the segments over the full width. */
  fullWidth?: boolean;
  className?: string;
}

/**
 * Single-choice segmented control with radio-group semantics: role="radiogroup" + role="radio"
 * (aria-checked), roving tabindex, Arrow keys / Home / End move the selection.
 */
export function Segmented<T extends string | number>({
  label,
  showLabel = false,
  options,
  value,
  onChange,
  size = 'md',
  fullWidth = false,
  className,
}: SegmentedProps<T>) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const selected = options.findIndex((o) => o.value === value);
  // Tab stop: the checked option, or the first enabled one if nothing is checked.
  const tabStop = selected >= 0 && !options[selected].disabled ? selected : (enabled[0] ?? -1);

  const select = (i: number): void => {
    const o = options[i];
    if (!o || o.disabled) return;
    refs.current[i]?.focus();
    if (o.value !== value) onChange(o.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (enabled.length === 0) return;
    const pos = Math.max(0, enabled.indexOf(tabStop));
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(pos + 1) % enabled.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (next === null) return;
    e.preventDefault();
    select(next);
  };

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <span id={labelId} className={showLabel ? styles.label : 'sr-only'}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className={[styles.group, styles[size], fullWidth && styles.full].filter(Boolean).join(' ')}
        onKeyDown={onKeyDown}
      >
        {options.map((o, i) => (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={i === selected}
            tabIndex={i === tabStop ? 0 : -1}
            disabled={o.disabled}
            title={o.title}
            aria-label={typeof o.label === 'string' ? undefined : o.title}
            className={styles.option}
            onClick={() => select(i)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
