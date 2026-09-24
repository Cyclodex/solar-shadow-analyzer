import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { linePath } from '../../components/svg/paths';
import { useFloorPlacements, useFocusFloor, useTerrainProfile } from '../../hooks/useModel';
import { compassPoint, floorLabel, useFormat, useLang, useMessages, type Messages } from '../../i18n';
import { horizonAt, horizonFromPoints, obstacleHorizon } from '../../model/horizon';
import type { HorizonProfile } from '../../model/types';
import { angleDiff, clamp, normalizeDeg } from '../../model/units';
import { useConfigSection } from '../../state/configStore';
import styles from './HorizonSparkline.module.css';

// Geometry of the plot (viewBox units ≈ CSS px at the sidebar width).
const W = 300;
const H = 132;
const PAD_L = 28;
const PAD_R = 14;
const PAD_T = 8;
const PAD_B = 22;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
/** Half of the plotted azimuth range around the facade normal (the sun can only reach the panels there). */
const HALF_RANGE = 90;
const Y_STEPS = [10, 15, 20, 30, 45, 60, 90] as const;
/** Relative azimuths −90…90 in 1° steps. */
const RELS = Array.from({ length: 2 * HALF_RANGE + 1 }, (_, i) => i - HALF_RANGE);

type SeriesKey = 'terrain' | 'obstacles' | 'manual';

interface Series {
  key: SeriesKey;
  label: string;
  values: number[];
}

const de = {
  title: 'Horizont vor der Fassade',
  subtitle: (from: string, to: string, floor: string) =>
    `Blick von ${from} bis ${to}, Hindernisse vom ${floor} aus`,
  terrain: 'Gelände',
  obstacles: 'Hindernisse',
  manual: 'Eigene Punkte',
  effective: 'Wirksamer Horizont',
  summary: (parts: string) => `Höchste Werte: ${parts}.`,
  maxima: 'Höchstwerte im Bereich',
  at: (az: string) => `Bei ${az}`,
  peak: (label: string, el: string, az: string) => `${label} ${el} bei ${az}`,
  help: 'Mit den Pfeiltasten den Azimut wählen.',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Horizon in front of the facade',
    subtitle: (from, to, floor) => `View from ${from} to ${to}, obstacles seen from ${floor}`,
    terrain: 'Terrain',
    obstacles: 'Obstacles',
    manual: 'Custom points',
    effective: 'Effective horizon',
    summary: (parts) => `Highest values: ${parts}.`,
    maxima: 'Maxima in the range',
    at: (az) => `At ${az}`,
    peak: (label, el, az) => `${label} ${el} at ${az}`,
    help: 'Use the arrow keys to choose the azimuth.',
  },
};

const x = (rel: number): number => PAD_L + ((rel + HALF_RANGE) / (2 * HALF_RANGE)) * PLOT_W;

function sample(profile: HorizonProfile, facade: number): number[] {
  return RELS.map((r) => Math.max(0, horizonAt(profile, facade + r)));
}

/** Plot points of per-azimuth values (index i ↔ RELS[i]). */
function points(values: readonly number[], y: (el: number) => number): [number, number][] {
  return values.map((v, i) => [x(RELS[i]), y(v)]);
}

/**
 * Small chart of the horizon in front of the facade (facade normal ± 90°): terrain, custom points and the
 * obstacles seen from the analysed floor as 2 px lines, their maximum (what the model uses) as a wash.
 * Hover or focus + arrow keys show the values at one azimuth.
 */
export function HorizonSparkline() {
  const t = useMessages(messages);
  const f = useFormat();
  const lang = useLang();
  const id = useId();
  const horizon = useConfigSection('horizon');
  const facade = useConfigSection('building').facadeAzimuth;
  const terrain = useTerrainProfile();
  const placements = useFloorPlacements();
  const focus = useFocusFloor();
  const placement = placements[focus];
  /** Relative azimuth under the crosshair (−90…90), null = none. */
  const [cursor, setCursor] = useState<number | null>(null);
  /** Keyboard focus on the plot: only then the readout is announced. */
  const [focused, setFocused] = useState(false);

  const series = useMemo<Series[]>(() => {
    const out: Series[] = [];
    if (terrain) out.push({ key: 'terrain', label: t.terrain, values: sample(terrain, facade) });
    if (horizon.obstacles.length > 0 && placement) {
      const profile = obstacleHorizon(horizon.obstacles, placement.center, facade, 0.5);
      out.push({ key: 'obstacles', label: t.obstacles, values: sample(profile, facade) });
    }
    if (horizon.manual.length > 0) {
      out.push({
        key: 'manual',
        label: t.manual,
        values: sample(horizonFromPoints(horizon.manual, 0.5), facade),
      });
    }
    return out;
  }, [terrain, horizon, placement, facade, t]);

  if (series.length === 0) return null;

  const effective = RELS.map((_, i) => Math.max(...series.map((s) => s.values[i])));
  const top = Math.max(...effective);
  const yMax = Y_STEPS.find((s) => s >= top * 1.1) ?? 90;
  const y = (el: number): number => PAD_T + (1 - clamp(el, 0, yMax) / yMax) * PLOT_H;
  const azOf = (rel: number): number => normalizeDeg(facade + rel);
  const azText = (rel: number): string => `${f.deg(azOf(rel))} ${compassPoint(azOf(rel), lang)}`;

  // Compass ticks every 45° inside the range, away from the edges and from the facade label.
  const ticks: number[] = [];
  for (let a = 0; a < 360; a += 45) {
    const rel = angleDiff(a, facade);
    if (Math.abs(rel) <= HALF_RANGE - 8 && Math.abs(rel) >= 14) ticks.push(rel);
  }

  const peaks = series.map((s) => {
    let best = 0;
    s.values.forEach((v, i) => {
      if (v > s.values[best]) best = i;
    });
    return t.peak(s.label, f.deg(s.values[best], 1), azText(RELS[best]));
  });
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const cursorIndex = cursor === null ? null : cursor + HALF_RANGE;

  const fromPointer = (e: PointerEvent<SVGSVGElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    const vx = ((e.clientX - r.left) / r.width) * W;
    const rel = Math.round(((vx - PAD_L) / PLOT_W) * 2 * HALF_RANGE - HALF_RANGE);
    setCursor(clamp(rel, -HALF_RANGE, HALF_RANGE));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 10 : 1;
    const cur = cursor ?? 0;
    let next: number | null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - step;
    else if (e.key === 'Home') next = -HALF_RANGE;
    else if (e.key === 'End') next = HALF_RANGE;
    else if (e.key === 'Escape') next = null;
    else return;
    e.preventDefault();
    setCursor(next === null ? null : clamp(next, -HALF_RANGE, HALF_RANGE));
  };

  const readoutText =
    cursorIndex === null
      ? null
      : [
          azText(cursor ?? 0),
          ...series.map((s) => `${s.label} ${f.deg(s.values[cursorIndex], 1)}`),
          `${t.effective} ${f.deg(effective[cursorIndex], 1)}`,
        ].join(', ');
  /** Legend values: at the crosshair, otherwise each series' maximum in the plotted range. */
  const valueOf = (values: readonly number[]): string =>
    f.deg(cursorIndex === null ? Math.max(...values) : values[cursorIndex], 1);

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        <span id={titleId} className={styles.title}>
          {t.title}
        </span>
        <span className={styles.subtitle}>
          {t.subtitle(
            azText(-HALF_RANGE),
            azText(HALF_RANGE),
            placement ? floorLabel(placement.storey, lang) : '–',
          )}
        </span>
      </figcaption>
      <div
        className={styles.plot}
        tabIndex={0}
        role="group"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true);
          setCursor((c) => c ?? 0);
        }}
        onBlur={() => {
          setFocused(false);
          setCursor(null);
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={styles.svg}
          aria-hidden="true"
          focusable="false"
          onPointerMove={fromPointer}
          onPointerDown={fromPointer}
          onPointerLeave={() => {
            if (!focused) setCursor(null);
          }}
        >
          <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} className={styles.bg} />
          {[yMax / 2, yMax].map((v) => (
            <g key={v}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className={styles.grid} />
              <text
                x={PAD_L - 4}
                y={y(v)}
                className={styles.yLabel}
                textAnchor="end"
                dominantBaseline="central"
              >
                {f.deg(v)}
              </text>
            </g>
          ))}
          <path
            d={linePath([...points(effective, y), [x(HALF_RANGE), y(0)], [x(-HALF_RANGE), y(0)]], true)}
            className={styles.effective}
          />
          <line x1={x(0)} x2={x(0)} y1={PAD_T} y2={y(0)} className={styles.facade} />
          {series.map((s) => (
            <path
              key={s.key}
              d={linePath(points(s.values, y))}
              className={`${styles.line} ${styles[s.key]}`}
            />
          ))}
          <line x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} className={styles.axis} />
          <text x={PAD_L - 4} y={y(0)} className={styles.yLabel} textAnchor="end" dominantBaseline="central">
            {f.deg(0)}
          </text>
          {ticks.map((rel) => (
            <g key={rel}>
              <line x1={x(rel)} x2={x(rel)} y1={y(0)} y2={y(0) + 3} className={styles.axis} />
              <text x={x(rel)} y={H - 6} className={styles.xLabel} textAnchor="middle">
                {compassPoint(azOf(rel), lang)}
              </text>
            </g>
          ))}
          <text x={x(0)} y={H - 6} className={styles.xFacade} textAnchor="middle">
            {f.deg(facade)}
          </text>
          {cursorIndex !== null && cursor !== null && (
            <g>
              <line x1={x(cursor)} x2={x(cursor)} y1={PAD_T} y2={y(0)} className={styles.crosshair} />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={x(cursor)}
                  cy={y(s.values[cursorIndex])}
                  r={4}
                  className={`${styles.dot} ${styles[s.key]}`}
                />
              ))}
            </g>
          )}
        </svg>
      </div>
      <p id={descId} className="sr-only">
        {t.summary(peaks.join('; '))} {t.help}
      </p>
      <p className="sr-only" aria-live="polite">
        {focused ? readoutText : null}
      </p>
      <div className={styles.readout} aria-hidden="true">
        <p className={styles.readoutHead}>{cursor === null ? t.maxima : t.at(azText(cursor))}</p>
        <ul className={styles.legend}>
          {series.map((s) => (
            <li key={s.key}>
              <span className={`${styles.key} ${styles[s.key]}`} />
              <span className={styles.legendLabel}>{s.label}</span>
              <strong className={styles.legendValue}>{valueOf(s.values)}</strong>
            </li>
          ))}
          <li>
            <span className={`${styles.swatch} ${styles.effectiveKey}`} />
            <span className={styles.legendLabel}>{t.effective}</span>
            <strong className={styles.legendValue}>{valueOf(effective)}</strong>
          </li>
        </ul>
      </div>
    </figure>
  );
}
