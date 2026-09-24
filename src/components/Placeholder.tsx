import type { ReactNode } from 'react';
import styles from './Placeholder.module.css';

export interface PlaceholderProps {
  /** Main message. */
  children: ReactNode;
  /** Secondary line (e.g. a data summary). */
  detail?: ReactNode;
}

/** Dashed empty-state box for views without content yet. */
export function Placeholder({ children, detail }: PlaceholderProps) {
  return (
    <div className={styles.box}>
      <p>{children}</p>
      {detail && <p className={styles.detail}>{detail}</p>}
    </div>
  );
}
