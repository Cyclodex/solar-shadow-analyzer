import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ViewCard } from '../components/ViewCard';
import { Segmented } from '../components/Segmented';
import { SelectField } from '../components/SelectField';
import { cssVars } from '../components/cssVars';
import { monthNames, useFormat, useLang, useMessages, type Format, type Messages } from '../i18n';
import { useCommon, type CommonMessages } from '../i18n/common';
import { useHeatmap, useHeatmapStats } from '../hooks/useModel';
import {
  HEATMAP_BEHIND,
  HEATMAP_HORIZON,
  HEATMAP_NIGHT,
  SHADED_THRESHOLD,
  type HeatmapStats,
} from '../model/analysis';
import { dateFromDayOfYear, dayOfYear } from '../model/time';
import type { HeatmapData } from '../model/types';
import { useConfigSection } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { ChartDataTable } from './lib/DataTable';
import { ChartStats } from './lib/ChartStats';
import { ChartTooltip } from './lib/ChartTooltip';
import { cssVar, resolveColor, useThemeKey } from './lib/canvasTheme';
import {
  CELL,
  CELL_TOKENS,
  SHADE_STEP_BOUNDS_PCT,
  SUN_FILL_STRENGTH,
  cellClass,
  cellCssColor,
} from './lib/colors';
import { useFloorLabels, useShadedFloor } from './lib/floors';
import {
  cellAt,
  classifyCells,
  drawHeatmap,
  layoutHeatmap,
  mix,
  monthStartDays,
  visibleSlots,
  type HeatmapLayout,
  type HeatmapLegendText,
  type HeatmapPalette,
  type SlotRange,
} from './lib/heatmap';
import { estimateTextWidth } from './lib/text';
import { useElementWidth } from './lib/useElementWidth';
import { isFocusVisible } from './lib/focus';
import { usePlotPointer } from './lib/usePlotPointer';
import { useSvgId } from './lib/useSvgId';
import chart from './lib/chart.module.css';
import styles from './ShadeHeatmap.module.css';

const de = {
  title: 'Jahres-Heatmap Verschattung',
  subtitle: (floor: string, above: string, year: number) =>
    `Verschattung von ${floor} durch ${above}, ${year}: Tag × Ortszeit`,
  subtitleTop: (floor: string, year: number) =>
    `Direkte Sonne auf ${floor}, ${year}: Tag × Ortszeit – keine Panels darüber`,
  floorSelect: 'Analysiertes Stockwerk',
  night: 'Nacht',
  behind: 'Sonne hinter der Fassade',
  horizon: 'Sonne hinter Gelände/Hindernis',
  sun: 'Sonne, unverschattet',
  ramp: 'Anteil verschattet',
  shaded: (pct: string) => `${pct} der Fläche verschattet`,
  litHours: 'Direkte Sonne',
  shadedHours: 'davon verschattet',
  hours: (h: string) => `${h} h`,
  clickHint: 'Klicken übernimmt Datum und Uhrzeit',
  keyHint: 'Eingabe übernimmt Datum und Uhrzeit',
  widget: (floor: string) => `Heatmap ${floor}: Tag und Uhrzeit wählen`,
  keys: 'Pfeiltasten links/rechts: Tag, auf/ab: 10 Minuten; mit Umschalt: Woche bzw. Stunde. Bild auf/ab: Monat. Eingabe: Datum und Uhrzeit übernehmen.',
  summary: (year: number, floor: string, lit: string) =>
    `Jahres-Heatmap ${year} für ${floor}. Direkte Sonne auf dem Panel: ${lit}.`,
  summaryShaded: (shaded: string, pct: string, above: string) =>
    `Davon ${shaded} (${pct}) durch ${above} verschattet.`,
  summaryPeak: (month: string, hours: string) => `Am meisten verschattete Stunden im ${month} (${hours}).`,
  summaryTop: 'Keine Panels darüber, daher keine Verschattung durch Panels.',
  tableCaption: (floor: string, year: number) =>
    `Direkte Sonne und Verschattung von ${floor} je Monat, ${year}`,
  colMonth: 'Monat',
  colLit: 'Direkte Sonne',
  colShaded: 'Verschattet',
  colShare: 'Anteil verschattet',
  colMax: 'Max. verschattete Fläche',
  total: 'Jahr',
};
type Texts = typeof de;
const messages: Messages<Texts> = {
  de,
  en: {
    title: 'Annual shading heatmap',
    subtitle: (floor, above, year) => `Shading of ${floor} by ${above}, ${year}: day × local time`,
    subtitleTop: (floor, year) => `Direct sun on ${floor}, ${year}: day × local time – no panels above`,
    floorSelect: 'Analysed floor',
    night: 'Night',
    behind: 'Sun behind the facade',
    horizon: 'Sun behind terrain/obstacle',
    sun: 'Sun, unshaded',
    ramp: 'Shaded share',
    shaded: (pct) => `${pct} of the area shaded`,
    litHours: 'Direct sun',
    shadedHours: 'of which shaded',
    hours: (h) => `${h} h`,
    clickHint: 'Click to use this date and time',
    keyHint: 'Enter uses this date and time',
    widget: (floor) => `Heatmap ${floor}: choose day and time`,
    keys: 'Left/right arrow: day, up/down arrow: 10 minutes; with Shift: week or hour. Page up/down: month. Enter: use this date and time.',
    summary: (year, floor, lit) => `Annual heatmap ${year} for ${floor}. Direct sun on the panel: ${lit}.`,
    summaryShaded: (shaded, pct, above) => `Of this, ${shaded} (${pct}) shaded by ${above}.`,
    summaryPeak: (month, hours) => `Most shaded hours in ${month} (${hours}).`,
    summaryTop: 'No panels above, so no shading by panels.',
    tableCaption: (floor, year) => `Direct sun and shading of ${floor} per month, ${year}`,
    colMonth: 'Month',
    colLit: 'Direct sun',
    colShaded: 'Shaded',
    colShare: 'Shaded share',
    colMax: 'Max. shaded area',
    total: 'Year',
  },
};

// ── Canvas helpers ────────────────────────────

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Legend text width at 12 px in the UI font (canvas measureText; estimated without a canvas, e.g. jsdom). */
function measureLegendText(text: string): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (!measureCtx) return estimateTextWidth(text, 12);
  measureCtx.font = `12px ${cssVar(document.documentElement, '--font-sans') || 'sans-serif'}`;
  return Math.ceil(measureCtx.measureText(text).width);
}

function readPalette(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): HeatmapPalette {
  const get = (name: string): string => cssVar(canvas, name);
  const surface = resolveColor(ctx, get('--surface'));
  return {
    cells: CELL_TOKENS.map((token, cls) => {
      const color = resolveColor(ctx, get(token));
      return cls === CELL.sun ? mix(surface, color, SUN_FILL_STRENGTH) : color;
    }),
    hatch: resolveColor(ctx, get('--text-faint')),
    text: get('--text-muted'),
    axis: get('--axis'),
    font: get('--font-sans') || 'sans-serif',
  };
}

// ── Cell texts ────────────────────────────────

interface CellInfo {
  day: number;
  row: number;
  date: string;
  start: number;
  value: number;
}

function cellInfo(h: HeatmapData, range: SlotRange, index: number): CellInfo {
  const day = Math.floor(index / range.count);
  const row = index % range.count;
  const slot = range.first + row;
  return {
    day,
    row,
    date: dateFromDayOfYear(h.year, day + 1),
    start: slot * h.slotMinutes,
    value: h.values[day * h.slotsPerDay + slot],
  };
}

function stateText(value: number, t: Texts, c: CommonMessages, f: Format): string {
  if (value === HEATMAP_NIGHT) return c.sunStates.night;
  if (value === HEATMAP_BEHIND) return c.sunStates.behind;
  if (value === HEATMAP_HORIZON) return c.sunStates.horizon;
  return value > SHADED_THRESHOLD ? t.shaded(f.pct(value * 100)) : t.sun;
}

function summarize(
  stats: HeatmapStats,
  year: number,
  floor: string,
  above: string | null,
  months: readonly string[],
  t: Texts,
  f: Format,
): string {
  const parts = [t.summary(year, floor, t.hours(f.num(stats.litHours)))];
  if (above === null) parts.push(t.summaryTop);
  else {
    parts.push(t.summaryShaded(t.hours(f.num(stats.shadedHours)), f.pct(stats.shadedPct, 1), above));
    const peak = stats.monthly.reduce(
      (best, m) => (m.shadedHours > best.shadedHours ? m : best),
      stats.monthly[0],
    );
    if (peak && peak.shadedHours > 0)
      parts.push(t.summaryPeak(months[peak.month], t.hours(f.num(peak.shadedHours))));
  }
  return parts.join(' ');
}

// ── Interaction layer ─────────────────────────

interface InteractionProps {
  layout: HeatmapLayout;
  heatmap: HeatmapData;
  range: SlotRange;
  floorLabel: string;
  t: Texts;
  c: CommonMessages;
  f: Format;
}

/** Hover/keyboard cursor, tooltip, selected-time marker; click/Enter sets the date and time. */
function HeatmapInteraction({ layout, heatmap, range, floorLabel, t, c, f }: InteractionProps) {
  const date = useTimeStore((s) => s.date);
  const minutes = useTimeStore((s) => s.minutes);
  const setDate = useTimeStore((s) => s.setDate);
  const setMinutes = useTimeStore((s) => s.setMinutes);
  const setPlaying = useTimeStore((s) => s.setPlaying);
  /** Keyboard cursor (cell index); only set while the widget has focus. */
  const [cursor, setCursor] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const keysId = useSvgId('hm-keys');
  const { plot } = layout;
  const { days } = heatmap;
  const rows = range.count;
  const cellW = plot.w / days;
  const cellH = plot.h / rows;
  /** Cell centres in px relative to the chart root. */
  const cx = (day: number): number => plot.x + (day + 0.5) * cellW;
  const cy = (row: number): number => plot.y + (row + 0.5) * cellH;

  const select = (index: number): void => {
    const cell = cellInfo(heatmap, range, index);
    setPlaying(false);
    setDate(cell.date);
    setMinutes(cell.start + heatmap.slotMinutes / 2);
  };

  const pointer = usePlotPointer({
    locate: (x, y) => {
      const cell = cellAt(layout, days, rows, x, y);
      return cell ? cell.day * rows + cell.row : null;
    },
    onSelect: select,
  });

  // Selected date/time (the heatmap's year may differ from the selected date's year: same day of year).
  const selDay = Math.min(days - 1, Math.max(0, dayOfYear(date) - 1));
  const selRow = Math.floor(Math.min(minutes, 1439.99) / heatmap.slotMinutes) - range.first;
  const selVisible = selRow >= 0 && selRow < rows;
  const selIndex = selDay * rows + Math.min(rows - 1, Math.max(0, selRow));

  const describe = (index: number): string => {
    const cell = cellInfo(heatmap, range, index);
    return `${f.date(cell.date)}, ${f.time(cell.start)}–${f.time(cell.start + heatmap.slotMinutes)}: ${stateText(cell.value, t, c, f)}`;
  };

  const monthStarts = useMemo(() => monthStartDays(heatmap.year), [heatmap.year]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const current = cursor ?? selIndex;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(current);
      return;
    }
    let day = Math.floor(current / rows);
    let row = current % rows;
    const month = monthStarts.findIndex((s, m) => m < 12 && day >= s && day < monthStarts[m + 1]);
    const dom = day - monthStarts[Math.max(0, month)];
    switch (e.key) {
      case 'ArrowLeft':
        day -= e.shiftKey ? 7 : 1;
        break;
      case 'ArrowRight':
        day += e.shiftKey ? 7 : 1;
        break;
      case 'ArrowUp':
        row -= e.shiftKey ? Math.round(60 / heatmap.slotMinutes) : 1;
        break;
      case 'ArrowDown':
        row += e.shiftKey ? Math.round(60 / heatmap.slotMinutes) : 1;
        break;
      case 'PageUp':
      case 'PageDown': {
        const m = Math.min(11, Math.max(0, month + (e.key === 'PageUp' ? -1 : 1)));
        day = monthStarts[m] + Math.min(dom, monthStarts[m + 1] - monthStarts[m] - 1);
        break;
      }
      case 'Home':
        day = 0;
        break;
      case 'End':
        day = days - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    pointer.clear();
    const next = Math.min(days - 1, Math.max(0, day)) * rows + Math.min(rows - 1, Math.max(0, row));
    setCursor(next);
    setAnnouncement(describe(next));
  };

  const cursorCell = cursor !== null && cursor < days * rows ? cursor : null;
  const active = pointer.hover ?? cursorCell;
  const activeCell = active === null ? null : cellInfo(heatmap, range, active);
  // The cursor box is at least 9 px, cells are often only 1–2 px wide.
  const boxW = Math.max(9, cellW);
  const boxH = Math.max(9, cellH);

  return (
    <>
      {selVisible && (
        <div className={styles.markers} aria-hidden="true">
          <span
            className={styles.selDay}
            style={cssVars({ '--x': `${cx(selDay)}px`, '--y': `${plot.y}px`, '--h': `${plot.h}px` })}
          />
          <span
            className={styles.selCell}
            style={cssVars({ '--x': `${cx(selDay)}px`, '--y': `${cy(selRow)}px` })}
          />
        </div>
      )}
      {activeCell && (
        <div className={styles.markers} aria-hidden="true">
          <span
            className={styles.crossX}
            style={cssVars({ '--x': `${plot.x}px`, '--y': `${cy(activeCell.row)}px`, '--w': `${plot.w}px` })}
          />
          <span
            className={styles.crossY}
            style={cssVars({ '--x': `${cx(activeCell.day)}px`, '--y': `${plot.y}px`, '--h': `${plot.h}px` })}
          />
          <span
            className={styles.cursor}
            style={cssVars({
              '--x': `${cx(activeCell.day) - boxW / 2}px`,
              '--y': `${cy(activeCell.row) - boxH / 2}px`,
              '--w': `${boxW}px`,
              '--h': `${boxH}px`,
            })}
          />
        </div>
      )}
      <div
        className={`${chart.overlay} ${styles.overlay}`}
        style={{ left: plot.x, top: plot.y, width: plot.w, height: plot.h }}
        role="application"
        tabIndex={0}
        aria-label={t.widget(floorLabel)}
        aria-describedby={keysId}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          if (isFocusVisible(e.currentTarget)) setCursor(selIndex);
        }}
        onBlur={() => {
          setCursor(null);
          setAnnouncement('');
        }}
        {...pointer.handlers}
      />
      <p id={keysId} className="sr-only">
        {t.keys}
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {activeCell && (
        <ChartTooltip
          x={cx(activeCell.day)}
          y={cy(activeCell.row)}
          boundsWidth={layout.width}
          boundsHeight={layout.height}
          title={`${f.date(activeCell.date)} · ${f.time(activeCell.start)}–${f.time(activeCell.start + heatmap.slotMinutes)}`}
          rows={[
            {
              key: 'v',
              value: stateText(activeCell.value, t, c, f),
              label: '',
              color: cellCssColor(cellClass(activeCell.value)),
              mark: 'rect',
            },
          ]}
          note={pointer.hover !== null ? t.clickHint : t.keyHint}
        />
      )}
    </>
  );
}

// ── Component ─────────────────────────────────

/** Day × local time heatmap (canvas) of the shade on the analysed floor, with floor selector and statistics. */
export function ShadeHeatmap() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const { numFloors } = useConfigSection('building');
  const floor = useShadedFloor();
  const heatmap = useHeatmap(floor);
  const stats = useHeatmapStats(floor);
  const labels = useFloorLabels();
  const setFocusFloor = useUiStore((s) => s.setFocusFloor);
  const themeKey = useThemeKey();
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const hasAbove = floor < numFloors - 1;
  const floorName = labels[floor] ?? String(floor);
  const aboveName = hasAbove ? (labels[floor + 1] ?? String(floor + 1)) : null;
  const months = monthNames(lang, 'long');
  const shortMonths = monthNames(lang, 'short');

  const range = useMemo(() => visibleSlots(heatmap), [heatmap]);
  const classes = useMemo(() => classifyCells(heatmap, range), [heatmap, range]);
  const legendText = useMemo<HeatmapLegendText>(
    () => ({ night: t.night, behind: t.behind, horizon: t.horizon, sun: t.sun, shaded: t.ramp }),
    [t],
  );
  const layout = useMemo(
    () => layoutHeatmap(width, legendText, hasAbove, measureLegendText),
    [width, legendText, hasAbove],
  );
  // At least 2x so the PNG export (which copies the canvas pixels) is sharp on standard displays too.
  const dpr = Math.min(3, Math.max(2, globalThis.devicePixelRatio || 1));

  // Draw once per data / size / theme / language change — never on hover or time changes.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    drawHeatmap(ctx, {
      layout,
      classes,
      days: heatmap.days,
      range,
      slotMinutes: heatmap.slotMinutes,
      year: heatmap.year,
      dpr,
      palette: readPalette(canvas, ctx),
      monthLabels: shortMonths,
      formatTime: f.time,
      rampLabels: SHADE_STEP_BOUNDS_PCT.map((p, i, all) => (i === all.length - 1 ? f.pct(p) : f.num(p))),
    });
  }, [
    layout,
    classes,
    range,
    heatmap.days,
    heatmap.slotMinutes,
    heatmap.year,
    dpr,
    shortMonths,
    f,
    themeKey,
  ]);

  const summary = summarize(stats, heatmap.year, floorName, aboveName, months, t, f);

  const selectable = numFloors > 2 ? Array.from({ length: numFloors - 1 }, (_, k) => k) : [];
  const toolbar =
    selectable.length > 4 ? (
      <SelectField
        className={styles.select}
        label={t.floorSelect}
        value={String(floor)}
        options={selectable.map((k) => ({ value: String(k), label: labels[k] ?? String(k) }))}
        onChange={(v) => setFocusFloor(Number(v))}
      />
    ) : selectable.length > 1 ? (
      <Segmented
        label={t.floorSelect}
        size="sm"
        value={floor}
        options={selectable.map((k) => ({ value: k, label: labels[k] ?? String(k) }))}
        onChange={setFocusFloor}
      />
    ) : undefined;

  const hours = (v: number): string => t.hours(f.num(v));
  const table = {
    columns: [
      { key: 'm', header: t.colMonth },
      { key: 'lit', header: t.colLit, numeric: true },
      ...(hasAbove
        ? [
            { key: 'sh', header: t.colShaded, numeric: true },
            { key: 'pct', header: t.colShare, numeric: true },
            { key: 'max', header: t.colMax, numeric: true },
          ]
        : []),
    ],
    rows: stats.monthly.map((m) => ({
      key: String(m.month),
      cells: [
        months[m.month],
        hours(m.litHours),
        ...(hasAbove
          ? [
              hours(m.shadedHours),
              f.pct(m.litHours > 0 ? (m.shadedHours / m.litHours) * 100 : 0, 1),
              f.pct(m.maxShade * 100),
            ]
          : []),
      ],
    })),
    footer: [
      {
        key: 'total',
        cells: [
          t.total,
          hours(stats.litHours),
          ...(hasAbove ? [hours(stats.shadedHours), f.pct(stats.shadedPct, 1), ''] : []),
        ],
      },
    ],
  };

  return (
    <ViewCard
      title={t.title}
      subtitle={
        aboveName ? t.subtitle(floorName, aboveName, heatmap.year) : t.subtitleTop(floorName, heatmap.year)
      }
      toolbar={toolbar}
      exportName={`heatmap-${floorName.replace(/\./g, '')}`}
      footer={<ChartDataTable caption={t.tableCaption(floorName, heatmap.year)} {...table} />}
    >
      <ChartStats
        items={[
          { key: 'lit', label: t.litHours, value: hours(stats.litHours) },
          ...(hasAbove
            ? [
                {
                  key: 'shaded',
                  label: t.shadedHours,
                  value: `${hours(stats.shadedHours)} (${f.pct(stats.shadedPct, 1)})`,
                },
              ]
            : []),
        ]}
      />
      <div ref={rootRef} className={chart.root}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          width={Math.round(layout.width * dpr)}
          height={Math.round(layout.height * dpr)}
          style={{ width: layout.width, height: layout.height }}
          role="img"
          aria-label={summary}
        />
        <HeatmapInteraction
          layout={layout}
          heatmap={heatmap}
          range={range}
          floorLabel={floorName}
          t={t}
          c={c}
          f={f}
        />
      </div>
    </ViewCard>
  );
}
