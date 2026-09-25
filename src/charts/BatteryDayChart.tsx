import { useMemo, useState, type KeyboardEvent } from 'react';
import { ViewCard } from '../components/ViewCard';
import { useFormat, useLang, useMessages, type Format, type Messages } from '../i18n';
import { clearSkyParts } from '../export/filenames';
import { useAnnualInputsPending, useBattery, useSimulationConfig } from '../hooks/useModel';
import { batteryDay, dayInYear, type BatteryDayPoint } from '../model/battery';
import { useConfigSection } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { AxisX, AxisY, type AxisTick } from './lib/Axes';
import { ChartStats } from './lib/ChartStats';
import { ChartTooltip, type TooltipRow } from './lib/ChartTooltip';
import { ChartLegend } from './lib/ChartLegend';
import { LEGEND_TOP, layoutChartLegend, type ChartLegendItem, type ChartLegendLayout } from './lib/legend';
import { niceTicks, scaleLinear, stepDigits, type LinearScale } from './lib/scale';
import { hourTickStep } from './lib/timeAxis';
import { useSourceLabel } from './lib/sourceLabel';
import { useElementWidth } from '../components/svg/useElementWidth';
import { isFocusVisible } from './lib/focus';
import { PlotSlider } from './lib/PlotSlider';
import { stepValue } from './lib/sliderKeys';
import { usePlotPointer } from './lib/usePlotPointer';
import { useSvgId } from '../components/svg/useSvgId';
import chart from './lib/chart.module.css';
import styles from './MonthlyYieldChart.module.css';

const de = {
  title: 'Tagesverlauf mit Batterie',
  subtitle: (day: string) =>
    `${day}, stündlich mit dem Wetter der Simulation: Abgabe, Laden, Verbrauch und Ladestand`,
  direct: 'Solar direkt',
  discharge: 'Aus Batterie',
  charge: 'Laden',
  pv: 'Solarleistung',
  load: 'Verbrauch',
  soc: 'Ladestand',
  acLimit: (w: string) => `AC-Grenze ${w}`,
  dayPv: 'Solar am Tag',
  dayOut: 'Abgabe am Tag',
  slider: 'Stunde im Diagramm',
  keys: 'Pfeiltasten: Stunde wechseln.',
  summary: (day: string, pv: string, out: string, load: string, soc: string) =>
    `${day}: Solar ${pv}, Abgabe ${out}, Verbrauch ${load}, Ladestand am Tagesende ${soc}.`,
  waiting: 'Die Batterie wird berechnet …',
  noDay: 'Für diesen Tag gibt es keine Wetterdaten.',
};
type Texts = typeof de;
const messages: Messages<Texts> = {
  de,
  en: {
    title: 'Daily profile with battery',
    subtitle: (day) =>
      `${day}, hourly with the simulation’s weather: output, charging, consumption and charge level`,
    direct: 'Solar direct',
    discharge: 'From battery',
    charge: 'Charging',
    pv: 'Solar power',
    load: 'Consumption',
    soc: 'Charge level',
    acLimit: (w) => `AC limit ${w}`,
    dayPv: 'Solar that day',
    dayOut: 'Output that day',
    slider: 'Hour in the chart',
    keys: 'Arrow keys: change hour.',
    summary: (day, pv, out, load, soc) =>
      `${day}: solar ${pv}, output ${out}, consumption ${load}, charge level at the end of the day ${soc}.`,
    waiting: 'Computing the battery …',
    noDay: 'There is no weather data for this day.',
  },
};

const M = { left: 48, right: 40, title: 18, bottom: 28 };

interface Geometry {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  x: LinearScale;
  y: LinearScale;
  ySoc: LinearScale;
  legend: ChartLegendLayout;
  xTicks: AxisTick[];
  yTicks: AxisTick[];
  bars: { key: string; x: number; y: number; w: number; h: number; fill: string; opacity?: number }[];
  pvPath: string;
  loadPath: string;
  socPath: string;
  limitY: number | null;
}

function stepLine(
  points: readonly BatteryDayPoint[],
  half: number,
  x: LinearScale,
  y: (p: BatteryDayPoint) => number,
): string {
  return points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${x(p.minutes - half).toFixed(1)},${y(p).toFixed(1)}L${x(p.minutes + half).toFixed(1)},${y(p).toFixed(1)}`,
    )
    .join('');
}

function buildGeometry(
  width: number,
  points: readonly BatteryDayPoint[],
  stepMinutes: number,
  acLimitTotal: number,
  legendItems: readonly ChartLegendItem[],
  f: Format,
): Geometry {
  const legend = layoutChartLegend(legendItems, width - M.left);
  const plotH = width < 420 ? 190 : 220;
  const top = LEGEND_TOP + (legend.height > 0 ? legend.height + 6 : 0) + M.title;
  const plot = { left: M.left, right: width - M.right, top, bottom: top + plotH };
  const x = scaleLinear([0, 1440], [plot.left, plot.right]);
  const maxW = Math.max(
    1,
    acLimitTotal,
    ...points.map((p) => Math.max(p.pv, p.load, p.direct + p.discharge + p.charge)),
  );
  const yt = niceTicks(0, maxW, 4);
  const y = scaleLinear([0, yt.max], [plot.bottom, plot.top]);
  const ySoc = scaleLinear([0, 1], [plot.bottom, plot.top]);
  const half = stepMinutes / 2;
  const stepPx = x(stepMinutes) - x(0);
  const w = Math.max(1, stepPx - (stepPx >= 6 ? 2 : 0));
  const bars: Geometry['bars'] = [];
  for (const p of points) {
    const bx = x(p.minutes) - w / 2;
    let base = 0;
    const parts: [string, number, string, number?][] = [
      ['d', p.direct, 'var(--flow-direct)'],
      ['b', p.discharge, 'var(--flow-battery)'],
      ['c', p.charge, 'var(--flow-battery)', 0.4],
    ];
    for (const [k, v, fill, opacity] of parts) {
      if (!(v > 0)) continue;
      const y0 = y(base);
      const y1 = y(base + v);
      if (y0 - y1 >= 0.5) bars.push({ key: `${p.minutes}-${k}`, x: bx, y: y1, w, h: y0 - y1, fill, opacity });
      base += v;
    }
  }
  const pxPerMinute = (plot.right - plot.left) / 1440;
  const step = hourTickStep(pxPerMinute);
  const xTicks: AxisTick[] = [];
  for (let m = 0; m <= 1440; m += step) xTicks.push({ pos: x(m), label: String(m / 60).padStart(2, '0') });
  return {
    width,
    height: plot.bottom + M.bottom,
    plot,
    x,
    y,
    ySoc,
    legend,
    xTicks,
    yTicks: yt.ticks.map((v) => ({ pos: y(v), label: f.num(v, stepDigits(yt.step)) })),
    bars,
    pvPath: stepLine(points, half, x, (p) => y(p.pv)),
    loadPath: stepLine(points, half, x, (p) => y(p.load)),
    socPath: points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.minutes + half).toFixed(1)},${ySoc(p.soc).toFixed(1)}`)
      .join(''),
    limitY: acLimitTotal > 0 && acLimitTotal <= yt.max ? y(acLimitTotal) : null,
  };
}

const whOf = (points: readonly BatteryDayPoint[], key: keyof BatteryDayPoint, hours: number): number =>
  points.reduce((s, p) => s + p[key] * hours, 0) / 1000;

/** Hourly power flows (direct output, discharging, charging), PV and load lines and the SoC on the selected day. */
export function BatteryDayChart() {
  const t = useMessages(messages);
  const f = useFormat();
  const lang = useLang();
  const result = useBattery();
  const simConfig = useSimulationConfig();
  const pending = useAnnualInputsPending();
  const { name: locationName, timezone } = useConfigSection('location');
  const date = useTimeStore((s) => s.date);
  const source = useSourceLabel(result);
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const uid = useSvgId('bd');
  const day = result ? dayInYear(date, result.year) : date;
  const points = useMemo(
    () => (result ? batteryDay(result.series, day, timezone) : []),
    [result, day, timezone],
  );
  const stepMinutes = result?.series.stepMinutes ?? 60;
  const hours = stepMinutes / 60;
  const acLimitTotal = result ? simConfig.battery.acLimitW * result.systems : 0;

  const legendItems = useMemo<ChartLegendItem[]>(
    () => [
      { key: 'direct', label: t.direct, swatch: 'rect', color: 'var(--flow-direct)' },
      { key: 'discharge', label: t.discharge, swatch: 'rect', color: 'var(--flow-battery)' },
      { key: 'charge', label: t.charge, swatch: 'band', color: 'var(--flow-battery)', opacity: 0.4 },
      { key: 'pv', label: t.pv, swatch: 'line', color: 'var(--sun-ink)' },
      { key: 'load', label: t.load, swatch: 'line', color: 'var(--text)' },
      { key: 'soc', label: `${t.soc} (%)`, swatch: 'line', color: 'var(--flow-soc)' },
    ],
    [t],
  );
  const geom = useMemo(
    () =>
      points.length > 0 ? buildGeometry(width, points, stepMinutes, acLimitTotal, legendItems, f) : null,
    [width, points, stepMinutes, acLimitTotal, legendItems, f],
  );
  const dayLabel = f.date(day);
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const keysId = `${uid}-keys`;
  const last = points[points.length - 1];
  const summary = last
    ? t.summary(
        dayLabel,
        f.kwh(whOf(points, 'pv', hours), 1),
        f.kwh(whOf(points, 'direct', hours) + whOf(points, 'discharge', hours), 1),
        f.kwh(whOf(points, 'load', hours), 1),
        f.pct(last.soc * 100),
      )
    : '';

  return (
    <ViewCard
      title={t.title}
      subtitle={t.subtitle(dayLabel)}
      exportKind="batteryDay"
      exportParts={result ? [locationName, day, ...clearSkyParts(result.source, lang)] : [locationName]}
      busy={!result || pending}
    >
      {result && points.length > 0 && (
        <ChartStats
          items={[
            { key: 'pv', label: t.dayPv, value: f.kwh(whOf(points, 'pv', hours), 1) },
            {
              key: 'out',
              label: t.dayOut,
              value: f.kwh(whOf(points, 'direct', hours) + whOf(points, 'discharge', hours), 1),
            },
          ]}
        />
      )}
      <div ref={rootRef} className={chart.root}>
        {result && geom ? (
          <>
            <p id={keysId} className="sr-only">
              {t.keys}
            </p>
            <HourInteraction
              geom={geom}
              points={points}
              stepMinutes={stepMinutes}
              f={f}
              t={t}
              keysId={keysId}
              dayLabel={dayLabel}
            />
            <svg
              className={`${chart.svg} ${styles.svg}`}
              width={geom.width}
              height={geom.height}
              viewBox={`0 0 ${geom.width} ${geom.height}`}
              role="img"
              aria-labelledby={titleId}
              aria-describedby={descId}
            >
              <title id={titleId}>{t.title}</title>
              <desc id={descId}>{summary}</desc>
              <ChartLegend layout={geom.legend} x={geom.plot.left} y={LEGEND_TOP} />
              <AxisY
                ticks={geom.yTicks}
                x0={geom.plot.left}
                x1={geom.plot.right}
                title="W"
                titleY={geom.plot.top - 8}
              />
              <g aria-hidden="true">
                {geom.bars.map((b) => (
                  <rect
                    key={b.key}
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.h}
                    fill={b.fill}
                    fillOpacity={b.opacity}
                  />
                ))}
                {geom.limitY !== null && (
                  <g>
                    <line
                      x1={geom.plot.left}
                      x2={geom.plot.right}
                      y1={geom.limitY}
                      y2={geom.limitY}
                      stroke="var(--text-muted)"
                      strokeDasharray="4 3"
                    />
                    <text
                      x={geom.plot.right - 4}
                      y={geom.limitY - 4}
                      textAnchor="end"
                      fontSize={11}
                      fill="var(--text-muted)"
                    >
                      {t.acLimit(f.unit(acLimitTotal, 'W'))}
                    </text>
                  </g>
                )}
                <path
                  d={geom.pvPath}
                  fill="none"
                  stroke="var(--sun-ink)"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                />
                <path d={geom.loadPath} fill="none" stroke="var(--text)" strokeWidth={2} />
                <path d={geom.socPath} fill="none" stroke="var(--flow-soc)" strokeWidth={2} />
                {[0, 0.5, 1].map((v) => (
                  <text
                    key={v}
                    x={geom.plot.right + 6}
                    y={geom.ySoc(v)}
                    dominantBaseline="middle"
                    fontSize={11}
                    fill="var(--flow-soc)"
                  >
                    {f.num(v * 100)}%
                  </text>
                ))}
              </g>
              <AxisX ticks={geom.xTicks} y={geom.plot.bottom} x0={geom.plot.left} x1={geom.plot.right} />
            </svg>
          </>
        ) : (
          <div className={chart.empty}>{result ? t.noDay : t.waiting}</div>
        )}
      </div>
      {source && <p className={chart.caption}>{source}</p>}
    </ViewCard>
  );
}

interface HourProps {
  geom: Geometry;
  points: readonly BatteryDayPoint[];
  stepMinutes: number;
  f: Format;
  t: Texts;
  keysId: string;
  dayLabel: string;
}

/** Hover per weather step and a keyboard step slider with the values of that hour. */
function HourInteraction({ geom, points, stepMinutes, f, t, keysId, dayLabel }: HourProps) {
  const [index, setIndex] = useState(() => Math.min(points.length - 1, 12));
  const [keyboard, setKeyboard] = useState(false);
  const { plot } = geom;
  const locate = (px: number): number | null => {
    const minutes = (px / (plot.right - plot.left)) * 1440;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].minutes - minutes) < Math.abs(points[best].minutes - minutes)) best = i;
    }
    return points.length > 0 ? best : null;
  };
  const pointer = usePlotPointer({ locate });
  const active = pointer.hover ?? (keyboard ? Math.min(index, points.length - 1) : null);
  const hourLabel = (p: BatteryDayPoint): string => {
    const start = Math.round(p.minutes - stepMinutes / 2);
    return `${f.time(start)}–${f.time(start + stepMinutes)}`;
  };
  const rows = (p: BatteryDayPoint): TooltipRow[] => [
    { key: 'pv', label: t.pv, value: f.unit(p.pv, 'W'), color: 'var(--sun-ink)', mark: 'line' },
    {
      key: 'direct',
      label: t.direct,
      value: f.unit(p.direct, 'W'),
      color: 'var(--flow-direct)',
      mark: 'rect',
    },
    {
      key: 'discharge',
      label: t.discharge,
      value: f.unit(p.discharge, 'W'),
      color: 'var(--flow-battery)',
      mark: 'rect',
    },
    {
      key: 'charge',
      label: t.charge,
      value: f.unit(p.charge, 'W'),
      color: 'var(--flow-battery)',
      mark: 'rect',
    },
    { key: 'load', label: t.load, value: f.unit(p.load, 'W'), color: 'var(--text)', mark: 'line' },
    { key: 'soc', label: t.soc, value: f.pct(p.soc * 100), color: 'var(--flow-soc)', mark: 'line' },
  ];
  const valueText = (i: number): string => {
    const p = points[i];
    if (!p) return '';
    return `${dayLabel} ${hourLabel(p)}: ${rows(p)
      .map((r) => `${r.label} ${r.value}`)
      .join(', ')}`;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      if (active !== null) {
        e.preventDefault();
        pointer.clear();
        setKeyboard(false);
      }
      return;
    }
    const next = stepValue(e.key, index, { step: 1, page: 6, min: 0, max: points.length - 1 });
    if (next === null) return;
    e.preventDefault();
    pointer.clear();
    setIndex(next);
    setKeyboard(true);
  };
  const p = active !== null ? points[active] : null;
  return (
    <>
      <PlotSlider
        className={styles.overlay}
        plot={plot}
        label={t.slider}
        describedBy={keysId}
        min={0}
        max={Math.max(0, points.length - 1)}
        value={Math.min(index, points.length - 1)}
        valueText={valueText(Math.min(index, points.length - 1))}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          if (isFocusVisible(e.currentTarget)) setKeyboard(true);
        }}
        onBlur={() => setKeyboard(false)}
        {...pointer.handlers}
      />
      {p && (
        <ChartTooltip
          x={geom.x(p.minutes)}
          y={geom.y(Math.max(p.pv, p.load, p.direct + p.discharge + p.charge))}
          boundsWidth={geom.width}
          boundsHeight={geom.height}
          title={`${dayLabel} ${hourLabel(p)}`}
          rows={rows(p)}
        />
      )}
    </>
  );
}
