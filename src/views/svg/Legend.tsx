import { LEGEND_SQUARE, LEGEND_SWATCH_GAP, LEGEND_SWATCH_W } from '../../components/svg/legend';
import legend from '../../components/svg/legend.module.css';
import { px, rectD } from './geometry2d';
import type { LegendLayout, PlacedLegendItem } from './legend';
import { SunGlyph } from './primitives';

function Swatch({ item, x, y }: PlacedLegendItem) {
  const w = LEGEND_SWATCH_W;
  switch (item.kind) {
    case 'line':
      return <path d={`M${px(x)} ${px(y)}h${w}`} className={item.className} />;
    case 'dot':
      return <circle cx={px(x + w / 2)} cy={px(y)} r={3.5} className={item.className} />;
    case 'sun':
      return <SunGlyph x={x + w / 2} y={y} r={4} />;
    case 'area': {
      const square = rectD(x + (w - LEGEND_SQUARE) / 2, y - LEGEND_SQUARE / 2, LEGEND_SQUARE, LEGEND_SQUARE);
      return (
        <g>
          {item.baseClassName && <path d={square} className={item.baseClassName} />}
          <path d={square} className={item.className} />
          {item.patternId && <path d={square} fill={`url(#${item.patternId})`} />}
        </g>
      );
    }
  }
}

/** Legend drawn inside the SVG (so it is part of the PNG export); layout from layoutLegend(). */
export function SvgLegend({ layout }: { layout: LegendLayout }) {
  return (
    <g>
      {layout.items.map((p) => (
        <g key={p.item.key}>
          <Swatch {...p} />
          <text
            x={px(p.x + LEGEND_SWATCH_W + LEGEND_SWATCH_GAP)}
            y={px(p.y)}
            dominantBaseline="central"
            className={legend.text}
          >
            {p.item.label}
          </text>
        </g>
      ))}
    </g>
  );
}
