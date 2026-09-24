import {
  LEGEND_ROW_HEIGHT,
  LEGEND_SQUARE,
  LEGEND_SWATCH_GAP,
  LEGEND_SWATCH_W,
} from '../../components/svg/legend';
import legend from '../../components/svg/legend.module.css';
import type { ChartLegendItem, ChartLegendLayout } from './legend';

// ─────────────────────────────────────────────
// LEGEND INSIDE THE SVG
// Lives in the chart's own SVG so a PNG export carries it. Swatches mirror the marks (line for lines,
// rect for bars, hatched rect for the shading loss, soft band for highlighted periods). Text uses the
// text tokens; the colour sits only in the swatch. Screen readers get the chart's summary instead.
// ─────────────────────────────────────────────

function Swatch({ item }: { item: ChartLegendItem }) {
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
        y={cy - LEGEND_SQUARE / 2}
        width={LEGEND_SWATCH_W}
        height={LEGEND_SQUARE}
        rx={2}
        fill={item.color}
        fillOpacity={item.opacity ?? 0.35}
      />
    );
  }
  return (
    <rect
      x={(LEGEND_SWATCH_W - LEGEND_SQUARE) / 2}
      y={cy - LEGEND_SQUARE / 2}
      width={LEGEND_SQUARE}
      height={LEGEND_SQUARE}
      rx={2}
      fill={item.fill ?? item.color}
    />
  );
}

/** Renders a legend laid out by layoutChartLegend (legend.ts) with its top-left corner at (x, y). */
export function ChartLegend({ layout, x, y }: { layout: ChartLegendLayout; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      {layout.items.map((item, i) => {
        const pos = layout.positions[i];
        return (
          <g key={item.key} transform={`translate(${pos.x} ${pos.row * LEGEND_ROW_HEIGHT})`}>
            <Swatch item={item} />
            <text
              className={legend.text}
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
