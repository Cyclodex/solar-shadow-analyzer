import type { ReactNode } from 'react';
import { px } from './geometry2d';
import { useSvgId } from './ids';
import s from './svg.module.css';

export interface SvgFigureProps {
  /** Layout width in px (= viewBox width; the SVG scales to its container). */
  width: number;
  /** Layout height in px (= viewBox height). */
  height: number;
  /** Accessible name (<title>). */
  title: string;
  /** Text alternative with the essential numbers (<desc>). */
  desc: string;
  className?: string;
  children: ReactNode;
}

/**
 * Accessible SVG root: role="img", named by <title> and described by <desc> (both with unique ids).
 * The viewBox equals the layout size in px, so 1 user unit = 1 CSS px at the measured width.
 */
export function SvgFigure({ width, height, title, desc, className, children }: SvgFigureProps) {
  const id = useSvgId();
  const w = px(width);
  const h = px(height);
  return (
    <svg
      className={[s.svg, className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      role="img"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
    >
      <title id={`${id}-title`}>{title}</title>
      <desc id={`${id}-desc`}>{desc}</desc>
      {children}
    </svg>
  );
}
