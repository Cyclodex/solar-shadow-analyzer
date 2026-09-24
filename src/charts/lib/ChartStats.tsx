import type { ReactNode } from 'react';
import styles from './chart.module.css';

export interface ChartStat {
  key: string;
  label: string;
  value: ReactNode;
}

/** A compact row of headline numbers for a chart ("Jahr: 2’855 kWh · Verlust: 120 kWh"). */
export function ChartStats({ items, className }: { items: readonly ChartStat[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <dl className={[styles.stats, className].filter(Boolean).join(' ')}>
      {items.map((s) => (
        <div key={s.key} className={styles.stat}>
          <dt>{s.label}</dt>
          <dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}
