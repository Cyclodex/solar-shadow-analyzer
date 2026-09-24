import { useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Skeleton } from '../components/Skeleton';
import { ViewCard } from '../components/ViewCard';
import { cssVars } from '../components/cssVars';
import { floorLabel, useFormat, useLang, useMessages, type Format, type Messages } from '../i18n';
import { useCommon, type CommonMessages } from '../i18n/common';
import { useAnnualInputsPending, useEconomics, useSimulation } from '../hooks/useModel';
import { economics } from '../model/economics';
import type { EconomicsConfig, EconomicsResult } from '../model/types';
import { EXPORT_IGNORE } from '../export/png';
import { useConfigSection } from '../state/configStore';
import { isFocusVisible } from './lib/focus';
import { linePath } from './lib/paths';
import { stepValue } from './lib/sliderKeys';
import { useElementWidth } from './lib/useElementWidth';
import { useSvgId } from './lib/useSvgId';
import styles from './EconomicsCard.module.css';

const de = {
  title: 'Wirtschaftlichkeit',
  subtitle: (n: number) => `Ersparnis, Amortisation und Bilanz über ${n} ${n === 1 ? 'Jahr' : 'Jahre'}`,
  exportName: 'wirtschaftlichkeit',
  savings: 'Ersparnis pro Jahr',
  savingsSub: (kwh: string) => `im 1. Jahr, aus ${kwh}`,
  payback: 'Amortisationsdauer',
  paybackSub: (investment: string) => `Investition ${investment}`,
  paybackBeyond: (n: number) => `länger als die Betrachtungsdauer (${n} ${n === 1 ? 'Jahr' : 'Jahre'})`,
  net: (n: number) => `Bilanz nach ${n} ${n === 1 ? 'Jahr' : 'Jahren'}`,
  netSub: 'Ersparnis abzüglich Investition',
  chartTitle: 'Kumulierte Bilanz',
  chartLabel: (n: number) =>
    `Kumulierte Bilanz über ${n} ${n === 1 ? 'Jahr' : 'Jahre'}, Jahr wählen mit den Pfeiltasten`,
  yearValue: (year: string, value: string) => `Jahr ${year}: ${value}`,
  yearsAxis: 'Jahre',
  breakEven: (years: string) => `Amortisation nach ${years} Jahren`,
  tableCaption: 'Wirtschaftlichkeit je Stockwerk',
  floor: 'Stockwerk',
  savingsCol: 'Ersparnis pro Jahr',
  paybackCol: 'Amortisation',
  yearsUnit: 'Jahre',
  assumptions: (list: string, basis: string) =>
    `Annahmen – Beispielwerte, anpassbar unter Einstellungen › Wirtschaftlichkeit: ${list}. ` +
    `Konstante Preise, ohne Diskontierung und ohne laufende Kosten. Ertrag im 1. Jahr: ${basis}.`,
  price: 'Strompreis',
  feedIn: 'Einspeisevergütung',
  selfConsumption: 'Eigenverbrauch',
  investment: 'Investition je Stockwerk',
  degradation: 'Degradation',
  perYear: '%/Jahr',
  basisWeather: (year: number) => `simulierter Jahresertrag mit Open-Meteo-Wetter ${year}`,
  basisClearSky: (hint: string) => `simulierter Jahresertrag (${hint})`,
  loading: 'Wirtschaftlichkeit wird berechnet …',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Economics',
    subtitle: (n) => `Savings, payback and balance over ${n} ${n === 1 ? 'year' : 'years'}`,
    exportName: 'economics',
    savings: 'Savings per year',
    savingsSub: (kwh) => `in year 1, from ${kwh}`,
    payback: 'Payback period',
    paybackSub: (investment) => `investment ${investment}`,
    paybackBeyond: (n) => `longer than the evaluation period (${n} ${n === 1 ? 'year' : 'years'})`,
    net: (n) => `Balance after ${n} ${n === 1 ? 'year' : 'years'}`,
    netSub: 'savings minus investment',
    chartTitle: 'Cumulative balance',
    chartLabel: (n) =>
      `Cumulative balance over ${n} ${n === 1 ? 'year' : 'years'}, choose a year with the arrow keys`,
    yearValue: (year, value) => `Year ${year}: ${value}`,
    yearsAxis: 'years',
    breakEven: (years) => `Payback after ${years} years`,
    tableCaption: 'Economics per floor',
    floor: 'Floor',
    savingsCol: 'Savings per year',
    paybackCol: 'Payback',
    yearsUnit: 'years',
    assumptions: (list, basis) =>
      `Assumptions – example values, adjustable under Settings › Economics: ${list}. ` +
      `Constant prices, no discounting and no running costs. Yield in year 1: ${basis}.`,
    price: 'electricity price',
    feedIn: 'feed-in tariff',
    selfConsumption: 'self-consumption',
    investment: 'investment per floor',
    degradation: 'degradation',
    perYear: '%/year',
    basisWeather: (year) => `simulated annual yield with Open-Meteo weather ${year}`,
    basisClearSky: (hint) => `simulated annual yield (${hint.charAt(0).toLowerCase()}${hint.slice(1)})`,
    loading: 'Computing economics …',
  },
};

type T = typeof de;

/** Payback as text: "7.9 Jahre", "nie" (never), 0 without investment. */
function paybackText(years: number, f: Format, c: CommonMessages): string {
  return Number.isFinite(years) ? c.years(f.num(years, 1)) : c.never;
}

// ── Chart helpers ────────────────────────────

/** 1, 2, 2.5, 5 × 10^k step for about `count` intervals over `span`. */
function niceStep(span: number, count: number): number {
  const raw = span / count;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const m = raw / exp;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * exp;
}

/** Value domain (all values and 0, padded) and round tick values inside it. */
function yScale(values: readonly number[]): { domain: [number, number]; ticks: number[] } {
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.06;
  const domain: [number, number] = [lo - pad, hi + pad];
  const step = niceStep(hi - lo, 4);
  const ticks: number[] = [];
  for (let v = Math.ceil(domain[0] / step) * step; v <= domain[1]; v += step) {
    ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
  }
  return { domain, ticks };
}

function xStep(years: number, plotWidth: number): number {
  if (years <= 5) return 1;
  if (years <= 10) return 2;
  return years > 20 && plotWidth < 260 ? 10 : 5;
}

// ── Cash-flow chart ──────────────────────────

interface CashFlowChartProps {
  /** Cumulative balance at the end of year 0 … lifetime (index = year), from the model. */
  values: readonly number[];
  paybackYears: number;
  currency: string;
  t: T;
}

/**
 * Cumulative balance (savings − investment) per year as a line with profit/loss wash, zero line,
 * break-even marker and end value. Keyboard/pointer: a year cursor (role="slider") reads out each year.
 * Savings accrue evenly within a year in the model, so the straight segments between years are exact.
 */
function CashFlowChart({ values, paybackYears, currency, t }: CashFlowChartProps) {
  const f = useFormat();
  const [wrapRef, width] = useElementWidth<HTMLDivElement>({ fallback: 560 });
  const [active, setActive] = useState<number | null>(null);
  const uid = useSvgId('ec');
  const years = values.length - 1;

  const height = width < 420 ? 210 : 250;
  const { domain, ticks } = yScale(values);
  const tickText = ticks.map((v) => f.num(v));
  const m = {
    top: 30,
    right: 14,
    bottom: 28,
    left: 14 + Math.max(...tickText.map((s) => s.length)) * 7,
  };
  const plotW = Math.max(40, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const [d0, d1] = domain;
  const x = (year: number): number => m.left + (years > 0 ? (year / years) * plotW : 0);
  const y = (v: number): number => m.top + (1 - (v - d0) / (d1 - d0)) * plotH;
  const y0 = y(0);

  const points = values.map((v, i) => [x(i), y(v)] as const);
  const line = linePath(points);
  const area = linePath([...points, [x(years), y0], [x(0), y0]], true);
  // Year ticks; the last one carries the unit ("25 Jahre"), ticks too close to it are dropped.
  const step = xStep(years, plotW);
  const xTicks = Array.from({ length: Math.floor(years / step) + 1 }, (_, i) => i * step).filter(
    (yr) => yr === 0 || x(years) - x(yr) >= 64,
  );
  xTicks.push(years);

  const showBreakEven = paybackYears > 0 && paybackYears <= years;
  const bx = x(paybackYears);
  const breakEvenAnchor =
    bx < m.left + plotW * 0.25 ? 'start' : bx > m.left + plotW * 0.75 ? 'end' : 'middle';
  const net = values[years];
  const shown = active ?? years;
  const readout = t.yearValue(f.int(shown), f.currency(values[shown], currency, 0));

  const yearAt = (clientX: number, svg: SVGSVGElement): number => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / (r.width || width)) * width;
    return Math.min(years, Math.max(0, Math.round(((px - m.left) / plotW) * years)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const next = stepValue(e.key, active ?? years, { step: 1, page: 5, min: 0, max: years });
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  return (
    <div className={styles.chart}>
      <div className={styles.chartHead}>
        <span className={styles.chartTitle}>{t.chartTitle}</span>
        <span className={styles.readout} aria-hidden="true">
          {readout}
        </span>
      </div>
      <div
        ref={wrapRef}
        className={styles.plot}
        role="slider"
        tabIndex={0}
        aria-label={t.chartLabel(years)}
        aria-valuemin={0}
        aria-valuemax={years}
        aria-valuenow={shown}
        aria-valuetext={readout}
        onKeyDown={onKeyDown}
        // Keyboard focus shows the year cursor (at the last year, whose balance the readout shows).
        onFocus={(e) => {
          if (isFocusVisible(e.currentTarget)) setActive((a) => a ?? years);
        }}
        onBlur={() => setActive(null)}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className={styles.svg}
          aria-hidden="true"
          onPointerMove={(e: PointerEvent<SVGSVGElement>) => setActive(yearAt(e.clientX, e.currentTarget))}
          onPointerLeave={() => setActive(null)}
        >
          <defs>
            <clipPath id={`${uid}-gain`}>
              <rect x={m.left} y={m.top} width={plotW} height={Math.max(0, y0 - m.top)} />
            </clipPath>
            <clipPath id={`${uid}-loss`}>
              <rect x={m.left} y={y0} width={plotW} height={Math.max(0, m.top + plotH - y0)} />
            </clipPath>
          </defs>

          {ticks.map((v, i) => (
            <g key={v}>
              {v !== 0 && (
                <line className={styles.grid} x1={m.left} x2={m.left + plotW} y1={y(v)} y2={y(v)} />
              )}
              <text
                className={styles.tick}
                x={m.left - 6}
                y={y(v)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {tickText[i]}
              </text>
            </g>
          ))}
          <text className={styles.unit} x={m.left - 6} y={m.top - 16} textAnchor="end">
            {currency}
          </text>
          {xTicks.map((yr) => (
            <text
              key={yr}
              className={styles.tick}
              x={x(yr)}
              y={m.top + plotH + 18}
              textAnchor={yr === years && yr > 0 ? 'end' : yr === 0 ? 'start' : 'middle'}
            >
              {yr === years && yr > 0 ? `${f.int(yr)} ${t.yearsAxis}` : f.int(yr)}
            </text>
          ))}

          <path className={styles.gain} d={area} clipPath={`url(#${uid}-gain)`} />
          <path className={styles.loss} d={area} clipPath={`url(#${uid}-loss)`} />
          <line className={styles.zero} x1={m.left} x2={m.left + plotW} y1={y0} y2={y0} />
          <path className={styles.line} d={line} />

          {showBreakEven && (
            <g>
              <line className={styles.guide} x1={bx} x2={bx} y1={m.top - 4} y2={m.top + plotH} />
              <text className={styles.label} x={bx} y={m.top - 10} textAnchor={breakEvenAnchor}>
                {t.breakEven(f.num(paybackYears, 1))}
              </text>
              <circle className={styles.breakEven} cx={bx} cy={y0} r={5} />
            </g>
          )}

          <circle className={styles.end} cx={x(years)} cy={y(net)} r={4} />

          {active !== null && (
            <g {...EXPORT_IGNORE}>
              <line className={styles.cursor} x1={x(active)} x2={x(active)} y1={m.top} y2={m.top + plotH} />
              <circle className={styles.cursorDot} cx={x(active)} cy={y(values[active])} r={5} />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

// ── Figures & table ──────────────────────────

function Figure({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className={styles.figure}>
      <dt className={styles.figureLabel}>{label}</dt>
      <dd className={styles.figureValue}>{value}</dd>
      {sub && <dd className={styles.figureSub}>{sub}</dd>}
    </div>
  );
}

interface FloorRow {
  floor: number;
  storey: number;
  annualKwh: number;
  result: EconomicsResult;
}

function FloorTable({
  rows,
  total,
  e,
  t,
}: {
  rows: FloorRow[];
  total: EconomicsResult;
  e: EconomicsConfig;
  t: T;
}) {
  const f = useFormat();
  const c = useCommon();
  const lang = useLang();
  const payback = (years: number): string => (Number.isFinite(years) ? f.num(years, 1) : c.never);
  const head = (label: string, unit: string): ReactNode => (
    <>
      {label} <span className={styles.colUnit}>{unit}</span>
    </>
  );
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="sr-only">{t.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.floor}</th>
            <th scope="col">{head(t.savingsCol, e.currency)}</th>
            <th scope="col">{head(t.paybackCol, t.yearsUnit)}</th>
            <th scope="col">{head(t.net(e.lifetimeYears), e.currency)}</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr key={r.floor}>
              <th scope="row">
                <span className={styles.floorName}>
                  <span
                    className={styles.swatch}
                    style={cssVars({ '--c': `var(--floor-${r.floor % 8})` })}
                    aria-hidden="true"
                  />
                  {floorLabel(r.storey, lang)}
                </span>
                <span className={styles.floorKwh}>{f.kwh(r.annualKwh)}</span>
              </th>
              <td>{f.num(r.result.annualSavings)}</td>
              <td>{payback(r.result.paybackYears)}</td>
              <td>{f.num(r.result.lifetimeNet)}</td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr>
              <th scope="row">
                <span className={styles.floorName}>{c.total}</span>
                <span className={styles.floorKwh}>{f.kwh(total.annualKwh)}</span>
              </th>
              <td>{f.num(total.annualSavings)}</td>
              <td>{payback(total.paybackYears)}</td>
              <td>{f.num(total.lifetimeNet)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ── Card ─────────────────────────────────────

/**
 * Savings, payback and lifetime balance per floor and in total (model/economics for the simulated
 * annual yield), cumulative balance chart with break-even marker, and the assumptions behind it.
 */
export function EconomicsCard() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const e = useConfigSection('economics');
  const simulation = useSimulation();
  const total = useEconomics();
  const pending = useAnnualInputsPending();

  const rows = useMemo<FloorRow[]>(
    () =>
      simulation?.floors.map((fl) => ({
        floor: fl.floor,
        storey: fl.storey,
        annualKwh: fl.annualKwh,
        result: economics(fl.annualKwh, 1, e),
      })) ?? [],
    [simulation, e],
  );

  // Cumulative balance after 0 … lifetime years: the model's lifetimeNet for each horizon. The investment
  // follows the simulated floors (same snapshot as the yield, as in useEconomics), not the live config.
  const cashFlow = useMemo(() => {
    if (!simulation) return null;
    const kwh = simulation.totalAnnualKwh;
    const floors = simulation.floors.length;
    return Array.from(
      { length: e.lifetimeYears + 1 },
      (_, n) => economics(kwh, floors, { ...e, lifetimeYears: n }).lifetimeNet,
    );
  }, [simulation, e]);

  const ready = simulation !== null && total !== null && cashFlow !== null;
  const money = (v: number): string => f.currency(v, e.currency, 0);
  const tariff = (v: number): string => {
    const digits = Math.abs(v * 100 - Math.round(v * 100)) > 1e-9 ? 4 : 2;
    return `${f.currency(v, e.currency, digits)}/kWh`;
  };

  const assumptionList = [
    `${t.price} ${tariff(e.electricityPrice)}`,
    `${t.feedIn} ${tariff(e.feedInTariff)}`,
    `${t.selfConsumption} ${f.pct(e.selfConsumptionPct)}`,
    `${t.investment} ${money(e.investmentPerFloor)}`,
    `${t.degradation} ${f.unit(e.degradationPct, t.perYear, 1)}`,
  ].join(', ');
  const basis =
    simulation?.source === 'open-meteo' ? t.basisWeather(simulation.year) : t.basisClearSky(c.clearSkyHint);
  const skeleton = <Skeleton width="8ch" height="1.2em" />;
  const beyond = ready && Number.isFinite(total.paybackYears) && total.paybackYears > e.lifetimeYears;

  return (
    <ViewCard
      title={t.title}
      subtitle={t.subtitle(e.lifetimeYears)}
      exportName={t.exportName}
      minHeight={200}
      busy={!ready || pending}
      footer={<p>{t.assumptions(assumptionList, simulation ? basis : c.loading)}</p>}
    >
      <div className={styles.layout}>
        {!ready && <span className="sr-only">{t.loading}</span>}
        <dl className={styles.figures}>
          <Figure
            label={t.savings}
            value={ready ? money(total.annualSavings) : skeleton}
            sub={ready ? t.savingsSub(f.kwh(total.annualKwh)) : null}
          />
          <Figure
            label={t.payback}
            value={ready ? paybackText(total.paybackYears, f, c) : skeleton}
            sub={
              ready
                ? beyond
                  ? t.paybackBeyond(e.lifetimeYears)
                  : t.paybackSub(money(total.investment))
                : null
            }
          />
          <Figure
            label={t.net(e.lifetimeYears)}
            value={ready ? money(total.lifetimeNet) : skeleton}
            sub={ready ? t.netSub : null}
          />
        </dl>
        {ready && (
          <div className={styles.details}>
            <CashFlowChart values={cashFlow} paybackYears={total.paybackYears} currency={e.currency} t={t} />
            <FloorTable rows={rows} total={total} e={e} t={t} />
          </div>
        )}
      </div>
    </ViewCard>
  );
}
