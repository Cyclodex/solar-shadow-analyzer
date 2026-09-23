import type { ReactNode } from 'react';
import styles from './Card.module.css';

export interface CardProps {
  /** Element type. Default 'div'; use 'section' with a title for landmarks in lists. */
  as?: 'div' | 'section' | 'article';
  /** Optional heading (h3) at the top. */
  title?: ReactNode;
  /** Visual emphasis. */
  tone?: 'default' | 'accent' | 'warn' | 'bad';
  /** Smaller padding. */
  compact?: boolean;
  children?: ReactNode;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/** Surface container with border, radius and padding. */
export function Card({
  as: Tag = 'div',
  title,
  tone = 'default',
  compact,
  children,
  className,
  ...aria
}: CardProps) {
  return (
    <Tag
      className={[styles.card, styles[tone], compact && styles.compact, className].filter(Boolean).join(' ')}
      {...aria}
    >
      {title && <h3 className={styles.title}>{title}</h3>}
      {children}
    </Tag>
  );
}
