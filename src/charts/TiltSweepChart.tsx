import { useMemo, useState, type KeyboardEvent } from 'react';
import { ViewCard } from '../components/ViewCard';
import { Button } from '../components/Button';
import { useFormat, useMessages, type Format, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useTiltSweep, type TiltSweepResult } from '../hooks/useModel';
import { LIMITS } from '../model/defaults';
import { useConfigSection, usePatch } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { AxisX, AxisY, type AxisTick } from './lib/Axes';
import { ChartDataTable } from './lib/DataTable';
import { ChartTooltip, type TooltipRow } from './lib/ChartTooltip';
import { ChartLegend } from './lib/ChartLegend';
import { floorColor } from './lib/colors';
import { topDown, useFloorLabels } from './lib/floors';
import { LEGEND_TOP, layoutChartLegend, type ChartLegendItem, type ChartLegendLayout } from './lib/legend';
import { linePath } from './lib/paths';
import { nearestIndex, niceTicks, scaleLinear, stepDigits, type LinearScale } from './lib/scale';
import { useSourceLabel } from './lib/sourceLabel';
import { estimateTextWidth, measureTextWidth } from './lib/text';
import { useElementWidth } from './lib/useElementWidth';
import { isFocusVisible } from './lib/focus';
import { HoverMarks, PlotSlider } from './lib/PlotSlider';
import { stepValue } from './lib/sliderKeys';
import { usePlotPointer } from './lib/usePlotPointer';
import { useSvgId } from './lib/useSvgId';
import chart from './lib/chart.module.css';
import styles from './TiltSweepChart.module.css';

const de = {
  title: 'Neigungsvergleich',
  subtitle: 'Jahresertrag je Neigung θ ab Senkrechte (0° = senkrecht, 90° = liegend)',
  total: 'Summe aller Stockwerke',
  totalShort: 'Summe',
  showTotal: 'Summe zeigen',
  current: (deg: string) => `θ ${deg}`,
  optimum: (deg: string) => `Optimum ${deg}`,
  optimumTotal: (deg: string) => `Optimum Summe ${deg}`,
  beta: (deg: string) => `β ${deg}`,
  slider: 'Neigung im Neigungsvergleich',
  keys: 'Pfeiltasten: Neigung in 5°-Schritten ändern.',
  clickHint: 'Klicken übernimmt diese Neigung',
  steps: 'Gerechnet in 5°-Schritten.',
  obstacles: 'Hindernis-Horizonte für alle Neigungen bei θ = 45° berechnet.',
  summary: (opt: string, kwh: string, current: string) =>
    `Jahresertrag je Neigung von 0° bis 90°. Optimum aller Stockwerke bei ${opt} mit ${kwh}. Aktuelle Neigung ${current}.`,
  summaryFloor: (floor: string, deg: string, kwh: string) => `${floor}: Optimum ${deg} (${kwh})`,
  waiting: 'Der Neigungsvergleich wird berechnet …',
  tableCaption: 'Jahresertrag je Neigung θ',
  colTilt: 'θ ab Senkrechte',
  colBeta: 'β ab Horizontal',
};
type Texts = typeof de;
const messages: Messages<Texts> = {
  de,
  en: {
    title: 'Tilt comparison',
    subtitle: 'Annual yield per tilt θ from vertical (0° = vertical, 90° = flat)',
    total: 'Total of all floors',
    totalShort: 'Total',
    showTotal: 'Show total',
    current: (deg) => `θ ${deg}`,
    optimum: (deg) => `Optimum ${deg}`,
    optimumTotal: (deg) => `Optimum (total) ${deg}`,
    beta: (deg) => `β ${deg}`,
    slider: 'Tilt in the tilt comparison',
    keys: 'Arrow keys: change the tilt in 5° steps.',
    clickHint: 'Click to use this tilt',
    steps: 'Computed in 5° steps.',
    obstacles: 'Obstacle horizons evaluated at θ = 45° for all tilts.',
    summary: (opt, kwh, current) =>
      `Annual yield per tilt from 0° to 90°. Optimum for all floors at ${opt} with ${kwh}. Current tilt ${current}.`,
    summaryFloor: (floor, deg, kwh) => `${floor}: optimum ${deg} (${kwh})`,
    waiting: 'Computing the tilt comparison …',
    tableCaption: 'Annual yield per tilt θ',
    colTilt: 'θ from vertical',
    colBeta: 'β from horizontal',
  },
};

const M = { left: 52, right: 16, band: 22, bottom: 30 };
const TILT = LIMITS.panels.tiltFromVertical;

interface Geometry {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  x: LinearScale;
  y: LinearScale;
  legend: ChartLegendLayout;
  xTicks: AxisTick[];
  yTicks: AxisTick[];
  lines: { key: string; d: string; color: string; total: boolean }[];
}

function buildGeometry(
  width: number,
  sweep: TiltSweepResult,
  showTotal: boolean,
  legendItems: readonly ChartLegendItem[],
  f: Format,
): Geometry {
  const n = sweep.points[0]?.floorsKwh.length ?? 0;
  const legend = layoutChartLegend(legendItems, width - M.left);
  const plotH = width < 420 ? 180 : width < 640 ? 200 : 220;
  const top = LEGEND_TOP + (legend.height > 0 ? legend.height + 6 : 0) + M.band;
  const plot = { left: M.left, right: width - M.right, top, bottom: top + plotH };
  const withTotal = showTotal && n > 1;
  const maxY = Math.max(...sweep.points.map((p) => (withTotal ? p.totalKwh : Math.max(...p.floorsKwh))));
  const yt = niceTicks(0, Math.max(1, maxY), 4);
  const x = scaleLinear([TILT.min, TILT.max], [plot.left, plot.right]);
  const y = scaleLinear([0, yt.max], [plot.bottom, plot.top]);
  const xStep = plot.right - plot.left < 260 ? 30 : 15;
  const xTicks: AxisTick[] = [];
  for (let d = TILT.min; d <= TILT.max; d += xStep) xTicks.push({ pos: x(d), label: f.deg(d) });
  const lines: Geometry['lines'] = Array.from({ length: n }, (_, k) => ({
    key: `f${k}`,
    d: linePath(sweep.points.map((p) => [x(p.tiltFromVertical), y(p.floorsKwh[k])] as const)),
    color: floorColor(k),
    total: false,
  }));
  if (withTotal) {
    lines.push({
      key: 'total',
      d: linePath(sweep.points.map((p) => [x(p.tiltFromVertical), y(p.totalKwh)] as const)),
      color: 'var(--text)',
      total: true,
    });
  }
  return {
    width,
    height: plot.bottom + M.bottom,
    plot,
    x,
    y,
    legend,
    xTicks,
    yTicks: yt.ticks.map((v) => ({ pos: y(v), label: f.num(v, stepDigits(yt.step)) })),
    lines,
  };
}

/** Screen y-range [min, max] of a polyline (points sorted by x) between x0 and x1 (px), linear in between. */
function yRange(points: readonly (readonly [number, number])[], x0: number, x1: number): [number, number] {
  const at = (px: number): number => {
    const i = points.findIndex(([x]) => x >= px);
    if (i < 0) return points[points.length - 1][1];
    if (i === 0) return points[0][1];
    const [xa, ya] = points[i - 1];
    const [xb, yb] = points[i];
    return xb === xa ? yb : ya + ((px - xa) / (xb - xa)) * (yb - ya);
  };
  const ys = [at(x0), at(x1), ...points.filter(([x]) => x > x0 && x < x1).map(([, y]) => y)];
  return [Math.min(...ys), Math.max(...ys)];
}

/** Floor-wise optimum (first maximum) of the sweep. */
function floorOptimum(sweep: TiltSweepResult, k: number): { tilt: number; kwh: number } {
  return sweep.points.reduce(
    (best, p) => (p.floorsKwh[k] > best.kwh ? { tilt: p.tiltFromVertical, kwh: p.floorsKwh[k] } : best),
    { tilt: sweep.points[0].tiltFromVertical, kwh: sweep.points[0].floorsKwh[k] },
  );
}

interface MarkersProps {
  geom: Geometry;
  sweep: TiltSweepResult;
  theta: number;
  showTotal: boolean;
  f: Format;
  t: Texts;
}

/** Optimum label: gap to the drop line, text extent above/below the baseline incl. halo (11 px font), px. */
const OPT_LABEL = { gap: 7, ascent: 11, descent: 4 };

/** Current tilt (accent line + pill) and the optimum (sun-coloured point with label) — part of the export. */
function Markers({ geom, sweep, theta, showTotal, f, t }: MarkersProps) {
  const { plot, x, y } = geom;
  const n = sweep.points[0].floorsKwh.length;
  const opt = sweep.optimum;
  const ox = x(opt.tiltFromVertical);
  // The optimum is that of the total of all floors (as in the tilt control). With the total line hidden it
  // is marked by its drop line only — dots on the floor lines would suggest per-floor optima.
  const optOnTotal = showTotal && n > 1;
  const optY = optOnTotal ? y(opt.totalKwh) : n > 1 ? plot.top : y(opt.floorsKwh[0]);
  const cx = x(theta);
  const label = t.current(f.deg(theta));
  const w = estimateTextWidth(label, 11) + 14;
  const px = Math.max(plot.left - 2, Math.min(cx - w / 2, geom.width - w));
  const optLabel = (n > 1 && !optOnTotal ? t.optimumTotal : t.optimum)(f.deg(opt.tiltFromVertical));
  // Measured: the collision checks below need the real width of the bold label.
  const optW = measureTextWidth(optLabel, 11, 600);

  // Side of the drop line: one with room that the θ marker line does not cross.
  const span = OPT_LABEL.gap + optW;
  const fitsR = ox + span <= plot.right;
  const fitsL = ox - span >= plot.left;
  const markerR = cx > ox && cx < ox + span + 4;
  const markerL = cx < ox && cx > ox - span - 4;
  const right = fitsR && !markerR ? true : fitsL && !markerL ? false : fitsR;
  const lx0 = right ? ox + OPT_LABEL.gap : ox - span;
  const lx1 = lx0 + optW;

  // Height: right below the optimum point when no curve runs through the label there, else at the foot of
  // the drop line (the curves stay far above zero). Without the total line the foot is the only place:
  // the highest floor curve peaks at the top of the plot.
  const curves = [
    ...(optOnTotal ? [sweep.points.map((p) => p.totalKwh)] : []),
    ...Array.from({ length: n }, (_, k) => sweep.points.map((p) => p.floorsKwh[k])),
  ].map((values) => values.map((v, i) => [x(sweep.points[i].tiltFromVertical), y(v)] as const));
  const ranges = curves.map((c) => yRange(c, lx0 - 2, lx1 + 2));
  const clear = (baseline: number): boolean =>
    ranges.every(([lo, hi]) => hi < baseline - OPT_LABEL.ascent || lo > baseline + OPT_LABEL.descent);
  const foot = plot.bottom - 8;
  const underCurve =
    n > 1 && !optOnTotal ? foot : Math.min(foot, Math.max(optY + 18, ranges[0][1] + OPT_LABEL.ascent + 3));
  const labelY = clear(underCurve) ? underCurve : foot;
  return (
    <g aria-hidden="true">
      <line className={chart.marker} x1={cx} x2={cx} y1={plot.top - 4} y2={plot.bottom} />
      <rect className={chart.pill} x={px} y={plot.top - M.band + 2} width={w} height={16} rx={8} />
      <text
        className={chart.pillText}
        x={px + w / 2}
        y={plot.top - M.band + 10}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {label}
      </text>
      <line className={styles.optLine} x1={ox} x2={ox} y1={optY} y2={plot.bottom} />
      {(optOnTotal || n === 1) && (
        <circle className={`${chart.dot} ${styles.optDot}`} cx={ox} cy={optY} r={5} />
      )}
      <text
        className={`${chart.markerLabel} ${chart.halo}`}
        x={right ? lx0 : lx1}
        y={labelY}
        textAnchor={right ? 'start' : 'end'}
      >
        {optLabel}
      </text>
    </g>
  );
}

interface InteractionProps {
  geom: Geometry;
  sweep: TiltSweepResult;
  theta: number;
  labels: readonly string[];
  showTotal: boolean;
  f: Format;
  t: Texts;
  keysId: string;
  onTilt: (tilt: number) => void;
}

/** Crosshair + tooltip on hover (snapped to the 5° points), click or arrow keys set the tilt (role="slider"). */
function SweepInteraction({ geom, sweep, theta, labels, showTotal, f, t, keysId, onTilt }: InteractionProps) {
  const [keyboard, setKeyboard] = useState(false);
  const { plot } = geom;
  const tilts = useMemo(() => sweep.points.map((p) => p.tiltFromVertical), [sweep]);
  const n = sweep.points[0].floorsKwh.length;
  const withTotal = showTotal && n > 1;

  const pointer = usePlotPointer({
    locate: (px) => {
      const i = nearestIndex(tilts, geom.x.invert(plot.left + px));
      return i < 0 ? null : i;
    },
    onSelect: (i) => onTilt(tilts[i]),
  });

  const exact = tilts.indexOf(theta);
  const index = pointer.hover ?? (keyboard ? (exact >= 0 ? exact : nearestIndex(tilts, theta)) : null);
  const point = index === null ? null : sweep.points[index];

  const rows = (i: number): TooltipRow[] => {
    const p = sweep.points[i];
    const floorRows: TooltipRow[] = topDown(n).map((k) => ({
      key: String(k),
      value: f.kwh(p.floorsKwh[k]),
      label: labels[k] ?? String(k),
      color: floorColor(k),
      mark: 'line',
    }));
    return n > 1
      ? [
          { key: 'total', value: f.kwh(p.totalKwh), label: t.totalShort, color: 'var(--text)', mark: 'line' },
          ...floorRows,
        ]
      : floorRows;
  };

  const valueText = (): string => {
    const i = tilts.indexOf(theta);
    const head = `${t.current(f.deg(theta))}, ${t.beta(f.deg(90 - theta))}`;
    if (i < 0) return head;
    return `${head}: ${rows(i)
      .map((r) => `${r.label} ${r.value}`)
      .join(', ')}`;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Escape hides the crosshair and tooltip (WCAG 1.4.13); the tilt stays.
    if (e.key === 'Escape') {
      if (keyboard || pointer.hover !== null) {
        e.preventDefault();
        pointer.clear();
        setKeyboard(false);
      }
      return;
    }
    const next = stepValue(e.key, theta, { step: 5, page: 15, min: TILT.min, max: TILT.max });
    if (next === null) return;
    e.preventDefault();
    pointer.clear();
    setKeyboard(true);
    onTilt(next);
  };

  const px = point ? geom.x(point.tiltFromVertical) : 0;
  return (
    <>
      {point && (
        <HoverMarks
          width={geom.width}
          height={geom.height}
          x={px}
          plot={plot}
          dots={[
            ...(withTotal ? [{ key: 'total', y: geom.y(point.totalKwh), color: 'var(--text)' }] : []),
            ...topDown(n).map((k) => ({
              key: String(k),
              y: geom.y(point.floorsKwh[k]),
              color: floorColor(k),
            })),
          ]}
        />
      )}
      <PlotSlider
        plot={plot}
        label={t.slider}
        describedBy={keysId}
        min={TILT.min}
        max={TILT.max}
        value={theta}
        valueText={valueText()}
        onKeyDown={onKeyDown}
        // Keyboard focus shows the readout of the current tilt without changing it.
        onFocus={(e) => {
          if (isFocusVisible(e.currentTarget)) setKeyboard(true);
        }}
        onBlur={() => setKeyboard(false)}
        {...pointer.handlers}
      />
      {point && index !== null && (
        <ChartTooltip
          x={px}
          y={geom.y(withTotal ? point.totalKwh : Math.max(...point.floorsKwh))}
          boundsWidth={geom.width}
          boundsHeight={geom.height}
          title={`${t.current(f.deg(point.tiltFromVertical))} · ${t.beta(f.deg(90 - point.tiltFromVertical))}`}
          rows={rows(index)}
          note={pointer.hover !== null && point.tiltFromVertical !== theta ? t.clickHint : undefined}
        />
      )}
    </>
  );
}

/** Annual yield vs. tilt θ (line per floor + total); current tilt and optimum marked, click to set the tilt. */
export function TiltSweepChart() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const sweep = useTiltSweep();
  const theta = useConfigSection('panels').tiltFromVertical;
  const hasObstacles = useConfigSection('horizon').obstacles.length > 0;
  const patch = usePatch();
  const weather = useDataStore((s) => s.weather);
  const labels = useFloorLabels();
  const source = useSourceLabel(weather.series);
  // Default: total shown for up to 3 floors; with more floors it would squash the floor lines.
  const [totalChoice, setTotalChoice] = useState<boolean | null>(null);
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const uid = useSvgId('ts');
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const keysId = `${uid}-keys`;
  const n = sweep?.points[0]?.floorsKwh.length ?? 0;
  const showTotal = totalChoice ?? n <= 3;
  const withTotal = showTotal && n > 1;

  const legendItems = useMemo<ChartLegendItem[]>(() => {
    if (n <= 1) return [];
    const items: ChartLegendItem[] = Array.from({ length: n }, (_, k) => ({
      key: `f${k}`,
      label: labels[k] ?? String(k),
      swatch: 'line',
      color: floorColor(k),
    }));
    if (withTotal) items.push({ key: 'total', label: t.total, swatch: 'line', color: 'var(--text)' });
    return items;
  }, [n, labels, withTotal, t]);

  const geom = useMemo(
    () => (sweep ? buildGeometry(width, sweep, showTotal, legendItems, f) : null),
    [width, sweep, showTotal, legendItems, f],
  );

  const summary = useMemo(() => {
    if (!sweep) return '';
    const floors =
      n > 1
        ? topDown(n)
            .map((k) => {
              const o = floorOptimum(sweep, k);
              return t.summaryFloor(labels[k], f.deg(o.tilt), f.kwh(o.kwh));
            })
            .join('; ')
        : '';
    return [
      t.summary(f.deg(sweep.optimum.tiltFromVertical), f.kwh(sweep.optimum.totalKwh), f.deg(theta)),
      floors ? `${floors}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }, [sweep, n, labels, theta, f, t]);

  const table = useMemo(() => {
    if (!sweep) return null;
    return {
      columns: [
        { key: 'tilt', header: t.colTilt },
        { key: 'beta', header: t.colBeta, numeric: true },
        ...Array.from({ length: n }, (_, k) => ({ key: `f${k}`, header: labels[k], numeric: true })),
        ...(n > 1 ? [{ key: 'total', header: c.total, numeric: true }] : []),
      ],
      rows: sweep.points.map((p) => ({
        key: String(p.tiltFromVertical),
        current: p.tiltFromVertical === theta,
        cells: [
          f.deg(p.tiltFromVertical),
          f.deg(90 - p.tiltFromVertical),
          ...p.floorsKwh.map((v) => f.kwh(v)),
          ...(n > 1 ? [f.kwh(p.totalKwh)] : []),
        ],
      })),
    };
  }, [sweep, n, labels, theta, f, t, c]);

  const setTilt = (tilt: number): void => patch('panels', { tiltFromVertical: tilt });
  const busy = !sweep || weather.status === 'loading';

  return (
    <ViewCard
      title={t.title}
      subtitle={t.subtitle}
      toolbar={
        n > 1 ? (
          <Button size="sm" pressed={showTotal} onClick={() => setTotalChoice(!showTotal)}>
            {t.showTotal}
          </Button>
        ) : undefined
      }
      exportName="neigungsvergleich"
      busy={busy}
      footer={
        table ? (
          <ChartDataTable
            caption={t.tableCaption}
            context={t.title}
            columns={table.columns}
            rows={table.rows}
          />
        ) : undefined
      }
    >
      <div ref={rootRef} className={chart.root}>
        {sweep && geom ? (
          <>
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
              {geom.legend.height > 0 && (
                <ChartLegend layout={geom.legend} x={geom.plot.left} y={LEGEND_TOP} />
              )}
              <AxisY
                ticks={geom.yTicks}
                x0={geom.plot.left}
                x1={geom.plot.right}
                title="kWh"
                titleY={geom.plot.top - 8}
              />
              <AxisX ticks={geom.xTicks} y={geom.plot.bottom} x0={geom.plot.left} x1={geom.plot.right} />
              <g aria-hidden="true">
                {geom.lines.map((l) => (
                  <path
                    key={l.key}
                    className={`${chart.series} ${l.total ? styles.total : ''}`}
                    d={l.d}
                    stroke={l.color}
                  />
                ))}
              </g>
              <Markers geom={geom} sweep={sweep} theta={theta} showTotal={showTotal} f={f} t={t} />
            </svg>
            <p id={keysId} className="sr-only">
              {t.keys}
            </p>
            <SweepInteraction
              geom={geom}
              sweep={sweep}
              theta={theta}
              labels={labels}
              showTotal={showTotal}
              f={f}
              t={t}
              keysId={keysId}
              onTilt={setTilt}
            />
          </>
        ) : (
          <div className={chart.empty}>{t.waiting}</div>
        )}
      </div>
      <p className={chart.caption}>
        {[source, t.steps, hasObstacles ? t.obstacles : null].filter(Boolean).join(' ')}
      </p>
    </ViewCard>
  );
}
