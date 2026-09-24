import { useMemo, useState, type KeyboardEvent } from 'react';
import { ViewCard } from '../components/ViewCard';
import { Segmented } from '../components/Segmented';
import { monthNames, useFormat, useLang, useMessages, type Format, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { clearSkyParts } from '../export/filenames';
import { useSimulation } from '../hooks/useModel';
import type { SimulationResult } from '../model/types';
import { useConfigSection } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { AxisX, AxisY, type AxisTick } from './lib/Axes';
import { ChartStats } from './lib/ChartStats';
import { ChartTooltip, type TooltipRow } from './lib/ChartTooltip';
import { HatchPattern } from './lib/HatchPattern';
import { ChartLegend } from './lib/ChartLegend';
import { floorColor } from './lib/colors';
import { topDown, useFloorLabels } from './lib/floors';
import { LEGEND_TOP, layoutChartLegend, type ChartLegendItem, type ChartLegendLayout } from './lib/legend';
import { roundedTopBar } from './lib/paths';
import { niceTicks, scaleBand, scaleLinear, stepDigits, type BandScale, type LinearScale } from './lib/scale';
import { useSourceLabel } from './lib/sourceLabel';
import { useElementWidth } from './lib/useElementWidth';
import { isFocusVisible } from './lib/focus';
import { PlotSlider } from './lib/PlotSlider';
import { stepValue } from './lib/sliderKeys';
import { usePlotPointer } from './lib/usePlotPointer';
import { useSvgId } from './lib/useSvgId';
import chart from './lib/chart.module.css';
import styles from './MonthlyYieldChart.module.css';

type Mode = 'grouped' | 'stacked';

const de = {
  title: 'Monatsertrag',
  subtitle: 'Ertrag je Stockwerk und Monat; schraffiert: Verschattungsverlust',
  mode: 'Darstellung',
  grouped: 'Nebeneinander',
  stacked: 'Gestapelt',
  loss: 'Verschattungsverlust',
  lossOf: (kwh: string) => `Verlust ${kwh}`,
  year: (year: number) => `Jahr ${year}`,
  slider: 'Monat im Diagramm',
  keys: 'Pfeiltasten: Monat wechseln.',
  summary: (year: number, total: string, loss: string, pct: string) =>
    `Monatsertrag ${year}: total ${total}, Verschattungsverlust ${loss} (${pct}).`,
  summaryRange: (best: string, bestKwh: string, worst: string, worstKwh: string) =>
    `Höchster Monat ${best} mit ${bestKwh}, tiefster ${worst} mit ${worstKwh}.`,
  summaryFloor: (floor: string, kwh: string, loss: string) => `${floor}: ${kwh} (Verlust ${loss})`,
  waiting: 'Der Jahresertrag wird berechnet …',
};
type Texts = typeof de;
const messages: Messages<Texts> = {
  de,
  en: {
    title: 'Monthly yield',
    subtitle: 'Yield per floor and month; hatched: shading loss',
    mode: 'Layout',
    grouped: 'Side by side',
    stacked: 'Stacked',
    loss: 'Shading loss',
    lossOf: (kwh) => `loss ${kwh}`,
    year: (year) => `Year ${year}`,
    slider: 'Month in the chart',
    keys: 'Arrow keys: change month.',
    summary: (year, total, loss, pct) =>
      `Monthly yield ${year}: total ${total}, shading loss ${loss} (${pct}).`,
    summaryRange: (best, bestKwh, worst, worstKwh) =>
      `Best month ${best} with ${bestKwh}, lowest ${worst} with ${worstKwh}.`,
    summaryFloor: (floor, kwh, loss) => `${floor}: ${kwh} (loss ${loss})`,
    waiting: 'Computing the annual yield …',
  },
};

const M = { left: 48, right: 12, title: 18, bottom: 28 };
const MAX_BAR = 24;
const MAX_COLUMN = 28;

interface Segment {
  key: string;
  d: string;
  fill: string;
}

interface Geometry {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  x: BandScale;
  y: LinearScale;
  legend: ChartLegendLayout;
  xTicks: AxisTick[];
  yTicks: AxisTick[];
  segments: Segment[];
  /** Top (px) of the tallest bar per month (tooltip anchor). */
  monthTop: number[];
}

/** Id of the hatch pattern of floor k (or the neutral one for all floors) inside one chart instance. */
const hatchId = (uid: string, k: number | 'loss'): string => `${uid}-hatch-${k}`;

const monthlyLoss = (sim: SimulationResult, k: number, m: number): number =>
  Math.max(0, sim.floors[k].monthlyUnshadedKwh[m] - sim.floors[k].monthlyKwh[m]);

function buildGeometry(
  width: number,
  sim: SimulationResult,
  mode: Mode,
  legendItems: readonly ChartLegendItem[],
  monthLabels: readonly string[],
  patternId: (k: number | 'loss') => string,
  f: Format,
): Geometry {
  const n = sim.floors.length;
  const legend = layoutChartLegend(legendItems, width - M.left);
  const plotH = width < 420 ? 180 : width < 640 ? 200 : 220;
  const top = LEGEND_TOP + (legend.height > 0 ? legend.height + 6 : 0) + M.title;
  const plot = { left: M.left, right: width - M.right, top, bottom: top + plotH };
  const x = scaleBand(12, [plot.left, plot.right], 0.22);

  const maxY =
    mode === 'grouped'
      ? Math.max(...sim.floors.flatMap((fl) => fl.monthlyUnshadedKwh))
      : Math.max(
          ...Array.from({ length: 12 }, (_, m) =>
            sim.floors.reduce((s, fl) => s + fl.monthlyUnshadedKwh[m], 0),
          ),
        );
  const yt = niceTicks(0, Math.max(1, maxY), 4);
  const y = scaleLinear([0, yt.max], [plot.bottom, plot.top]);
  const y0 = y(0);

  const segments: Segment[] = [];
  const monthTop: number[] = [];
  const bw = x.bandwidth;
  for (let m = 0; m < 12; m++) {
    let topPx = y0;
    if (mode === 'grouped') {
      const gap = bw / n >= 6 ? 2 : 1;
      const barW = Math.max(1, Math.min(MAX_BAR, (bw - gap * (n - 1)) / n));
      const groupW = n * barW + (n - 1) * gap;
      const x0 = x(m) + (bw - groupW) / 2;
      for (let k = 0; k < n; k++) {
        const bx = x0 + k * (barW + gap);
        const kwh = sim.floors[k].monthlyKwh[m];
        const loss = monthlyLoss(sim, k, m);
        const yTop = y(kwh);
        const lTop = y(kwh + loss);
        const hasLoss = yTop - lTop >= 0.5;
        // 2 px surface gap between the yield and the loss segment when both are tall enough.
        const split = hasLoss && yTop - lTop >= 3 && y0 - yTop >= 3 ? 2 : 0;
        segments.push({
          key: `y${m}-${k}`,
          d: roundedTopBar(bx, yTop, barW, y0 - yTop, hasLoss ? 0 : 4),
          fill: floorColor(k),
        });
        if (hasLoss) {
          segments.push({
            key: `l${m}-${k}`,
            d: roundedTopBar(bx, lTop, barW, yTop - lTop - split, 4),
            fill: `url(#${patternId(k)})`,
          });
        }
        topPx = Math.min(topPx, lTop);
      }
    } else {
      const colW = Math.min(MAX_COLUMN, bw);
      const cx = x(m) + (bw - colW) / 2;
      const values = sim.floors.map((fl) => fl.monthlyKwh[m]);
      const loss = sim.floors.reduce((s, _, k) => s + monthlyLoss(sim, k, m), 0);
      const parts = [
        ...values.map((v, k) => ({ v, fill: floorColor(k), key: `s${m}-${k}` })),
        { v: loss, fill: `url(#${patternId('loss')})`, key: `sl${m}` },
      ].filter((p) => y0 - y(p.v) >= 0.5);
      let base = 0;
      parts.forEach((p, i) => {
        const yb = y(base);
        const yt2 = y(base + p.v);
        const gap = i > 0 && yb - yt2 >= 3 ? 2 : 0;
        segments.push({
          key: p.key,
          d: roundedTopBar(cx, yt2, colW, yb - yt2 - gap, i === parts.length - 1 ? 4 : 0),
          fill: p.fill,
        });
        base += p.v;
      });
      topPx = y(base);
    }
    monthTop.push(topPx);
  }

  const narrow = x.step < 30;
  return {
    width,
    height: plot.bottom + M.bottom,
    plot,
    x,
    y,
    legend,
    xTicks: monthLabels.map((label, m) => ({
      pos: x(m) + bw / 2,
      label: narrow ? label.slice(0, 1) : label,
    })),
    yTicks: yt.ticks.map((v) => ({ pos: y(v), label: f.num(v, stepDigits(yt.step)) })),
    segments,
    monthTop,
  };
}

function summarize(
  sim: SimulationResult,
  labels: readonly string[],
  months: readonly string[],
  f: Format,
  t: Texts,
): string {
  const unshaded = sim.floors.reduce((s, fl) => s + fl.annualUnshadedKwh, 0);
  const pct = unshaded > 0 ? (sim.totalShadingLossKwh / unshaded) * 100 : 0;
  const totals = sim.totalMonthlyKwh;
  const best = totals.indexOf(Math.max(...totals));
  const worst = totals.indexOf(Math.min(...totals));
  const floors = topDown(sim.floors.length)
    .map((k) =>
      t.summaryFloor(labels[k], f.kwh(sim.floors[k].annualKwh), f.kwh(sim.floors[k].shadingLossKwh)),
    )
    .join('; ');
  return [
    t.summary(sim.year, f.kwh(sim.totalAnnualKwh), f.kwh(sim.totalShadingLossKwh), f.pct(pct, 1)),
    t.summaryRange(months[best], f.kwh(totals[best]), months[worst], f.kwh(totals[worst])),
    sim.floors.length > 1 ? `${floors}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

interface InteractionProps {
  geom: Geometry;
  sim: SimulationResult;
  labels: readonly string[];
  months: readonly string[];
  f: Format;
  t: Texts;
  keysId: string;
}

/**
 * Hover per month (the whole band is the hit target) and a keyboard month slider with the same readout.
 * Rendered before the chart SVG: its band highlight (absolutely positioned) then sits below the bars.
 */
function MonthInteraction({ geom, sim, labels, months, f, t, keysId }: InteractionProps) {
  const c = useCommon();
  /** Slider value (month 0…11). */
  const [month, setMonth] = useState(0);
  /** Keyboard cursor and tooltip shown (keyboard focus or a key press, until Escape or blur). */
  const [keyboard, setKeyboard] = useState(false);
  const { plot } = geom;
  const pointer = usePlotPointer({ locate: (px) => geom.x.indexAt(plot.left + px) });
  const active = pointer.hover ?? (keyboard ? month : null);

  const rows = (m: number): TooltipRow[] => {
    const floors: TooltipRow[] = topDown(sim.floors.length).map((k) => {
      const loss = monthlyLoss(sim, k, m);
      return {
        key: String(k),
        value: f.kwh(sim.floors[k].monthlyKwh[m]),
        label: loss > 0.05 ? `${labels[k]} · ${t.lossOf(f.kwh(loss, 1))}` : labels[k],
        color: floorColor(k),
        mark: 'rect',
      };
    });
    if (sim.floors.length < 2) return floors;
    const loss = sim.floors.reduce((s, _, k) => s + monthlyLoss(sim, k, m), 0);
    return [
      ...floors,
      {
        key: 'total',
        value: f.kwh(sim.totalMonthlyKwh[m]),
        label: `${c.total} · ${t.lossOf(f.kwh(loss, 1))}`,
        mark: 'none',
      },
    ];
  };

  /** Spoken readout: "Juni: 2. OG 137 kWh, 1. OG 125 kWh (Verlust 12.5 kWh), Total 262 kWh (Verlust 12.5 kWh)". */
  const valueText = (m: number): string => {
    const part = (name: string, kwh: number, loss: number): string =>
      `${name} ${f.kwh(kwh)}${loss > 0.05 ? ` (${t.lossOf(f.kwh(loss, 1))})` : ''}`;
    const floors = topDown(sim.floors.length).map((k) =>
      part(labels[k], sim.floors[k].monthlyKwh[m], monthlyLoss(sim, k, m)),
    );
    const total =
      sim.floors.length > 1
        ? [
            part(
              c.total,
              sim.totalMonthlyKwh[m],
              sim.floors.reduce((s, _, k) => s + monthlyLoss(sim, k, m), 0),
            ),
          ]
        : [];
    return `${months[m]}: ${[...floors, ...total].join(', ')}`;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Escape hides the highlight and tooltip (WCAG 1.4.13); the month stays.
    if (e.key === 'Escape') {
      if (active !== null) {
        e.preventDefault();
        pointer.clear();
        setKeyboard(false);
      }
      return;
    }
    const next = stepValue(e.key, month, { step: 1, min: 0, max: 11 });
    if (next === null) return;
    e.preventDefault();
    pointer.clear();
    setMonth(next);
    setKeyboard(true);
  };

  return (
    <>
      {active !== null && (
        <svg
          className={styles.highlightLayer}
          style={{ left: plot.left, top: plot.top }}
          width={plot.right - plot.left}
          height={plot.bottom - plot.top}
          aria-hidden="true"
        >
          <rect
            className={styles.highlight}
            x={geom.x(active) - (geom.x.step - geom.x.bandwidth) / 2 - plot.left}
            y={0}
            width={geom.x.step}
            height={plot.bottom - plot.top}
          />
        </svg>
      )}
      <PlotSlider
        className={styles.overlay}
        plot={plot}
        label={t.slider}
        describedBy={keysId}
        min={1}
        max={12}
        value={month + 1}
        valueText={valueText(month)}
        onKeyDown={onKeyDown}
        // Keyboard focus shows the readout of the current month.
        onFocus={(e) => {
          if (isFocusVisible(e.currentTarget)) setKeyboard(true);
        }}
        onBlur={() => setKeyboard(false)}
        {...pointer.handlers}
      />
      {active !== null && (
        <ChartTooltip
          x={geom.x(active) + geom.x.bandwidth / 2}
          y={geom.monthTop[active]}
          boundsWidth={geom.width}
          boundsHeight={geom.height}
          title={`${months[active]} ${sim.year}`}
          rows={rows(active)}
        />
      )}
    </>
  );
}

/** Monthly yield per floor as grouped or stacked bars, the shading loss as a hatched segment. */
export function MonthlyYieldChart() {
  const t = useMessages(messages);
  const f = useFormat();
  const lang = useLang();
  const simulation = useSimulation();
  const weatherStatus = useDataStore((s) => s.weather.status);
  const locationName = useConfigSection('location').name;
  const labels = useFloorLabels();
  const source = useSourceLabel(simulation);
  const numFloors = simulation?.floors.length ?? 0;
  const [modeChoice, setModeChoice] = useState<Mode | null>(null);
  const mode: Mode = modeChoice ?? (numFloors > 3 ? 'stacked' : 'grouped');
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const uid = useSvgId('my');
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const keysId = `${uid}-keys`;
  const patternId = (k: number | 'loss'): string => hatchId(uid, k);

  const months = monthNames(lang, 'long');
  const shortMonths = monthNames(lang, 'short');

  const legendItems = useMemo<ChartLegendItem[]>(() => {
    const items: ChartLegendItem[] =
      numFloors > 1
        ? Array.from({ length: numFloors }, (_, k) => ({
            key: `f${k}`,
            label: labels[k] ?? String(k),
            swatch: 'rect',
            color: floorColor(k),
          }))
        : [];
    items.push({
      key: 'loss',
      label: t.loss,
      swatch: 'rect',
      color: 'var(--text-faint)',
      fill: `url(#${hatchId(uid, 'loss')})`,
    });
    return items;
  }, [numFloors, labels, t, uid]);

  const geom = useMemo(
    () =>
      simulation
        ? buildGeometry(width, simulation, mode, legendItems, shortMonths, (k) => hatchId(uid, k), f)
        : null,
    [width, simulation, mode, legendItems, shortMonths, uid, f],
  );
  const summary = useMemo(
    () => (simulation ? summarize(simulation, labels, months, f, t) : ''),
    [simulation, labels, months, f, t],
  );

  const busy = !simulation || weatherStatus === 'loading';
  const unshaded = simulation?.floors.reduce((s, fl) => s + fl.annualUnshadedKwh, 0) ?? 0;
  const lossPct = simulation && unshaded > 0 ? (simulation.totalShadingLossKwh / unshaded) * 100 : 0;

  const toolbar =
    numFloors > 1 ? (
      <Segmented
        label={t.mode}
        size="sm"
        value={mode}
        options={[
          { value: 'grouped', label: t.grouped },
          { value: 'stacked', label: t.stacked },
        ]}
        onChange={setModeChoice}
      />
    ) : undefined;

  return (
    <ViewCard
      title={t.title}
      subtitle={t.subtitle}
      toolbar={toolbar}
      exportKind="monthly"
      exportParts={
        simulation
          ? [locationName, simulation.year, ...clearSkyParts(simulation.source, lang)]
          : [locationName]
      }
      busy={busy}
    >
      {simulation && (
        <ChartStats
          items={[
            { key: 'year', label: t.year(simulation.year), value: f.kwh(simulation.totalAnnualKwh) },
            {
              key: 'loss',
              label: t.loss,
              value: `${f.kwh(simulation.totalShadingLossKwh)} (${f.pct(lossPct, 1)})`,
            },
          ]}
        />
      )}
      <div ref={rootRef} className={chart.root}>
        {simulation && geom ? (
          <>
            <p id={keysId} className="sr-only">
              {t.keys}
            </p>
            <MonthInteraction
              geom={geom}
              sim={simulation}
              labels={labels}
              months={months}
              f={f}
              t={t}
              keysId={keysId}
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
              <defs>
                {Array.from({ length: numFloors }, (_, k) => (
                  <HatchPattern key={k} id={patternId(k)} color={floorColor(k)} />
                ))}
                <HatchPattern id={patternId('loss')} color="var(--text-faint)" />
              </defs>
              <ChartLegend layout={geom.legend} x={geom.plot.left} y={LEGEND_TOP} />
              <AxisY
                ticks={geom.yTicks}
                x0={geom.plot.left}
                x1={geom.plot.right}
                title="kWh"
                titleY={geom.plot.top - 8}
              />
              <g aria-hidden="true">
                {geom.segments.map((s) => (
                  <path key={s.key} d={s.d} fill={s.fill} />
                ))}
              </g>
              <AxisX
                ticks={geom.xTicks}
                y={geom.plot.bottom}
                x0={geom.plot.left}
                x1={geom.plot.right}
                tickSize={0}
              />
            </svg>
          </>
        ) : (
          <div className={chart.empty}>{t.waiting}</div>
        )}
      </div>
      {source && <p className={chart.caption}>{source}</p>}
    </ViewCard>
  );
}
