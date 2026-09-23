import { useId, type ReactNode } from 'react';
import { Skeleton } from '../components/Skeleton';
import { cssVars } from '../components/cssVars';
import { compassPoint, floorLabel, useFormat, useLang, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import {
  useEconomics,
  useFloorPlacements,
  useFocusFloor,
  useInstant,
  useInstantPower,
  useLayout,
  useSimulation,
} from '../hooks/useModel';
import { useConfig } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useTimeStore } from '../state/timeStore';
import styles from './KpiBar.module.css';

const de = {
  heading: 'Ergebnisse',
  year: 'Jahr',
  now: 'Jetzt',
  annualYield: 'Jahresertrag',
  source: (year: number) => `Open-Meteo, Wetter ${year}`,
  shadingLoss: 'Verschattungsverlust',
  shadingLossSub: 'durch das jeweils obere Stockwerk',
  noShadingFloors: 'nur ein Stockwerk',
  specificYield: 'Spezifischer Ertrag',
  specificYieldSub: (kwp: string) => `bei ${kwp} installiert`,
  payback: 'Amortisation',
  yearsUnit: 'Jahre',
  paybackSub: (savings: string) => `Ersparnis ${savings} pro Jahr`,
  sun: 'Sonnenhöhe',
  azimuth: (az: string) => `Azimut ${az}`,
  profile: 'Profilwinkel',
  profileSub: (critical: string) => `kritisch ${critical} (2D-Näherung, nur zur Erklärung)`,
  profileNever: 'Profilwinkel-Grenze wird nie erreicht',
  shadeOn: (floor: string) => `Schatten auf ${floor}`,
  shadeSub: 'exakt aus dem 3D-Modell',
  topFloor: 'oberstes Stockwerk: keine Panels darüber',
  power: 'Leistung jetzt',
  powerSub: 'bei klarem Himmel, AC',
  loading: 'Jahresergebnisse werden berechnet …',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    heading: 'Results',
    year: 'Year',
    now: 'Now',
    annualYield: 'Annual yield',
    source: (year) => `Open-Meteo, ${year} weather`,
    shadingLoss: 'Shading loss',
    shadingLossSub: 'caused by the floor above',
    noShadingFloors: 'single floor only',
    specificYield: 'Specific yield',
    specificYieldSub: (kwp) => `with ${kwp} installed`,
    payback: 'Payback',
    yearsUnit: 'years',
    paybackSub: (savings) => `savings ${savings} per year`,
    sun: 'Sun altitude',
    azimuth: (az) => `azimuth ${az}`,
    profile: 'Profile angle',
    profileSub: (critical) => `critical ${critical} (2D approximation, explanatory only)`,
    profileNever: 'profile angle limit is never reached',
    shadeOn: (floor) => `Shade on ${floor}`,
    shadeSub: 'exact, from the 3D model',
    topFloor: 'top floor: no panels above',
    power: 'Power now',
    powerSub: 'clear sky, AC',
    loading: 'Computing annual results …',
  },
};

/** Number with a smaller unit, e.g. <Num value="2’855" unit="kWh" />. */
function Num({ value, unit }: { value: string; unit?: string }) {
  return (
    <>
      {value}
      {unit && <span className={styles.unit}>{`\u00a0${unit}`}</span>}
    </>
  );
}

function Kpi({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.kpi}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{value}</dd>
      {sub && <dd className={styles.sub}>{sub}</dd>}
      {children && <dd className={styles.extra}>{children}</dd>}
    </div>
  );
}

function FloorList({ items }: { items: { floor: number; label: string; value: string }[] }) {
  return (
    <ul className={styles.floorList}>
      {items.map((it) => (
        <li key={it.floor} className={styles.floorItem}>
          <span
            className={styles.swatch}
            style={cssVars({ '--c': `var(--floor-${it.floor % 8})` })}
            aria-hidden="true"
          />
          <span className={styles.floorName}>{it.label}</span>
          <span className={styles.floorValue}>{it.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Headline numbers: annual results (simulation) and the state at the selected instant. */
export function KpiBar() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const config = useConfig();
  const weather = useDataStore((s) => s.weather);
  const simulation = useSimulation();
  const econ = useEconomics();
  const instant = useInstant();
  const power = useInstantPower();
  const layout = useLayout();
  const placements = useFloorPlacements();
  const focus = useFocusFloor();
  const date = useTimeStore((s) => s.date);
  const minutes = useTimeStore((s) => s.minutes);

  const { numFloors } = config.building;
  const loading = weather.status === 'loading' || simulation === null;
  const topDown = [...placements].reverse();
  const ratedKwp = (numFloors * config.panels.count * config.panels.powerWp) / 1000;

  // ── Annual ──
  const unshadedKwh = simulation?.floors.reduce((s, fl) => s + fl.annualUnshadedKwh, 0) ?? 0;
  const lossPct = simulation && unshadedKwh > 0 ? (simulation.totalShadingLossKwh / unshadedKwh) * 100 : 0;
  const sourceText = simulation?.source === 'open-meteo' ? t.source(simulation.year) : c.clearSkyHint;
  const payback = econ?.paybackYears ?? NaN;

  // ── Instant ──
  const { sun } = instant;
  const focusState = instant.floors[focus];
  const hasAbove = focus < numFloors - 1;
  let shadeValue: string;
  let shadeSub: string;
  if (!hasAbove) {
    shadeValue = '–';
    shadeSub = numFloors === 1 ? t.noShadingFloors : t.topFloor;
  } else if (focusState.state !== 'lit') {
    shadeValue = '–';
    shadeSub = c.sunStates[focusState.state];
  } else {
    shadeValue = f.pct(focusState.shade.fraction * 100);
    shadeSub = t.shadeSub;
  }
  const profile = instant.profileAngle;
  const critical = layout.criticalProfileAngle;

  const headingId = useId();
  const skeleton = <Skeleton width="7ch" height="1.1em" />;

  return (
    <section className={styles.bar} aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        {t.heading}
      </h2>
      <div className={styles.group} aria-busy={loading || undefined}>
        <h3 className={styles.groupTitle}>
          {t.year} {config.weather.year}
        </h3>
        {loading && <span className="sr-only">{t.loading}</span>}
        <dl className={styles.grid}>
          <Kpi
            label={t.annualYield}
            value={
              simulation && !loading ? <Num value={f.num(simulation.totalAnnualKwh)} unit="kWh" /> : skeleton
            }
            sub={simulation && !loading ? sourceText : null}
          >
            {simulation && !loading && numFloors > 1 && (
              <FloorList
                items={[...simulation.floors].reverse().map((fl) => ({
                  floor: fl.floor,
                  label: floorLabel(fl.storey, lang),
                  value: f.kwh(fl.annualKwh),
                }))}
              />
            )}
          </Kpi>
          <Kpi
            label={t.shadingLoss}
            value={
              simulation && !loading ? (
                <>
                  <Num value={f.num(simulation.totalShadingLossKwh)} unit="kWh" />{' '}
                  <span className={styles.secondary}>({f.pct(lossPct, 1)})</span>
                </>
              ) : (
                skeleton
              )
            }
            sub={numFloors > 1 ? t.shadingLossSub : t.noShadingFloors}
          />
          <Kpi
            label={t.specificYield}
            value={
              simulation && !loading && ratedKwp > 0 ? (
                <Num value={f.num(simulation.totalAnnualKwh / ratedKwp)} unit="kWh/kWp" />
              ) : (
                skeleton
              )
            }
            sub={t.specificYieldSub(f.unit(ratedKwp, 'kWp', 2))}
          />
          <Kpi
            label={t.payback}
            value={
              econ && !loading ? (
                Number.isFinite(payback) ? (
                  <Num value={f.num(payback, 1)} unit={t.yearsUnit} />
                ) : (
                  c.never
                )
              ) : (
                skeleton
              )
            }
            sub={
              econ && !loading
                ? t.paybackSub(f.currency(econ.annualSavings, config.economics.currency, 0))
                : null
            }
          />
        </dl>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>
          {t.now} · {f.dateShort(date)} {f.time(minutes)}
        </h3>
        <dl className={styles.grid}>
          <Kpi
            label={t.sun}
            value={sun.altitude > 0 ? f.deg(sun.altitude, 1) : '–'}
            sub={[
              t.azimuth(`${f.deg(sun.azimuth)} ${compassPoint(sun.azimuth, lang)}`),
              sun.altitude <= 0
                ? c.sunStates.night
                : instant.floors[0]?.state === 'behind'
                  ? c.sunStates.behind
                  : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
          <Kpi
            label={t.profile}
            value={profile === null || sun.altitude <= 0 ? '–' : f.deg(profile, 1)}
            sub={critical >= 90 ? t.profileNever : t.profileSub(f.deg(critical, 1))}
          />
          <Kpi
            label={t.shadeOn(floorLabel(placements[focus]?.storey ?? focus, lang))}
            value={shadeValue}
            sub={shadeSub}
          />
          <Kpi
            label={t.power}
            value={<Num value={f.num(power.reduce((a, b) => a + b, 0))} unit="W" />}
            sub={t.powerSub}
          >
            {numFloors > 1 && (
              <FloorList
                items={topDown.map((p) => ({
                  floor: p.floor,
                  label: floorLabel(p.storey, lang),
                  value: f.unit(power[p.floor] ?? 0, 'W'),
                }))}
              />
            )}
          </Kpi>
        </dl>
      </div>
    </section>
  );
}
