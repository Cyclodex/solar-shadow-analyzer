export interface HatchPatternProps {
  /** Unique element id (useSvgId), referenced as fill="url(#id)". */
  id: string;
  /** Line colour (var(--…) token). */
  color: string;
  /** Opacity of a wash of `color` behind the lines (0 = none). */
  wash?: number;
  /** 45 (default) or 135 degrees — the only texture angles used (never horizontal/vertical). */
  angle?: 45 | 135;
  /** Line spacing in px. */
  spacing?: number;
}

/**
 * Diagonal hatch fill for <defs>: the shading-loss texture, so the loss is never told by colour alone.
 * userSpaceOnUse keeps the lines continuous across neighbouring bars.
 */
export function HatchPattern({ id, color, wash = 0.22, angle = 45, spacing = 5 }: HatchPatternProps) {
  return (
    <pattern
      id={id}
      patternUnits="userSpaceOnUse"
      width={spacing}
      height={spacing}
      patternTransform={`rotate(${angle === 45 ? -45 : 45})`}
    >
      {wash > 0 && <rect width={spacing} height={spacing} fill={color} fillOpacity={wash} />}
      <line x1={0} y1={0} x2={0} y2={spacing} stroke={color} strokeWidth={1.6} />
    </pattern>
  );
}
