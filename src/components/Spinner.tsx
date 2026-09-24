import styles from './Spinner.module.css';

export interface SpinnerProps {
  /** Announced text (visually hidden unless `showLabel`). */
  label: string;
  showLabel?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/** Loading indicator with role="status". */
export function Spinner({ label, showLabel = false, size = 'md', className }: SpinnerProps) {
  return (
    <span role="status" className={[styles.root, className].filter(Boolean).join(' ')}>
      <span className={[styles.spinner, styles[size]].join(' ')} aria-hidden="true" />
      <span className={showLabel ? styles.label : 'sr-only'}>{label}</span>
    </span>
  );
}
