import type { ReactNode } from 'react';
import {
  compassPoint,
  displayLocationName,
  floorLabel,
  useFormat,
  useLang,
  useMessages,
  type Messages,
} from '../i18n';
import { useCommon } from '../i18n/common';
import { useSelectedUtc } from '../hooks/useModel';
import type { ShadingModel } from '../model/types';
import { useConfig } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useTimeStore } from '../state/timeStore';
import { shareUrl } from '../state/urlSync';
import styles from './PrintReport.module.css';

const de = {
  title: 'Eingaben dieses Berichts',
  created: (when: string) => `Erstellt am ${when}`,
  instant: (when: string) => `Ansichten und «Jetzt»-Werte für ${when}`,
  location: 'Standort',
  name: 'Name',
  coordinates: 'Koordinaten',
  elevation: 'Höhe',
  timezone: 'Zeitzone',
  building: 'Gebäude',
  facade: 'Fassadenausrichtung',
  floors: 'Stockwerke mit Panels',
  floorsValue: (n: string, lowest: string) => `${n}, unterstes: ${lowest}`,
  floorHeight: 'Stockwerkhöhe',
  railingHeight: 'Geländerhöhe',
  balconyDepth: 'Balkontiefe',
  panels: 'Panels',
  modules: 'Module je Stockwerk',
  moduleSize: 'Modulmasse (Länge × Breite)',
  gap: 'Abstand zwischen Modulen',
  tilt: 'Neigung θ ab Senkrechte',
  system: 'System',
  inverter: 'Wechselrichter-Grenze je Stockwerk',
  losses: 'Systemverluste',
  tempCoeff: 'Temperaturkoeffizient',
  albedo: 'Albedo',
  shadingModel: 'Teilverschattung',
  shadingModels: { linear: 'flächenanteilig', substring: 'Bypass-Teilstränge' } satisfies Record<
    ShadingModel,
    string
  >,
  environment: 'Horizont & Wetter',
  terrain: 'Geländehorizont',
  on: 'ein',
  off: 'aus',
  obstacles: 'Hindernisse',
  manualHorizon: 'Eigene Horizontpunkte',
  weather: 'Wetterdaten',
  weatherOpenMeteo: (year: number) => `Open-Meteo, Jahr ${year}`,
  weatherFallback: (year: number) =>
    `Open-Meteo, Jahr ${year} – nicht verfügbar, gerechnet mit klarem Himmel`,
  economics: 'Wirtschaftlichkeit',
  price: 'Strompreis (Bezug)',
  feedIn: 'Einspeisevergütung',
  selfConsumption: 'Eigenverbrauchsanteil',
  investment: 'Investition je Stockwerk',
  degradation: 'Degradation',
  perYear: '%/Jahr',
  lifetime: 'Betrachtungsdauer',
  link: 'Link zu dieser Konfiguration',
};

const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Inputs of this report',
    created: (when) => `Created ${when}`,
    instant: (when) => `Views and “now” values for ${when}`,
    location: 'Location',
    name: 'Name',
    coordinates: 'Coordinates',
    elevation: 'Elevation',
    timezone: 'Time zone',
    building: 'Building',
    facade: 'Facade orientation',
    floors: 'Floors with panels',
    floorsValue: (n, lowest) => `${n}, lowest: ${lowest}`,
    floorHeight: 'Floor-to-floor height',
    railingHeight: 'Railing height',
    balconyDepth: 'Balcony depth',
    panels: 'Panels',
    modules: 'Modules per floor',
    moduleSize: 'Module size (length × width)',
    gap: 'Gap between modules',
    tilt: 'Tilt θ from vertical',
    system: 'System',
    inverter: 'Inverter limit per floor',
    losses: 'System losses',
    tempCoeff: 'Temperature coefficient',
    albedo: 'Albedo',
    shadingModel: 'Partial shading',
    shadingModels: { linear: 'proportional to shaded area', substring: 'bypass substrings' },
    environment: 'Horizon & weather',
    terrain: 'Terrain horizon',
    on: 'on',
    off: 'off',
    obstacles: 'Obstacles',
    manualHorizon: 'Custom horizon points',
    weather: 'Weather data',
    weatherOpenMeteo: (year) => `Open-Meteo, year ${year}`,
    weatherFallback: (year) => `Open-Meteo, year ${year} – unavailable, computed with clear skies`,
    economics: 'Economics',
    price: 'Electricity price (purchase)',
    feedIn: 'Feed-in tariff',
    selfConsumption: 'Self-consumption share',
    investment: 'Investment per floor',
    degradation: 'Degradation',
    perYear: '%/year',
    lifetime: 'Evaluation period',
    link: 'Link to this configuration',
  },
};

function Group({ title, items }: { title: string; items: [string, ReactNode][] }) {
  return (
    <div className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      <dl className={styles.list}>
        {items.map(([label, value]) => (
          <div key={label} className={styles.row}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Print-only appendix: every input the printed results depend on, the selected instant and the share
 * link that reopens exactly this analysis. Rendered only while printing (see usePrintMode).
 */
export function PrintReport({ printedAt }: { printedAt: number }) {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const config = useConfig();
  const date = useTimeStore((s) => s.date);
  const minutes = useTimeStore((s) => s.minutes);
  const utc = useSelectedUtc();
  const weatherFallback = useDataStore((st) => st.weather.usingFallback);
  const { location: loc, building: b, panels: p, system: s, horizon: h, weather: w, economics: e } = config;

  const created = new Intl.DateTimeFormat(f.locale, { dateStyle: 'long', timeStyle: 'short' }).format(
    printedAt,
  );
  // Tariffs keep up to 4 decimals (e.g. 0.3214), otherwise 2.
  const perKwh = (v: number): string => {
    const digits = Math.abs(v * 100 - Math.round(v * 100)) > 1e-9 ? 4 : 2;
    return `${f.currency(v, e.currency, digits)}/kWh`;
  };

  return (
    <section className={styles.report} aria-label={t.title}>
      <h2 className={styles.title}>{t.title}</h2>
      <p className={styles.meta}>
        {t.created(created)} ·{' '}
        {t.instant(`${f.date(date)}, ${f.time(minutes)} ${f.tzName(loc.timezone, utc)}`)}
      </p>
      <div className={styles.groups}>
        <Group
          title={t.location}
          items={[
            [t.name, displayLocationName(loc, f)],
            [t.coordinates, f.coords(loc.latitude, loc.longitude, 4)],
            [t.elevation, f.unit(loc.elevation, 'm')],
            [t.timezone, loc.timezone],
          ]}
        />
        <Group
          title={t.building}
          items={[
            [t.facade, `${f.deg(b.facadeAzimuth)} ${compassPoint(b.facadeAzimuth, lang)}`],
            [t.floors, t.floorsValue(f.int(b.numFloors), floorLabel(b.lowestFloor, lang))],
            [t.floorHeight, f.unit(b.floorHeight, 'cm')],
            [t.railingHeight, f.unit(b.railingHeight, 'cm')],
            [t.balconyDepth, f.unit(b.balconyDepth, 'cm')],
          ]}
        />
        <Group
          title={t.panels}
          items={[
            [t.modules, `${f.int(p.count)} × ${f.unit(p.powerWp, 'Wp')}`],
            [t.moduleSize, `${f.num(p.length, 1)} × ${f.unit(p.width, 'cm', 1)}`],
            [t.gap, f.unit(p.gap, 'cm', 1)],
            [
              t.tilt,
              `${f.deg(p.tiltFromVertical)} (${c.tiltFromHorizontalHint(f.deg(90 - p.tiltFromVertical))})`,
            ],
          ]}
        />
        <Group
          title={t.system}
          items={[
            [t.inverter, f.unit(s.inverterLimitW, 'W')],
            [t.losses, f.pct(s.lossesPct, 1)],
            [t.tempCoeff, f.unit(s.tempCoeffPct, '%/K', 2)],
            ['NOCT', f.unit(s.noct, '°C')],
            [t.albedo, f.num(s.albedo, 2)],
            [t.shadingModel, t.shadingModels[s.shadingModel]],
          ]}
        />
        <Group
          title={t.environment}
          items={[
            [t.terrain, h.terrainEnabled ? t.on : t.off],
            [t.obstacles, f.int(h.obstacles.length)],
            [t.manualHorizon, f.int(h.manual.length)],
            [
              t.weather,
              w.source === 'clear-sky'
                ? c.clearSkyHint
                : weatherFallback
                  ? t.weatherFallback(w.year)
                  : t.weatherOpenMeteo(w.year),
            ],
          ]}
        />
        <Group
          title={t.economics}
          items={[
            [t.price, perKwh(e.electricityPrice)],
            [t.feedIn, perKwh(e.feedInTariff)],
            [t.selfConsumption, f.pct(e.selfConsumptionPct)],
            [t.investment, f.currency(e.investmentPerFloor, e.currency, 0)],
            [t.degradation, f.unit(e.degradationPct, t.perYear, 1)],
            [t.lifetime, c.years(f.int(e.lifetimeYears))],
          ]}
        />
      </div>
      <p className={styles.link}>
        <span className={styles.linkLabel}>{t.link}:</span>{' '}
        <span className={styles.url}>{shareUrl(config)}</span>
      </p>
    </section>
  );
}
