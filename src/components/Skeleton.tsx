import { cssVars } from './cssVars';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  /** CSS width, e.g. '6ch' or '100%'. Default '100%'. */
  width?: string;
  /** CSS height. Default '1em'. */
  height?: string;
  className?: string;
}

/** Placeholder block while data loads (aria-hidden; announce loading separately, e.g. aria-busy). */
export function Skeleton({ width = '100%', height = '1em', className }: SkeletonProps) {
  return (
    <span
      className={[styles.skeleton, className].filter(Boolean).join(' ')}
      style={cssVars({ '--w': width, '--h': height })}
      aria-hidden="true"
    />
  );
}
