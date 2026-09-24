export interface HatchPatternProps {
  /** Unique element id (useSvgId), referenced as fill="url(#id)". */
  id: string;
  /** Line colour (var(--…) token). */
  color: string;
  /** Opacity of the lines. */
  opacity?: number;
  /** Line width in px. */
  lineWidth?: number;
  /** Opacity of a wash of `color` behind the lines (0 = none). */
  wash?: number;
  /** Direction of the lines on screen: 45 rises to the right (/), 135 falls to the right (\). */
  angle?: 45 | 135;
  /** Line spacing in px. */
  spacing?: number;
}

/**
 * Diagonal hatch fill for <defs>, shared by the charts and the 2D views: a texture so that shading loss,
 * shade and blocked directions are never told by colour alone. userSpaceOnUse keeps the lines continuous
 * across neighbouring shapes.
 */
export function HatchPattern({
  id,
  color,
  opacity = 1,
  lineWidth = 1.6,
  wash = 0,
  angle = 45,
  spacing = 5,
}: HatchPatternProps) {
  return (
    <pattern
      id={id}
      patternUnits="userSpaceOnUse"
      width={spacing}
      height={spacing}
      patternTransform={`rotate(${angle === 45 ? 45 : -45})`}
    >
      {wash > 0 && <rect width={spacing} height={spacing} fill={color} fillOpacity={wash} />}
      <line
        x1={0}
        y1={0}
        x2={0}
        y2={spacing}
        stroke={color}
        strokeOpacity={opacity}
        strokeWidth={lineWidth}
      />
    </pattern>
  );
}
