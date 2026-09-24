import styles from './chart.module.css';

/** A tick at pixel position `pos` with its label. */
export interface AxisTick {
  pos: number;
  label: string;
}

export interface AxisYProps {
  ticks: readonly AxisTick[];
  /** Left and right edge of the plot (grid lines span it). */
  x0: number;
  x1: number;
  /** Draw horizontal grid lines (default true). */
  grid?: boolean;
  /** Optional unit/title above the tick labels (e.g. "kWh"). */
  title?: string;
  /** y of the title baseline. */
  titleY?: number;
}

/** Value axis on the left: right-aligned labels and recessive hairline grid lines. */
export function AxisY({ ticks, x0, x1, grid = true, title, titleY }: AxisYProps) {
  return (
    <g aria-hidden="true">
      {grid &&
        ticks.map((t) => (
          <line
            key={`g${t.pos}`}
            className={styles.grid}
            x1={x0}
            x2={x1}
            y1={Math.round(t.pos) + 0.5}
            y2={Math.round(t.pos) + 0.5}
          />
        ))}
      {ticks.map((t) => (
        <text
          key={`t${t.pos}`}
          className={styles.tick}
          x={x0 - 6}
          y={t.pos}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {t.label}
        </text>
      ))}
      {title && titleY !== undefined && (
        <text className={styles.axisTitle} x={x0 - 6} y={titleY} textAnchor="end">
          {title}
        </text>
      )}
    </g>
  );
}

export interface AxisXProps {
  ticks: readonly AxisTick[];
  /** y of the baseline. */
  y: number;
  x0: number;
  x1: number;
  /** Tick mark length below the baseline (0 = none, e.g. for month labels centred under bars). */
  tickSize?: number;
}

/** Baseline with tick marks and centred labels below it. */
export function AxisX({ ticks, y, x0, x1, tickSize = 4 }: AxisXProps) {
  const base = Math.round(y) + 0.5;
  return (
    <g aria-hidden="true">
      <line className={styles.axis} x1={x0} x2={x1} y1={base} y2={base} />
      {tickSize > 0 &&
        ticks.map(({ pos }) => (
          <line
            key={`m${pos}`}
            className={styles.axis}
            x1={Math.round(pos) + 0.5}
            x2={Math.round(pos) + 0.5}
            y1={base}
            y2={base + tickSize}
          />
        ))}
      {ticks.map((t) => (
        <text
          key={`t${t.pos}`}
          className={styles.tick}
          x={t.pos}
          y={base + tickSize + 12}
          textAnchor="middle"
        >
          {t.label}
        </text>
      ))}
    </g>
  );
}
