import { useId, type ReactNode } from 'react';
import styles from './Toggle.module.css';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Help text below (aria-describedby). */
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** On/off switch: <button role="switch" aria-checked> with a visible label. */
export function Toggle({ label, checked, onChange, hint, disabled, className }: ToggleProps) {
  const id = useId();
  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <div className={styles.row}>
        <span id={`${id}-label`} className={styles.label}>
          {label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${id}-label`}
          aria-describedby={hint ? `${id}-hint` : undefined}
          disabled={disabled}
          className={styles.switch}
          onClick={() => onChange(!checked)}
        >
          <span className={styles.thumb} aria-hidden="true" />
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}
