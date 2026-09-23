import type { ReactNode } from 'react';
import { AlertIcon, InfoIcon } from '../components/icons';
import { useFormat, useMessages, type Messages } from '../i18n';
import { panelsOverlap } from '../model/geometry';
import { useLayout } from '../hooks/useModel';
import { useConfig } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import styles from './WarningsBar.module.css';

const de = {
  region: 'Hinweise',
  overlap: (drop: string, height: string) =>
    `Die Panelreihen überlappen sich physisch: Ein Panel reicht ${drop} nach unten, der Stockwerkabstand beträgt nur ${height}. Neigung erhöhen oder kürzere Module wählen.`,
  terrainError: 'Der Geländehorizont konnte nicht geladen werden. Es wird ohne Gelände gerechnet.',
  terrainLoading: 'Geländehorizont wird geladen …',
  weatherError: (year: number) =>
    `Die Wetterdaten ${year} (Open-Meteo) konnten nicht geladen werden. Es wird mit klarem Himmel gerechnet – das ist ein theoretisches Maximum.`,
  weatherLoading: (year: number) => `Wetterdaten ${year} werden geladen …`,
  clearSky: 'Wetterdaten: klarer Himmel. Die Erträge sind ein theoretisches Maximum, kein reales Wetter.',
  singleFloor: 'Nur ein Stockwerk: Es gibt keine gegenseitige Verschattung durch Panels.',
  details: 'Details',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    region: 'Notices',
    overlap: (drop, height) =>
      `The panel rows physically overlap: a panel reaches ${drop} down, but the floor-to-floor height is only ${height}. Increase the tilt or choose shorter modules.`,
    terrainError: 'The terrain horizon could not be loaded. Calculating without terrain.',
    terrainLoading: 'Loading terrain horizon …',
    weatherError: (year) =>
      `The ${year} weather data (Open-Meteo) could not be loaded. Calculating with clear skies – a theoretical maximum.`,
    weatherLoading: (year) => `Loading ${year} weather data …`,
    clearSky: 'Weather data: clear sky. Yields are a theoretical maximum, not real weather.',
    singleFloor: 'Only one floor: panels cannot shade each other.',
    details: 'Details',
  },
};

type Tone = 'bad' | 'warn' | 'info';

interface Notice {
  id: string;
  tone: Tone;
  text: string;
  detail?: string | null;
}

/** Warnings and notices above the results (geometry conflicts, data problems, modelling limits). */
export function WarningsBar() {
  const t = useMessages(messages);
  const f = useFormat();
  const config = useConfig();
  const layout = useLayout();
  const terrain = useDataStore((s) => s.terrain);
  const weather = useDataStore((s) => s.weather);
  const { numFloors } = config.building;

  const notices: Notice[] = [];
  if (numFloors > 1 && panelsOverlap(layout)) {
    notices.push({
      id: 'overlap',
      tone: 'bad',
      text: t.overlap(f.unit(layout.drop * 100, 'cm'), f.unit(layout.floorHeight * 100, 'cm')),
    });
  }
  if (weather.status === 'error' && weather.usingFallback) {
    notices.push({
      id: 'weather-error',
      tone: 'warn',
      text: t.weatherError(config.weather.year),
      detail: weather.error,
    });
  } else if (weather.status === 'loading') {
    notices.push({ id: 'weather-loading', tone: 'info', text: t.weatherLoading(config.weather.year) });
  } else if (config.weather.source === 'clear-sky') {
    notices.push({ id: 'clear-sky', tone: 'info', text: t.clearSky });
  }
  if (config.horizon.terrainEnabled && terrain.status === 'error') {
    notices.push({ id: 'terrain-error', tone: 'warn', text: t.terrainError, detail: terrain.error });
  } else if (config.horizon.terrainEnabled && terrain.status === 'loading') {
    notices.push({ id: 'terrain-loading', tone: 'info', text: t.terrainLoading });
  }
  if (numFloors === 1) notices.push({ id: 'single-floor', tone: 'info', text: t.singleFloor });

  return (
    // Always rendered so that the live region exists before notices appear; collapses when empty.
    <section className={styles.bar} aria-label={t.region}>
      <div role="status">
        <ul className={styles.list}>
          {notices.map((n) => (
            <NoticeItem key={n.id} tone={n.tone} detail={n.detail} detailLabel={t.details}>
              {n.text}
            </NoticeItem>
          ))}
        </ul>
      </div>
    </section>
  );
}

function NoticeItem({
  tone,
  detail,
  detailLabel,
  children,
}: {
  tone: Tone;
  detail?: string | null;
  detailLabel: string;
  children: ReactNode;
}) {
  return (
    <li className={[styles.item, styles[tone]].join(' ')}>
      <span className={styles.icon} aria-hidden="true">
        {tone === 'info' ? <InfoIcon /> : <AlertIcon />}
      </span>
      <span className={styles.text}>
        {children}
        {detail && (
          <details className={styles.details}>
            <summary>{detailLabel}</summary>
            <code>{detail}</code>
          </details>
        )}
      </span>
    </li>
  );
}
