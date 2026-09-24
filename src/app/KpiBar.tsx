import { useId, type ReactNode } from 'react';
import { Skeleton } from '../components/Skeleton';
import { cssVars } from '../components/cssVars';
import { compassPoint, floorLabel, useFormat, useLang, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { shadingTotals } from '../charts/lib/shadingTotals';
import { criticalAngleKind, substringBeamLoss, type CriticalAngleKind } from '../model/geometry';
import {
  useAnnualInputsPending,
  useEconomics,
  useFloorPlacements,
  useInstant,
  useInstantPower,
  useLayout,
  useShadedFloor,
  useSimulation,
  useSimulationConfig,
} from '../hooks/useModel';
import { useConfig } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { floorColor } from '../styles/tokens';
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
  profileNone: 'keine Reihe darüber',
  profileOverlap: 'Panelreihen überlappen sich',
  shadeOn: (floor: string) => `Schatten auf ${floor}`,
  shadeSub: 'der Panelfläche, exakt aus dem 3D-Modell',
  beamLoss: (pct: string) => `${pct} Verlust der Direktstrahlung (Teilstränge)`,
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
    profileNone: 'no row above',
    profileOverlap: 'panel rows overlap',
    shadeOn: (floor) => `Shade on ${floor}`,
    shadeSub: 'of panel area, exact from the 3D model',
    beamLoss: (pct) => `${pct} direct-beam loss (substrings)`,
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
  /** Secondary text; several entries become separate lines. */
  sub?: ReactNode | readonly string[];
  children?: ReactNode;
}) {
  const lines = Array.isArray(sub) ? sub : null;
  return (
    <div className={styles.kpi}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{value}</dd>
      {lines
        ? lines.map((line) => (
            <dd key={line} className={styles.sub}>
              {line}
            </dd>
          ))
        : sub && <dd className={styles.sub}>{sub as ReactNode}</dd>}
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
            style={cssVars({ '--c': floorColor(it.floor) })}
            aria-hidden="true"
          />
          <span className={styles.floorName}>{it.label}</span>
          <span className={styles.floorValue}>{it.value}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Headline numbers: annual results (simulation) and the state at the selected instant.
 * Every annual number comes from one snapshot (the simulation and the config it was computed from), and
 * the annual group stays busy while its inputs are still loading (weather, terrain horizon).
 */
export function KpiBar() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const config = useConfig();
  const simulation = useSimulation();
  const simConfig = useSimulationConfig();
  const econ = useEconomics();
  const pending = useAnnualInputsPending();
  const instant = useInstant();
  const power = useInstantPower();
  const layout = useLayout();
  const placements = useFloorPlacements();
  const shadedFloor = useShadedFloor();
  const date = useTimeStore((s) => s.date);
  const minutes = useTimeStore((s) => s.minutes);

  const { numFloors } = config.building;
  const loading = pending || simulation === null;
  const ready = simulation !== null && !loading;
  const topDown = [...placements].reverse();

  // ── Annual (one snapshot: simulation + simConfig) ──
  const simFloors = simulation?.floors.length ?? numFloors;
  const ratedKwp = (simFloors * simConfig.panels.count * simConfig.panels.powerWp) / 1000;
  const loss = simulation ? shadingTotals(simulation) : null;
  const sourceText = simulation?.source === 'open-meteo' ? t.source(simulation.year) : c.clearSkyHint;
  const payback = econ?.paybackYears ?? NaN;

  // ── Instant ──
  const { sun } = instant;
  // The floor below the top floor (or the chosen lower floor): same floor as the heatmap.
  const shadeState = instant.floors[shadedFloor];
  let shadeValue: string;
  let shadeSub: string[];
  if (numFloors < 2) {
    shadeValue = '–';
    shadeSub = [t.noShadingFloors];
  } else if (!shadeState || shadeState.state !== 'lit') {
    shadeValue = '–';
    shadeSub = [c.sunStates[shadeState?.state ?? 'night']];
  } else {
    // Share of the row's panel area; with bypass substrings the direct-beam loss is larger.
    const { shade } = shadeState;
    shadeValue = f.pct(shade.fraction * 100);
    shadeSub = [t.shadeSub];
    if (config.system.shadingModel === 'substring' && shade.fraction > 0) {
      const losses = substringBeamLoss(shade, layout);
      const meanLoss = losses.reduce((a, b) => a + b, 0) / Math.max(1, losses.length);
      shadeSub.push(t.beamLoss(f.pct(meanLoss * 100)));
    }
  }
  const profile = instant.profileAngle;
  // The critical angle only exists for a row above that does not overlap this one.
  const profileSubs: Record<CriticalAngleKind, string> = {
    none: t.profileNone,
    overlap: t.profileOverlap,
    never: t.profileNever,
    angle: t.profileSub(f.deg(layout.criticalProfileAngle, 1)),
  };
  const profileSub = profileSubs[criticalAngleKind(layout, numFloors > 1)];

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
            value={ready ? <Num value={f.num(simulation.totalAnnualKwh)} unit="kWh" /> : skeleton}
            sub={ready ? sourceText : null}
          >
            {ready && simFloors > 1 && (
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
              ready && loss ? (
                <>
                  <Num value={f.num(loss.lossKwh)} unit="kWh" />{' '}
                  <span className={styles.secondary}>({f.pct(loss.lossPct, 1)})</span>
                </>
              ) : (
                skeleton
              )
            }
            sub={simFloors > 1 ? t.shadingLossSub : t.noShadingFloors}
          />
          <Kpi
            label={t.specificYield}
            value={
              ready && ratedKwp > 0 ? (
                <Num value={f.num(simulation.totalAnnualKwh / ratedKwp)} unit="kWh/kWp" />
              ) : (
                skeleton
              )
            }
            sub={ready ? t.specificYieldSub(f.unit(ratedKwp, 'kWp', 2)) : null}
          />
          <Kpi
            label={t.payback}
            value={
              econ && ready ? (
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
              econ && ready
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
            sub={profileSub}
          />
          <Kpi
            label={t.shadeOn(floorLabel(placements[shadedFloor]?.storey ?? shadedFloor, lang))}
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
