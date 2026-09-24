import { useMemo, useState, type KeyboardEvent } from 'react';
import { ViewCard } from '../components/ViewCard';
import { useFormat, useMessages, type Format, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useDailyProfile, useSunTimes } from '../hooks/useModel';
import { SHADED_THRESHOLD } from '../model/analysis';
import type { DailyProfilePoint } from '../model/types';
import { useConfigSection } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { AxisX, AxisY, type AxisTick } from './lib/Axes';
import { ChartDataTable } from './lib/DataTable';
import { ChartTooltip, type TooltipRow } from './lib/ChartTooltip';
import { ChartLegend } from './lib/ChartLegend';
import { SHADE_STEP_TOKENS, floorColor } from './lib/colors';
import { topDown, useFloorLabels } from './lib/floors';
import { LEGEND_TOP, layoutChartLegend, type ChartLegendItem, type ChartLegendLayout } from './lib/legend';
import { linePath } from './lib/paths';
import {
  nearestIndex,
  niceTicks,
  scaleLinear,
  stepDigits,
  ticksInRange,
  type LinearScale,
} from './lib/scale';
import { estimateTextWidth } from './lib/text';
import {
  daylightWindow,
  hourTickStep,
  maxShadePerPoint,
  peakIndex,
  shadeRuns,
  shadedPeriods,
  type TimeWindow,
} from './lib/timeAxis';
import { useElementWidth } from './lib/useElementWidth';
import { isFocusVisible } from './lib/focus';
import { HoverMarks, PlotSlider } from './lib/PlotSlider';
import { stepValue } from './lib/sliderKeys';
import { usePlotPointer } from './lib/usePlotPointer';
import { useSvgId } from './lib/useSvgId';
import chart from './lib/chart.module.css';
import styles from './DailyProfileChart.module.css';

const de = {
  title: 'Tagesverlauf',
  subtitle: (date: string) => `AC-Leistung je Stockwerk am ${date} bei klarem Himmel`,
  sunriseShort: 'Aufgang',
  sunsetShort: 'Untergang',
  shadeBand: 'Verschattung durch oberes Stockwerk',
  limit: (w: string) => `Wechselrichter-Limit ${w}`,
  shaded: (pct: string) => `${pct} verschattet`,
  altitude: (deg: string) => `Sonnenhöhe ${deg}`,
  slider: 'Uhrzeit im Tagesverlauf',
  keys: 'Pfeiltasten: ±10 Minuten, mit Umschalt ±1 Stunde.',
  clickHint: 'Klicken oder ziehen setzt die Uhrzeit',
  summaryDay: (date: string) => `Tagesverlauf am ${date} bei klarem Himmel.`,
  summaryPeak: (floor: string, w: string, time: string) => `${floor}: Spitze ${w} um ${time}`,
  summaryShaded: (floor: string, periods: string) => `${floor} verschattet ${periods}.`,
  summaryNoShade: 'Keine Verschattung durch die Panels darüber.',
  summarySun: (rise: string, set: string) => `Sonnenaufgang ${rise}, Sonnenuntergang ${set}.`,
  noPower: 'An diesem Tag erreicht kein Sonnenlicht die Panels.',
  tableCaption: (date: string) => `Leistung je Stockwerk am ${date}, stündlich, klarer Himmel`,
  time: 'Uhrzeit',
  altitudeCol: 'Sonnenhöhe',
};
type Texts = typeof de;
const messages: Messages<Texts> = {
  de,
  en: {
    title: 'Daily profile',
    subtitle: (date) => `AC power per floor on ${date} under clear skies`,
    sunriseShort: 'Sunrise',
    sunsetShort: 'Sunset',
    shadeBand: 'Shading by the floor above',
    limit: (w) => `Inverter limit ${w}`,
    shaded: (pct) => `${pct} shaded`,
    altitude: (deg) => `Sun altitude ${deg}`,
    slider: 'Time of day',
    keys: 'Arrow keys: ±10 minutes, with Shift ±1 hour.',
    clickHint: 'Click or drag to set the time',
    summaryDay: (date) => `Daily profile on ${date} under clear skies.`,
    summaryPeak: (floor, w, time) => `${floor}: peak ${w} at ${time}`,
    summaryShaded: (floor, periods) => `${floor} shaded ${periods}.`,
    summaryNoShade: 'No shading by the panels above.',
    summarySun: (rise, set) => `Sunrise ${rise}, sunset ${set}.`,
    noPower: 'No sunlight reaches the panels on this day.',
    tableCaption: (date) => `Power per floor on ${date}, hourly, clear skies`,
    time: 'Time',
    altitudeCol: 'Sun altitude',
  },
};

/**
 * Margins around the plot, px. `right` holds half an "HH:MM" tick label, so a tick at the window end is not
 * clipped by the viewBox (PNG export).
 */
const M = { left: 48, right: Math.ceil(estimateTextWidth('24:00', 11) / 2) + 2, band: 22, bottom: 30 };
/** Minutes of the time grid the pointer and keyboard snap to. */
const SNAP = 5;
const TOP_GAP = 6;
/**
 * Shaded periods (any floor above SHADED_THRESHOLD) as one class, drawn exactly like the legend swatch; the
 * shaded share itself is in the tooltip, the summary and the table.
 */
const SHADE_BAND = { color: `var(${SHADE_STEP_TOKENS[2]})`, opacity: 0.3 } as const;

interface Plot {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Geometry {
  width: number;
  height: number;
  plot: Plot;
  x: LinearScale;
  y: LinearScale;
  win: TimeWindow;
  legend: ChartLegendLayout;
  xTicks: AxisTick[];
  yTicks: AxisTick[];
  lines: { floor: number; d: string }[];
  bands: { key: string; x: number; w: number }[];
  limit: { y: number; label: string } | null;
  events: { key: string; x: number; label: string; anchor: 'start' | 'end' }[];
  maxW: number;
}

function buildGeometry(
  width: number,
  points: readonly DailyProfilePoint[],
  numFloors: number,
  win: TimeWindow,
  sun: { sunrise: number | null; sunset: number | null },
  limitW: number,
  legendItems: readonly ChartLegendItem[],
  f: Format,
  t: Texts,
): Geometry {
  const legend = layoutChartLegend(legendItems, width - M.left);
  const plotH = width < 420 ? 170 : width < 640 ? 200 : 220;
  const top = LEGEND_TOP + (legend.height > 0 ? legend.height + TOP_GAP : 0) + M.band;
  const plot: Plot = { left: M.left, right: width - M.right, top, bottom: top + plotH };
  const height = plot.bottom + M.bottom;

  const visible = points.filter((p) => p.minutes >= win.start && p.minutes <= win.end);
  const maxW = visible.reduce((m, p) => Math.max(m, ...p.floorsW), 0);
  const showLimit = maxW >= 0.9 * limitW;
  // At least 100 W, so a day without sun still gets a sensible axis.
  const yt = niceTicks(0, Math.max(showLimit ? limitW * 1.04 : 0, maxW, 100), 4);
  const x = scaleLinear([win.start, win.end], [plot.left, plot.right]);
  const y = scaleLinear([0, yt.max], [plot.bottom, plot.top]);

  const step = hourTickStep((plot.right - plot.left) / (win.end - win.start));
  const xTicks = ticksInRange(win.start, win.end, step).map((m) => ({ pos: x(m), label: f.time(m) }));
  const yTicks = yt.ticks.map((v) => ({ pos: y(v), label: f.num(v, stepDigits(yt.step)) }));

  const lines = Array.from({ length: numFloors }, (_, k) => ({
    floor: k,
    d: linePath(visible.map((p) => [x(p.minutes), y(p.floorsW[k] ?? 0)] as const)),
  }));

  const pointStep = points.length > 1 ? points[1].minutes - points[0].minutes : 10;
  // One rect per contiguous shaded period (no seams between semi-transparent neighbours).
  const shaded = maxShadePerPoint(visible).map((v) => (v > SHADED_THRESHOLD ? 1 : 0));
  const bands = shadeRuns(visible, shaded).map((r) => {
    const x0 = x(Math.max(win.start, r.from - pointStep / 2));
    const x1 = x(Math.min(win.end, r.to + pointStep / 2));
    return { key: `${r.from}`, x: x0, w: Math.max(1, x1 - x0) };
  });

  const events: Geometry['events'] = [];
  if (sun.sunrise !== null && sun.sunrise >= win.start && sun.sunrise <= win.end) {
    events.push({
      key: 'rise',
      x: x(sun.sunrise),
      label: `${t.sunriseShort} ${f.time(sun.sunrise)}`,
      anchor: 'start',
    });
  }
  if (sun.sunset !== null && sun.sunset >= win.start && sun.sunset <= win.end) {
    events.push({
      key: 'set',
      x: x(sun.sunset),
      label: `${t.sunsetShort} ${f.time(sun.sunset)}`,
      anchor: 'end',
    });
  }

  return {
    width,
    height,
    plot,
    x,
    y,
    win,
    legend,
    xTicks,
    yTicks,
    lines,
    bands,
    limit: showLimit ? { y: y(limitW), label: t.limit(f.unit(limitW, 'W')) } : null,
    events,
    maxW,
  };
}

/** Accessible summary: peaks per floor, shaded periods, sunrise/sunset. */
function summarize(
  points: readonly DailyProfilePoint[],
  labels: readonly string[],
  numFloors: number,
  dateText: string,
  sunText: string,
  f: Format,
  t: Texts,
): string {
  const peaks = topDown(numFloors)
    .map((k) => {
      const i = peakIndex(points, k);
      return i < 0
        ? null
        : t.summaryPeak(labels[k], f.unit(points[i].floorsW[k], 'W'), f.time(points[i].minutes));
    })
    .filter(Boolean)
    .join('; ');
  const shaded = topDown(numFloors)
    .map((k) => {
      const periods = shadedPeriods(points, k);
      if (periods.length === 0) return null;
      return t.summaryShaded(labels[k], periods.map(([a, b]) => `${f.time(a)}–${f.time(b)}`).join(', '));
    })
    .filter(Boolean);
  return [
    t.summaryDay(dateText),
    peaks ? `${peaks}.` : t.noPower,
    numFloors > 1 ? (shaded.length > 0 ? shaded.join(' ') : t.summaryNoShade) : '',
    sunText,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Selected time as a vertical accent line with a time pill above the plot (drawn into the exported SVG). */
function TimeMarker({ geom, f }: { geom: Geometry; f: Format }) {
  const minutes = useTimeStore((s) => s.minutes);
  const { plot, win } = geom;
  if (minutes < win.start || minutes > win.end) return null;
  const x = geom.x(minutes);
  const label = f.time(minutes);
  const w = estimateTextWidth(label, 11) + 14;
  const px = Math.max(plot.left - 2, Math.min(x - w / 2, geom.width - w));
  const py = plot.top - M.band + 2;
  return (
    <g aria-hidden="true">
      <line className={chart.marker} x1={x} x2={x} y1={py + 16} y2={plot.bottom} />
      <rect className={chart.pill} x={px} y={py} width={w} height={16} rx={8} />
      <text
        className={chart.pillText}
        x={px + w / 2}
        y={py + 8}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {label}
      </text>
    </g>
  );
}

interface InteractionProps {
  geom: Geometry;
  points: readonly DailyProfilePoint[];
  labels: readonly string[];
  numFloors: number;
  f: Format;
  t: Texts;
  keysId: string;
}

/**
 * Pointer/keyboard layer over the plot: crosshair + tooltip on hover, click/drag and arrow keys set the
 * selected time (role="slider").
 */
function ProfileInteraction({ geom, points, labels, numFloors, f, t, keysId }: InteractionProps) {
  const minutes = useTimeStore((s) => s.minutes);
  const setMinutes = useTimeStore((s) => s.setMinutes);
  const setPlaying = useTimeStore((s) => s.setPlaying);
  const [keyboard, setKeyboard] = useState(false);
  const { plot, win } = geom;
  const pointMinutes = useMemo(() => points.map((p) => p.minutes), [points]);

  const clampToWindow = (m: number): number => Math.min(win.end, Math.max(win.start, m));
  const setTime = (m: number): void => {
    setPlaying(false);
    setMinutes(clampToWindow(m));
  };

  const pointer = usePlotPointer({
    locate: (px) => Math.round(clampToWindow(geom.x.invert(plot.left + px)) / SNAP) * SNAP,
    onSelect: setTime,
    drag: true,
  });

  const activeMinutes = pointer.hover ?? (keyboard ? clampToWindow(minutes) : null);
  const index = activeMinutes === null ? -1 : nearestIndex(pointMinutes, activeMinutes);
  const point = index >= 0 ? points[index] : null;

  const readout = (p: DailyProfilePoint | null, m: number): string => {
    const parts = [f.time(m)];
    if (p) {
      for (const k of topDown(numFloors)) {
        const shade = p.floorsShade[k] ?? 0;
        parts.push(
          `${labels[k]} ${f.unit(p.floorsW[k] ?? 0, 'W')}${shade > SHADED_THRESHOLD ? ` (${t.shaded(f.pct(shade * 100))})` : ''}`,
        );
      }
    }
    return parts.join(', ');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Escape hides the crosshair and tooltip (WCAG 1.4.13); the selected time stays.
    if (e.key === 'Escape') {
      if (keyboard || pointer.hover !== null) {
        e.preventDefault();
        pointer.clear();
        setKeyboard(false);
      }
      return;
    }
    const step = e.shiftKey ? 60 : 10;
    const next = stepValue(e.key, minutes, { step, page: 60, min: win.start, max: win.end });
    if (next === null) return;
    e.preventDefault();
    pointer.clear();
    setKeyboard(true);
    setTime(next);
  };

  const nowPoint = points[nearestIndex(pointMinutes, minutes)] ?? null;
  const tooltipRows: TooltipRow[] = point
    ? topDown(numFloors).map((k) => {
        const shade = point.floorsShade[k] ?? 0;
        return {
          key: String(k),
          value: f.unit(point.floorsW[k] ?? 0, 'W'),
          label: shade > SHADED_THRESHOLD ? `${labels[k]} · ${t.shaded(f.pct(shade * 100))}` : labels[k],
          color: floorColor(k),
          mark: 'line',
        };
      })
    : [];
  const px = point ? geom.x(point.minutes) : 0;
  const topValue = point ? Math.max(...point.floorsW) : 0;

  return (
    <>
      {point && (
        <HoverMarks
          width={geom.width}
          height={geom.height}
          x={px}
          plot={plot}
          dots={topDown(numFloors).map((k) => ({
            key: String(k),
            y: geom.y(point.floorsW[k] ?? 0),
            color: floorColor(k),
          }))}
        />
      )}
      <PlotSlider
        plot={plot}
        label={t.slider}
        describedBy={keysId}
        min={win.start}
        max={win.end}
        value={Math.round(clampToWindow(minutes))}
        valueText={readout(nowPoint, minutes)}
        onKeyDown={onKeyDown}
        // Keyboard focus shows the readout of the selected time without changing it.
        onFocus={(e) => {
          if (isFocusVisible(e.currentTarget)) setKeyboard(true);
        }}
        onBlur={() => setKeyboard(false)}
        {...pointer.handlers}
        onPointerDown={(e) => {
          setKeyboard(false);
          pointer.handlers.onPointerDown(e);
        }}
      />
      {point && (
        <ChartTooltip
          x={px}
          y={geom.y(topValue)}
          boundsWidth={geom.width}
          boundsHeight={geom.height}
          title={`${f.time(point.minutes)} · ${t.altitude(f.deg(point.altitude, 1))}`}
          rows={tooltipRows}
          note={keyboard ? undefined : t.clickHint}
        />
      )}
    </>
  );
}

/** Clear-sky AC power per floor over the selected day, shaded periods, sunrise/sunset and the selected time. */
export function DailyProfileChart() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const date = useTimeStore((s) => s.date);
  const locationName = useConfigSection('location').name;
  const { numFloors } = useConfigSection('building');
  const { inverterLimitW } = useConfigSection('system');
  const points = useDailyProfile();
  const sunTimes = useSunTimes();
  const labels = useFloorLabels();
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const titleId = useSvgId('dp-title');
  const descId = useSvgId('dp-desc');
  const keysId = useSvgId('dp-keys');

  const win = useMemo(() => daylightWindow(sunTimes), [sunTimes]);
  const legendItems = useMemo<ChartLegendItem[]>(() => {
    if (numFloors <= 1) return [];
    const items: ChartLegendItem[] = Array.from({ length: numFloors }, (_, k) => ({
      key: `f${k}`,
      label: labels[k] ?? String(k),
      swatch: 'line',
      color: floorColor(k),
    }));
    items.push({
      key: 'shade',
      label: t.shadeBand,
      swatch: 'band',
      color: SHADE_BAND.color,
      opacity: SHADE_BAND.opacity,
    });
    return items;
  }, [numFloors, labels, t]);

  const geom = useMemo(
    () => buildGeometry(width, points, numFloors, win, sunTimes, inverterLimitW, legendItems, f, t),
    [width, points, numFloors, win, sunTimes, inverterLimitW, legendItems, f, t],
  );

  const dateText = f.date(date);
  const sunText =
    sunTimes.polar === 'day'
      ? c.polarDay
      : sunTimes.polar === 'night'
        ? c.polarNight
        : t.summarySun(
            sunTimes.sunrise === null ? '–' : f.time(sunTimes.sunrise),
            sunTimes.sunset === null ? '–' : f.time(sunTimes.sunset),
          );
  const summary = useMemo(
    () => summarize(points, labels, numFloors, dateText, sunText, f, t),
    [points, labels, numFloors, dateText, sunText, f, t],
  );

  const table = useMemo(() => {
    const hourly = points.filter(
      (p) => p.minutes % 60 === 0 && p.minutes >= win.start && p.minutes <= win.end,
    );
    return {
      columns: [
        { key: 'time', header: t.time },
        ...Array.from({ length: numFloors }, (_, k) => ({ key: `f${k}`, header: labels[k], numeric: true })),
        { key: 'alt', header: t.altitudeCol, numeric: true },
      ],
      rows: hourly.map((p) => ({
        key: String(p.minutes),
        cells: [
          f.time(p.minutes),
          ...Array.from({ length: numFloors }, (_, k) => {
            const shade = p.floorsShade[k] ?? 0;
            const w = f.unit(p.floorsW[k] ?? 0, 'W');
            return shade > SHADED_THRESHOLD ? `${w} (${t.shaded(f.pct(shade * 100))})` : w;
          }),
          f.deg(p.altitude, 1),
        ],
      })),
    };
  }, [points, win, numFloors, labels, f, t]);

  const { plot } = geom;

  return (
    <ViewCard
      title={t.title}
      subtitle={t.subtitle(dateText)}
      exportKind="daily"
      exportParts={[locationName, date]}
      footer={
        <ChartDataTable
          caption={t.tableCaption(dateText)}
          context={t.title}
          columns={table.columns}
          rows={table.rows}
        />
      }
    >
      <div ref={rootRef} className={chart.root}>
        <svg
          className={chart.svg}
          width={geom.width}
          height={geom.height}
          viewBox={`0 0 ${geom.width} ${geom.height}`}
          role="img"
          aria-labelledby={titleId}
          aria-describedby={descId}
        >
          <title id={titleId}>{t.title}</title>
          <desc id={descId}>{summary}</desc>
          {geom.legend.height > 0 && <ChartLegend layout={geom.legend} x={plot.left} y={LEGEND_TOP} />}
          <g aria-hidden="true">
            {geom.bands.map((b) => (
              <rect
                key={b.key}
                x={b.x}
                y={plot.top}
                width={b.w}
                height={plot.bottom - plot.top}
                fill={SHADE_BAND.color}
                fillOpacity={SHADE_BAND.opacity}
              />
            ))}
          </g>
          <AxisY ticks={geom.yTicks} x0={plot.left} x1={plot.right} title="W" titleY={plot.top - 8} />
          <AxisX ticks={geom.xTicks} y={plot.bottom} x0={plot.left} x1={plot.right} />
          {/* Reference lines below the curves, their labels (with a surface halo) above the time marker. */}
          <g aria-hidden="true">
            {geom.events.map((e) => (
              <line key={e.key} className={styles.event} x1={e.x} x2={e.x} y1={plot.top} y2={plot.bottom} />
            ))}
            {geom.limit && (
              <line
                className={styles.limit}
                x1={plot.left}
                x2={plot.right}
                y1={geom.limit.y}
                y2={geom.limit.y}
              />
            )}
            {geom.lines.map((l) => (
              <path key={l.floor} className={chart.series} d={l.d} stroke={floorColor(l.floor)} />
            ))}
          </g>
          <TimeMarker geom={geom} f={f} />
          <g aria-hidden="true">
            {geom.events.map((e) => (
              <text
                key={e.key}
                className={`${chart.note} ${chart.halo}`}
                x={e.anchor === 'start' ? e.x + 4 : e.x - 4}
                y={plot.top + 12}
                textAnchor={e.anchor}
              >
                {e.label}
              </text>
            ))}
            {geom.limit && (
              <text
                className={`${chart.note} ${chart.halo}`}
                x={(plot.left + plot.right) / 2}
                y={geom.limit.y - 4}
                textAnchor="middle"
              >
                {geom.limit.label}
              </text>
            )}
            {geom.maxW <= 0 && (
              <text
                className={`${chart.note} ${chart.halo}`}
                x={(plot.left + plot.right) / 2}
                y={(plot.top + plot.bottom) / 2}
                textAnchor="middle"
              >
                {sunTimes.polar === 'night' ? c.polarNight : t.noPower}
              </text>
            )}
          </g>
        </svg>
        <p id={keysId} className="sr-only">
          {t.keys}
        </p>
        <ProfileInteraction
          geom={geom}
          points={points}
          labels={labels}
          numFloors={numFloors}
          f={f}
          t={t}
          keysId={keysId}
        />
      </div>
    </ViewCard>
  );
}
