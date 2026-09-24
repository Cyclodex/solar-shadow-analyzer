import { px, rectD } from './geometry2d';
import { LEGEND_SWATCH, type LegendLayout, type PlacedLegendItem } from './legend';
import { SunGlyph } from './primitives';
import s from './svg.module.css';

function Swatch({ item, x, y }: PlacedLegendItem) {
  const w = LEGEND_SWATCH;
  switch (item.kind) {
    case 'line':
      return <path d={`M${px(x)} ${px(y)}h${w}`} className={item.className} />;
    case 'dot':
      return <circle cx={px(x + w / 2)} cy={px(y)} r={3.5} className={item.className} />;
    case 'sun':
      return <SunGlyph x={x + w / 2} y={y} r={4} />;
    case 'area':
      return (
        <g>
          {item.baseClassName && <path d={rectD(x + 2, y - 6, w - 4, 12)} className={item.baseClassName} />}
          <path d={rectD(x + 2, y - 6, w - 4, 12)} className={item.className} />
          {item.patternId && <path d={rectD(x + 2, y - 6, w - 4, 12)} fill={`url(#${item.patternId})`} />}
        </g>
      );
  }
}

/** Legend drawn inside the SVG (so it is part of the PNG export); layout from layoutLegend(). */
export function SvgLegend({ layout }: { layout: LegendLayout }) {
  return (
    <g>
      {layout.items.map((p) => (
        <g key={p.item.key}>
          <Swatch {...p} />
          <text x={px(p.x + LEGEND_SWATCH + 6)} y={px(p.y + 4)} className={s.label}>
            {p.item.label}
          </text>
        </g>
      ))}
    </g>
  );
}
