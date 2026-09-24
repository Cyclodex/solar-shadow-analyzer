import { useLayoutEffect, useRef } from 'react';
import { Button } from '../../components/Button';
import { cssVars } from '../../components/cssVars';
import styles from './chart.module.css';

// ─────────────────────────────────────────────
// TOOLTIP (HTML, absolutely positioned inside the chart root)
// Values lead, labels follow; series keyed by a small line/rect of the series colour. It only enhances:
// every value is also in the chart's summary, the keyboard readout (aria-valuetext / live region) or a
// table, so the tooltip itself is aria-hidden to avoid double announcements. An optional action button
// (e.g. to apply the value on touch, where a tap only shows it) stays outside the aria-hidden part.
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
  /** Button below the content; its taps keep a touch tooltip open (CHART_ACTION_ATTR in usePlotPointer). */
  action?: { label: string; onClick: () => void };
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

/**
 * Vertical range [top, bottom] of the chart root (the tooltip's offset parent) that is on screen and not
 * behind the control bar at the bottom of phones (--bottom-bar-h, app/BottomBar.tsx), in px relative to the
 * root and within [0, boundsHeight].
 */
function visibleBand(el: HTMLElement, boundsHeight: number): [number, number] {
  const root = el.offsetParent;
  if (!root) return [0, boundsHeight];
  const rootTop = root.getBoundingClientRect().top;
  const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottom-bar-h')) || 0;
  return [Math.max(0, -rootTop), Math.min(boundsHeight, window.innerHeight - bar - rootTop)];
}

export function ChartTooltip({
  x,
  y,
  boundsWidth,
  boundsHeight,
  title,
  rows = [],
  note,
  action,
}: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const hasAction = action !== undefined;

  // Beside the anchor, never over it: on the side with more room, narrowed (text wraps) when that side is
  // tight; centred below/above the anchor only when neither side has a usable width. With a button (touch)
  // it also stays within the visible part of the chart, clear of the fixed control bar of phones
  // (visibleBand), so the button can be tapped, even if it then covers the anchor (the click of the tap
  // that opened it never reaches the button, usePlotPointer). Written directly to the style before paint,
  // so there is no extra render or flicker.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const roomRight = boundsWidth - x - OFFSET;
    const roomLeft = x - OFFSET;
    const room = Math.max(roomLeft, roomRight);
    let beside = room >= MIN_WIDTH;
    if (beside && hasAction) {
      // With a button it is not narrowed beside the anchor (rows wrapping mid-word above a two-line
      // button): where neither side fits its natural width, it goes below/above the anchor instead.
      el.style.maxWidth = `${Math.floor(Math.min(boundsWidth, MAX_WIDTH))}px`;
      beside = room >= el.offsetWidth;
    }
    el.style.maxWidth = beside
      ? `${Math.floor(Math.min(room, MAX_WIDTH))}px`
      : `${Math.floor(boundsWidth)}px`;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const band = hasAction ? visibleBand(el, boundsHeight) : null;
    // A band lower than the tooltip cannot hold it: then the chart bounds apply, as without a button.
    const [minTop, maxBottom] = band && band[1] - band[0] >= h ? band : [0, boundsHeight];
    let left: number;
    let top: number;
    if (beside) {
      left = roomRight >= w || roomRight >= roomLeft ? x + OFFSET : x - OFFSET - w;
      top = y - h / 2;
    } else {
      left = x - w / 2;
      top = y + OFFSET + h <= maxBottom ? y + OFFSET : y - OFFSET - h;
    }
    left = Math.max(0, Math.min(left, boundsWidth - w));
    top = Math.max(minTop, Math.min(top, maxBottom - h));
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  });

  const content = (
    <>
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
    </>
  );

  if (!action) {
    return (
      <div ref={ref} className={styles.tooltip} aria-hidden="true">
        {content}
      </div>
    );
  }
  return (
    <div ref={ref} className={styles.tooltip}>
      <div aria-hidden="true">{content}</div>
      <Button
        variant="primary"
        className={styles.tooltipAction}
        onClick={action.onClick}
        data-chart-action=""
      >
        {action.label}
      </Button>
    </div>
  );
}
