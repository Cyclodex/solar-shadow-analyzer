import { useLayoutEffect, useRef } from 'react';
import { cssVars } from '../../components/cssVars';
import styles from './chart.module.css';

// ─────────────────────────────────────────────
// TOOLTIP (HTML, absolutely positioned inside the chart root)
// Values lead, labels follow; series keyed by a small line/rect of the series colour. It only enhances:
// every value is also in the chart's summary, the keyboard readout (aria-valuetext / live region) or a
// table, so the tooltip itself is aria-hidden to avoid double announcements.
// ─────────────────────────────────────────────

export type TooltipKey = 'line' | 'rect' | 'hatch' | 'none';

export interface TooltipRow {
  key: string;
  value: string;
  label: string;
  /** Colour of the key mark (var(--…) token). */
  color?: string;
  mark?: TooltipKey;
}

export interface ChartTooltipProps {
  /** Anchor point in px relative to the chart root (the tooltip is placed beside it). */
  x: number;
  y: number;
  /** Size of the chart root; the tooltip is kept inside it. */
  boundsWidth: number;
  boundsHeight: number;
  title: string;
  rows?: readonly TooltipRow[];
  /** Muted line below the rows (hint or context). */
  note?: string;
}

const OFFSET = 14;
/** Narrowest width (px) worth placing beside the anchor; below that the tooltip goes above/below it. */
const MIN_WIDTH = 150;
/** Widest tooltip (px), matches the CSS max-width of 19rem at 16 px. */
const MAX_WIDTH = 304;

const KEY_CLASS: Record<TooltipKey, string> = {
  line: styles.keyLine,
  rect: styles.keyRect,
  hatch: styles.keyHatch,
  none: styles.keyNone,
};

export function ChartTooltip({ x, y, boundsWidth, boundsHeight, title, rows = [], note }: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Beside the anchor, never over it: on the side with more room, narrowed (text wraps) when that side is
  // tight; centred below/above the anchor only when neither side has a usable width. Written directly to
  // the style before paint, so there is no extra render or flicker.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const roomRight = boundsWidth - x - OFFSET;
    const roomLeft = x - OFFSET;
    const room = Math.max(roomLeft, roomRight);
    const beside = room >= MIN_WIDTH;
    el.style.maxWidth = beside
      ? `${Math.floor(Math.min(room, MAX_WIDTH))}px`
      : `${Math.floor(boundsWidth)}px`;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left: number;
    let top: number;
    if (beside) {
      left = roomRight >= w || roomRight >= roomLeft ? x + OFFSET : x - OFFSET - w;
      top = y - h / 2;
    } else {
      left = x - w / 2;
      top = y + OFFSET + h <= boundsHeight ? y + OFFSET : y - OFFSET - h;
    }
    left = Math.max(0, Math.min(left, boundsWidth - w));
    top = Math.max(0, Math.min(top, boundsHeight - h));
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  });

  return (
    <div ref={ref} className={styles.tooltip} aria-hidden="true">
      <div className={styles.tooltipTitle}>{title}</div>
      {rows.length > 0 && (
        <ul className={styles.tooltipRows}>
          {rows.map((r) => (
            <li key={r.key} className={styles.tooltipRow}>
              <span
                className={`${styles.key} ${KEY_CLASS[r.mark ?? (r.color ? 'line' : 'none')]}`}
                style={r.color ? cssVars({ '--key': r.color }) : undefined}
              />
              {r.label ? (
                <>
                  <span className={styles.tooltipValue}>{r.value}</span>
                  <span className={styles.tooltipLabel}>{r.label}</span>
                </>
              ) : (
                // A value without label (e.g. a state text) takes both columns and may wrap.
                <span className={`${styles.tooltipValue} ${styles.tooltipValueWide}`}>{r.value}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {note && <div className={styles.tooltipNote}>{note}</div>}
    </div>
  );
}
