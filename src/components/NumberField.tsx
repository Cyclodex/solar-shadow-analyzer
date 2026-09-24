import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { FieldLimit } from '../model/defaults';
import { useFormat, useMessages, type Messages } from '../i18n';
import { InfoTip } from './InfoTip';
import { Slider, type SliderMark } from './Slider';
import { digitsOf, parseNumberInput } from './numberInput';
import styles from './NumberField.module.css';

export interface NumberFieldProps {
  label: string;
  value: number;
  /** Receives clamped values: live from the slider, on blur/Enter/arrow keys from the text input. */
  onChange: (value: number) => void;
  /** min/max/step, usually from LIMITS (model/defaults.ts). Individual props below override it. */
  limit?: FieldLimit;
  min?: number;
  max?: number;
  step?: number;
  /** Unit shown after the input and in aria-valuetext, e.g. "cm", "°", "%". */
  unit?: string;
  /** Decimals shown in the text input (default: decimals of `step`). Trailing zeros are dropped. */
  digits?: number;
  /** Show the slider (default true). */
  slider?: boolean;
  /** Narrower slider range than min…max (typing still accepts the full range). */
  sliderMin?: number;
  sliderMax?: number;
  /** Ticks below the slider. */
  marks?: readonly SliderMark[];
  /** Help text below the field (aria-describedby). */
  hint?: ReactNode;
  /** Content of an InfoTip next to the label. */
  info?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** CSS width of the number input (default from the stylesheet, ~6.5ch), e.g. '9ch' for coordinates. */
  inputWidth?: string;
}

const de = {
  range: (min: string, max: string) => `Erlaubt: ${min} bis ${max}`,
  invalid: 'Bitte eine Zahl eingeben',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    range: (min, max) => `Allowed: ${min} to ${max}`,
    invalid: 'Please enter a number',
  },
};

const clampTo = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Plain text of a value for the input (no grouping, dot decimal, trailing zeros dropped). */
const toInputText = (v: number, digits: number): string => String(Number(v.toFixed(digits)));

/**
 * Labelled number input + slider. The text input keeps a local draft while typing (intermediate values
 * like "", "-" or "1" for 150 are never rejected) and commits on blur, Enter or ArrowUp/Down, clamped to
 * min…max; Escape discards the draft. The slider commits live.
 */
export function NumberField({
  label,
  value,
  onChange,
  limit,
  min = limit?.min ?? -Infinity,
  max = limit?.max ?? Infinity,
  step = limit?.step ?? 1,
  unit,
  digits,
  slider = true,
  sliderMin,
  sliderMax,
  marks,
  hint,
  info,
  disabled,
  id,
  className,
  inputWidth,
}: NumberFieldProps) {
  const t = useMessages(messages);
  const f = useFormat();
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const labelId = `${autoId}-label`;
  const hintId = `${autoId}-hint`;
  const errorId = `${autoId}-error`;
  const shownDigits = digits ?? digitsOf(step);
  const [draft, setDraft] = useState<string | null>(null);

  const parsed = draft === null ? value : parseNumberInput(draft);
  const invalid = draft !== null && (parsed === null || parsed < min || parsed > max);
  const rangeText = t.range(
    f.num(min, digitsOf(step)),
    `${f.num(max, digitsOf(step))}${unit ? ` ${unit}` : ''}`,
  );

  const commit = (): void => {
    if (draft === null) return;
    setDraft(null);
    const v = parseNumberInput(draft);
    if (v === null) return;
    const c = clampTo(v, min, max);
    if (c !== value) onChange(c);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      commit();
    } else if (e.key === 'Escape') {
      setDraft(null);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const base = parsed ?? value;
      const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
      const next = clampTo(Number((base + delta).toFixed(Math.max(shownDigits, digitsOf(step)))), min, max);
      setDraft(null);
      if (next !== value) onChange(next);
    }
  };

  const valueText = (v: number): string => `${f.num(v, shownDigits)}${unit ? ` ${unit}` : ''}`;
  const describedBy = [hint ? hintId : null, invalid ? errorId : null].filter(Boolean).join(' ') || undefined;
  const hasSlider = slider && Number.isFinite(sliderMin ?? min) && Number.isFinite(sliderMax ?? max);

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <div className={styles.head}>
        <label id={labelId} htmlFor={inputId} className={styles.label}>
          {label}
        </label>
        {info && <InfoTip label={label}>{info}</InfoTip>}
        <div className={styles.inputWrap} data-invalid={invalid || undefined}>
          <input
            id={inputId}
            className={styles.input}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={draft ?? toInputText(value, shownDigits)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            style={inputWidth ? { width: inputWidth } : undefined}
            aria-describedby={describedBy}
            title={rangeText}
          />
          {unit && (
            <span className={styles.unit} aria-hidden="true">
              {unit}
            </span>
          )}
        </div>
      </div>
      {hasSlider && (
        <Slider
          value={value}
          min={sliderMin ?? min}
          max={sliderMax ?? max}
          step={step}
          onChange={onChange}
          valueText={valueText}
          marks={marks}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={hint ? hintId : undefined}
        />
      )}
      {invalid && (
        <p id={errorId} className={styles.error} role="status">
          {parsed === null ? t.invalid : rangeText}
        </p>
      )}
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}
