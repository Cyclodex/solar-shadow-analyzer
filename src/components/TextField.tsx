import { useId, useState, type ReactNode } from 'react';
import styles from './TextField.module.css';

export interface TextFieldProps {
  label: string;
  value: string;
  /** Called on blur / Enter with the trimmed draft (not on every keystroke). */
  onCommit: (value: string) => void;
  /** Returns an error message for an invalid draft (the draft is then not committed). */
  validate?: (value: string) => string | null;
  maxLength?: number;
  placeholder?: string;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** e.g. 'off', 'country-name'. Default 'off'. */
  autoComplete?: string;
}

/** Labelled text input with a local draft committed on blur/Enter (Escape discards). */
export function TextField({
  label,
  value,
  onCommit,
  validate,
  maxLength,
  placeholder,
  hint,
  disabled,
  className,
  autoComplete = 'off',
}: TextFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const error = draft !== null && validate ? validate(draft.trim()) : null;

  const commit = (): void => {
    if (draft === null) return;
    const v = draft.trim();
    if (validate?.(v)) return; // keep the draft visible with its error
    setDraft(null);
    if (v !== value) onCommit(v);
  };

  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        type="text"
        value={draft ?? value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') setDraft(null);
        }}
      />
      {error && (
        <p id={`${id}-error`} className={styles.error} role="status">
          {error}
        </p>
      )}
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}
