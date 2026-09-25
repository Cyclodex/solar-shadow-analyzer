import { useMemo, useState, type KeyboardEvent } from 'react';
import { ViewCard } from '../components/ViewCard';
import { Segmented } from '../components/Segmented';
import { monthNames, useFormat, useLang, useMessages, type Format, type Messages } from '../i18n';
import { clearSkyParts } from '../export/filenames';
import { useAnnualInputsPending, useBattery } from '../hooks/useModel';
import { PATHS, monthPaths, type MonthPaths, type PathKey } from './lib/batteryPaths';
import { useConfigSection } from '../state/configStore';
import { AxisX, AxisY, type AxisTick } from './lib/Axes';
import { ChartStats } from './lib/ChartStats';
import { ChartTooltip, type TooltipRow } from './lib/ChartTooltip';
import { HatchPattern } from '../components/svg/HatchPattern';
import { ChartLegend } from './lib/ChartLegend';
import { LEGEND_TOP, layoutChartLegend, type ChartLegendItem, type ChartLegendLayout } from './lib/legend';
import { roundedTopBar } from '../components/svg/paths';
import { niceTicks, scaleBand, scaleLinear, stepDigits, type BandScale, type LinearScale } from './lib/scale';
import { useSourceLabel } from './lib/sourceLabel';
import { useElementWidth } from '../components/svg/useElementWidth';
import { isFocusVisible } from './lib/focus';
import { PlotSlider } from './lib/PlotSlider';
import { stepValue } from './lib/sliderKeys';
import { usePlotPointer } from './lib/usePlotPointer';
import { useSvgId } from '../components/svg/useSvgId';
import chart from './lib/chart.module.css';
import styles from './MonthlyYieldChart.module.css';

const COLORS: Record<PathKey, string> = {
  selfDirect: 'var(--flow-direct)',
  selfBattery: 'var(--flow-battery)',
  exported: 'var(--flow-export)',
  curtailed: 'var(--text-faint)',
  losses: 'var(--bad)',
};
const HATCHED: ReadonlySet<PathKey> = new Set(['curtailed', 'losses']);
const batteryHatchId = (uid: string, k: PathKey): string => `${uid}-hatch-${k}`;

type Mode = 'with' | 'without';

const de = {
  title: 'Energiefluss mit Batterie',
  subtitle: 'Wohin der Solarstrom je Monat geht; Linie: Verbrauch des Haushalts',
  mode: 'Vergleich',
  with: 'Mit Batterie',
  without: 'Ohne Batterie',
  selfDirect: 'Direkt verbraucht',
  selfBattery: 'Über Batterie verbraucht',
  exported: 'Eingespeist',
  curtailed: 'Abgeregelt / verloren',
  losses: 'Speicherverluste',
  load: 'Verbrauch',
  extra: 'Mehrertrag',
  autarky: 'Autarkie',
  slider: 'Monat im Diagramm',
  keys: 'Pfeiltasten: Monat wechseln.',
  summary: (year: number, self: string, exported: string, curtailed: string, load: string) =>
    `Energiefluss ${year}: selbst verbraucht ${self}, eingespeist ${exported}, abgeregelt ${curtailed}, Verbrauch ${load}.`,
  waiting: 'Die Batterie wird berechnet …',
};
type Texts = typeof de;
const messages: Messages<Texts> = {
  de,
  en: {
    title: 'Energy flow with battery',
    subtitle: 'Where the solar power goes each month; line: household consumption',
    mode: 'Comparison',
    with: 'With battery',
    without: 'Without battery',
    selfDirect: 'Used directly',
    selfBattery: 'Used via battery',
    exported: 'Fed in',
    curtailed: 'Curtailed / lost',
    losses: 'Storage losses',
    load: 'Consumption',
    extra: 'Extra yield',
    autarky: 'Self-sufficiency',
    slider: 'Month in the chart',
    keys: 'Arrow keys: change month.',
    summary: (year, self, exported, curtailed, load) =>
      `Energy flow ${year}: self-consumed ${self}, fed in ${exported}, curtailed ${curtailed}, consumption ${load}.`,
    waiting: 'Computing the battery …',
  },
};

const M = { left: 48, right: 12, title: 18, bottom: 28 };
const MAX_COLUMN = 28;
const HATCH = { wash: 0.22, angle: 135 } as const;

interface Geometry {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  x: BandScale;
  y: LinearScale;
  legend: ChartLegendLayout;
  xTicks: AxisTick[];
  yTicks: AxisTick[];
  segments: { key: string; d: string; fill: string }[];
  loadPath: string;
  monthTop: number[];
}

function buildGeometry(
  width: number,
  months: readonly MonthPaths[],
  legendItems: readonly ChartLegendItem[],
  monthLabels: readonly string[],
  fillOf: (k: PathKey) => string,
  f: Format,
): Geometry {
  const legend = layoutChartLegend(legendItems, width - M.left);
  const plotH = width < 420 ? 180 : width < 640 ? 200 : 220;
  const top = LEGEND_TOP + (legend.height > 0 ? legend.height + 6 : 0) + M.title;
  const plot = { left: M.left, right: width - M.right, top, bottom: top + plotH };
  const x = scaleBand(12, [plot.left, plot.right], 0.22);
  const totals = months.map((m) => PATHS.reduce((s, k) => s + m[k], 0));
  const yt = niceTicks(0, Math.max(1, ...totals, ...months.map((m) => m.load)), 4);
  const y = scaleLinear([0, yt.max], [plot.bottom, plot.top]);
  const segments: Geometry['segments'] = [];
  const monthTop: number[] = [];
  const colW = Math.min(MAX_COLUMN, x.bandwidth);
  const loadPoints: string[] = [];
  months.forEach((mp, m) => {
    const cx = x(m) + (x.bandwidth - colW) / 2;
    const parts = PATHS.filter((k) => y(0) - y(mp[k]) >= 0.5);
    let base = 0;
    parts.forEach((k, i) => {
      const yb = y(base);
      const yt2 = y(base + mp[k]);
      const gap = i > 0 && yb - yt2 >= 3 ? 2 : 0;
      segments.push({
        key: `${m}-${k}`,
        d: roundedTopBar(cx, yt2, colW, yb - yt2 - gap, i === parts.length - 1 ? 4 : 0),
        fill: fillOf(k),
      });
      base += mp[k];
    });
    monthTop.push(Math.min(y(base), y(mp.load)));
    // Consumption as a step per month band.
    const yl = y(mp.load).toFixed(1);
    loadPoints.push(`${m === 0 ? 'M' : 'L'}${(x(m) - (x.step - x.bandwidth) / 2).toFixed(1)},${yl}`);
    loadPoints.push(`L${(x(m) + x.bandwidth + (x.step - x.bandwidth) / 2).toFixed(1)},${yl}`);
  });
  const narrow = x.step < 30;
  return {
    width,
    height: plot.bottom + M.bottom,
    plot,
    x,
    y,
    legend,
    xTicks: monthLabels.map((label, m) => ({
      pos: x(m) + x.bandwidth / 2,
      label: narrow ? label.slice(0, 1) : label,
    })),
    yTicks: yt.ticks.map((v) => ({ pos: y(v), label: f.num(v, stepDigits(yt.step)) })),
    segments,
    loadPath: loadPoints.join(''),
    monthTop,
  };
}

interface InteractionProps {
  geom: Geometry;
  months: readonly MonthPaths[];
  names: readonly string[];
  year: number;
  f: Format;
  t: Texts;
  keysId: string;
}

/** Hover per month and a keyboard month slider with the same readout (as in the monthly yield chart). */
function MonthInteraction({ geom, months, names, year, f, t, keysId }: InteractionProps) {
  const [month, setMonth] = useState(0);
  const [keyboard, setKeyboard] = useState(false);
  const { plot } = geom;
  const pointer = usePlotPointer({ locate: (px) => geom.x.indexAt(plot.left + px) });
  const active = pointer.hover ?? (keyboard ? month : null);

  const rows = (m: number): TooltipRow[] => [
    ...[...PATHS].reverse().map((k) => ({
      key: k,
      value: f.kwh(months[m][k], 1),
      label: t[k],
      color: COLORS[k],
      mark: HATCHED.has(k) ? ('hatch' as const) : ('rect' as const),
    })),
    { key: 'load', value: f.kwh(months[m].load, 1), label: t.load, color: 'var(--text)', mark: 'line' },
  ];
  const valueText = (m: number): string =>
    `${names[m]}: ${rows(m)
      .map((r) => `${r.label} ${r.value}`)
      .join(', ')}`;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
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
          title={`${names[active]} ${year}`}
          rows={rows(active)}
        />
      )}
    </>
  );
}

/** Monthly energy paths of the storage simulation (stacked), with the household load as a step line. */
export function BatteryMonthlyChart() {
  const t = useMessages(messages);
  const f = useFormat();
  const lang = useLang();
  const result = useBattery();
  const pending = useAnnualInputsPending();
  const locationName = useConfigSection('location').name;
  const source = useSourceLabel(result);
  const [mode, setMode] = useState<Mode>('with');
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const uid = useSvgId('bm');
  const hatchId = (k: PathKey): string => batteryHatchId(uid, k);
  const names = monthNames(lang, 'long');
  const short = monthNames(lang, 'short');

  const months = useMemo(() => (result ? monthPaths(result, mode) : null), [result, mode]);
  const legendItems = useMemo<ChartLegendItem[]>(
    () => [
      ...PATHS.filter((k) => mode === 'with' || (k !== 'selfBattery' && k !== 'losses')).map((k) => ({
        key: k,
        label: t[k],
        swatch: 'rect' as const,
        color: COLORS[k],
        fill: HATCHED.has(k) ? `url(#${batteryHatchId(uid, k)})` : undefined,
      })),
      { key: 'load', label: t.load, swatch: 'line' as const, color: 'var(--text)' },
    ],
    [t, mode, uid],
  );
  const geom = useMemo(
    () =>
      months
        ? buildGeometry(
            width,
            months,
            legendItems,
            short,
            (k) => (HATCHED.has(k) ? `url(#${batteryHatchId(uid, k)})` : COLORS[k]),
            f,
          )
        : null,
    [width, months, legendItems, short, uid, f],
  );

  const summary = useMemo(() => {
    if (!months || !result) return '';
    const total = (k: keyof MonthPaths): number => months.reduce((s, m) => s + m[k], 0);
    return t.summary(
      result.year,
      f.kwh(total('selfDirect') + total('selfBattery')),
      f.kwh(total('exported')),
      f.kwh(total('curtailed')),
      f.kwh(total('load')),
    );
  }, [months, result, t, f]);

  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const keysId = `${uid}-keys`;

  return (
    <ViewCard
      title={t.title}
      subtitle={t.subtitle}
      toolbar={
        <Segmented
          label={t.mode}
          size="sm"
          value={mode}
          options={[
            { value: 'with', label: t.with },
            { value: 'without', label: t.without },
          ]}
          onChange={setMode}
        />
      }
      exportKind="batteryMonthly"
      exportParts={
        result ? [locationName, result.year, ...clearSkyParts(result.source, lang)] : [locationName]
      }
      busy={!result || pending}
    >
      {result && (
        <ChartStats
          items={[
            { key: 'extra', label: t.extra, value: `+${f.kwh(result.extraOutputKwh)}` },
            {
              key: 'autarky',
              label: t.autarky,
              value: `${f.pct(mode === 'with' ? result.autarkyPct : result.baselineAutarkyPct)}`,
            },
          ]}
        />
      )}
      <div ref={rootRef} className={chart.root}>
        {result && months && geom ? (
          <>
            <p id={keysId} className="sr-only">
              {t.keys}
            </p>
            <MonthInteraction
              geom={geom}
              months={months}
              names={names}
              year={result.year}
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
                {PATHS.filter((k) => HATCHED.has(k)).map((k) => (
                  <HatchPattern key={k} id={hatchId(k)} color={COLORS[k]} {...HATCH} />
                ))}
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
                <path d={geom.loadPath} fill="none" stroke="var(--text)" strokeWidth={2} />
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
