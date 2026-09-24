import type { HTMLAttributes, Ref } from 'react';
import chart from './chart.module.css';

// ─────────────────────────────────────────────
// PLOT SLIDER + HOVER MARKS
// The focusable pointer/keyboard layer of the line and bar charts: a role="slider" div exactly over the
// plot area (pointer handlers from usePlotPointer, keys via stepValue in sliderKeys.ts), plus the
// crosshair with one dot per series drawn while a value is hovered or keyboard-selected.
// ─────────────────────────────────────────────

export interface PlotRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PlotSliderProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'role' | 'tabIndex' | 'style' | 'aria-label' | 'aria-describedby'
> {
  /** Plot area in px relative to the chart root. */
  plot: PlotRect;
  label: string;
  /** Id of the element describing the keys. */
  describedBy: string;
  min: number;
  max: number;
  value: number;
  valueText: string;
  ref?: Ref<HTMLDivElement>;
}

export function PlotSlider({
  plot,
  label,
  describedBy,
  min,
  max,
  value,
  valueText,
  className,
  ...handlers
}: PlotSliderProps) {
  return (
    <div
      className={className ? `${chart.overlay} ${className}` : chart.overlay}
      style={{
        left: plot.left,
        top: plot.top,
        width: plot.right - plot.left,
        height: plot.bottom - plot.top,
      }}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-describedby={describedBy}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      {...handlers}
    />
  );
}

export interface HoverDot {
  key: string;
  y: number;
  color: string;
}

/** Crosshair at x over the plot's height with a dot per series (not part of the PNG export). */
export function HoverMarks({
  width,
  height,
  x,
  plot,
  dots,
}: {
  /** Size of the chart root. */
  width: number;
  height: number;
  x: number;
  plot: PlotRect;
  dots: readonly HoverDot[];
}) {
  return (
    <svg className={chart.hoverLayer} width={width} height={height} aria-hidden="true">
      <line className={chart.crosshair} x1={x} x2={x} y1={plot.top} y2={plot.bottom} />
      {dots.map((d) => (
        <circle key={d.key} className={chart.dot} cx={x} cy={d.y} r={4} fill={d.color} />
      ))}
    </svg>
  );
}
