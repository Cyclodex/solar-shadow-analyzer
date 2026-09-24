import {
  LEGEND_ROW_HEIGHT,
  LEGEND_SWATCH_GAP,
  LEGEND_SWATCH_W,
  type LegendItem,
  type LegendLayout,
} from './legend';
import styles from './chart.module.css';

// ─────────────────────────────────────────────
// LEGEND INSIDE THE SVG
// Lives in the chart's own SVG so a PNG export carries it. Swatches mirror the marks (line for lines,
// rect for bars, hatched rect for the shading loss, soft band for highlighted periods). Text uses the
// text tokens; the colour sits only in the swatch. Screen readers get the chart's summary instead.
// ─────────────────────────────────────────────

function Swatch({ item }: { item: LegendItem }) {
  const cy = LEGEND_ROW_HEIGHT / 2;
  if (item.swatch === 'line') {
    return (
      <line
        x1={1}
        x2={LEGEND_SWATCH_W - 1}
        y1={cy}
        y2={cy}
        stroke={item.color}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    );
  }
  if (item.swatch === 'band') {
    return (
      <rect
        x={0}
        y={cy - 6}
        width={LEGEND_SWATCH_W}
        height={12}
        rx={2}
        fill={item.color}
        fillOpacity={item.opacity ?? 0.35}
      />
    );
  }
  return <rect x={2} y={cy - 6} width={12} height={12} rx={2} fill={item.fill ?? item.color} />;
}

/** Renders a legend laid out by layoutLegend (legend.ts) with its top-left corner at (x, y). */
export function SvgLegend({ layout, x, y }: { layout: LegendLayout; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      {layout.items.map((item, i) => {
        const pos = layout.positions[i];
        return (
          <g key={item.key} transform={`translate(${pos.x} ${pos.row * LEGEND_ROW_HEIGHT})`}>
            <Swatch item={item} />
            <text
              className={styles.legendText}
              x={LEGEND_SWATCH_W + LEGEND_SWATCH_GAP}
              y={LEGEND_ROW_HEIGHT / 2}
              dominantBaseline="central"
            >
              {item.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}
