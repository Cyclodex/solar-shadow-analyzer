import { useId, type ReactNode } from 'react';
import styles from './SelectField.module.css';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Shown as first, disabled option when `value` matches no option (e.g. "Eigener Standort"). */
  placeholder?: string;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Labelled native <select>. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  hint,
  disabled,
  className,
}: SelectFieldProps<T>) {
  const id = useId();
  const known = options.some((o) => o.value === value);
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        value={known ? value : ''}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => {
          const next = options.find((o) => o.value === e.target.value);
          if (next) onChange(next.value);
        }}
      >
        {!known && (
          <option value="" disabled>
            {placeholder ?? value}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}
