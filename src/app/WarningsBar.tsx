import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { AlertIcon, InfoIcon } from '../components/icons';
import { useCommon } from '../i18n/common';
import { floorLabel, useFormat, useLang, useMessages, type Messages } from '../i18n';
import { panelDepthBelowGround, panelsOverlap } from '../model/geometry';
import { useFloorPlacements, useLayout } from '../hooks/useModel';
import { useConfig } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useShareLinkStore } from '../state/shareLinkStore';
import styles from './WarningsBar.module.css';

const de = {
  region: 'Hinweise',
  overlap: (drop: string, height: string) =>
    `Die Panelreihen überlappen sich physisch: Ein Panel reicht ${drop} nach unten, die Stockwerkhöhe beträgt nur ${height}. Neigung erhöhen oder kürzere Module wählen.`,
  belowGround: (depth: string, floor: string, firstFloor: string) =>
    `Die Panels der untersten Reihe (${floor}) reichen ${depth} unter das Terrain – physisch nicht möglich. Neigung erhöhen, kürzere Module oder Querformat wählen, das Geländer erhöhen oder das unterste Panel-Stockwerk auf ${firstFloor} setzen.`,
  terrainError: 'Der Geländehorizont konnte nicht geladen werden. Es wird ohne Gelände gerechnet.',
  terrainLoading: 'Geländehorizont wird geladen …',
  weatherError: (year: number) =>
    `Die Wetterdaten ${year} (Open-Meteo) konnten nicht geladen werden. Es wird mit klarem Himmel gerechnet – das ist ein theoretisches Maximum.`,
  weatherLoading: (year: number) => `Wetterdaten ${year} werden geladen …`,
  clearSky: 'Wetterdaten: klarer Himmel. Die Erträge sind ein theoretisches Maximum, kein reales Wetter.',
  singleFloor: 'Nur ein Stockwerk: Es gibt keine gegenseitige Verschattung durch Panels.',
  details: 'Details',
  linkReplaced:
    'Konfiguration aus dem geöffneten Link geladen – die bisher gespeicherte Konfiguration wurde ersetzt.',
  restore: 'Bisherige Konfiguration wiederherstellen',
  restored: 'Vorherige Konfiguration wiederhergestellt.',
  linkInvalid: (showing: 'saved' | 'default') =>
    `Der geöffnete Teilen-Link ist ungültig oder unvollständig – angezeigt wird ${
      showing === 'saved' ? 'die gespeicherte Konfiguration' : 'die Standardkonfiguration'
    }.`,
  dismiss: 'Hinweis schliessen',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    region: 'Notices',
    overlap: (drop, height) =>
      `The panel rows physically overlap: a panel reaches ${drop} down, but the floor-to-floor height is only ${height}. Increase the tilt or choose shorter modules.`,
    belowGround: (depth, floor, firstFloor) =>
      `The panels of the lowest row (${floor}) reach ${depth} below ground level – physically impossible. Increase the tilt, choose shorter modules or landscape mounting, raise the railing, or set the lowest panel floor to ${firstFloor}.`,
    terrainError: 'The terrain horizon could not be loaded. Calculating without terrain.',
    terrainLoading: 'Loading terrain horizon …',
    weatherError: (year) =>
      `The ${year} weather data (Open-Meteo) could not be loaded. Calculating with clear skies – a theoretical maximum.`,
    weatherLoading: (year) => `Loading ${year} weather data …`,
    clearSky: 'Weather data: clear sky. Yields are a theoretical maximum, not real weather.',
    singleFloor: 'Only one floor: panels cannot shade each other.',
    details: 'Details',
    linkReplaced:
      'Configuration loaded from the opened link – the previously saved configuration was replaced.',
    restore: 'Restore previous configuration',
    restored: 'Previous configuration restored.',
    linkInvalid: (showing) =>
      `The opened share link is invalid or incomplete – showing ${
        showing === 'saved' ? 'the saved configuration' : 'the default configuration'
      }.`,
    dismiss: 'Close notice',
  },
};

type Tone = 'bad' | 'warn' | 'info';

interface Notice {
  id: string;
  tone: Tone;
  text: string;
  detail?: string | null;
  /** Buttons after the text (e.g. restore, close). */
  actions?: ReactNode;
}

/** Warnings and notices above the results (geometry conflicts, data problems, modelling limits, share links). */
export function WarningsBar() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const config = useConfig();
  const layout = useLayout();
  const placements = useFloorPlacements();
  const terrain = useDataStore((s) => s.terrain);
  const weather = useDataStore((s) => s.weather);
  const link = useShareLinkStore();
  const { numFloors } = config.building;
  // After "restore" the restore button is gone: keep keyboard focus in the notice (its close button).
  const restoredCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (link.restored) restoredCloseRef.current?.focus();
  }, [link.restored]);
  // A closed notice takes its focused button with it: continue at the results block around the notices.
  const dismiss = (notice: 'link' | 'invalid'): void => {
    link.dismiss(notice);
    document.getElementById('results')?.focus({ preventScroll: true });
  };

  const notices: Notice[] = [];
  if (link.invalid) {
    notices.push({
      id: 'link-invalid',
      tone: 'warn',
      text: t.linkInvalid(link.invalid),
      actions: (
        <Button size="sm" variant="ghost" onClick={() => dismiss('invalid')} aria-label={t.dismiss}>
          {c.close}
        </Button>
      ),
    });
  }
  if (link.replaced) {
    notices.push({
      id: 'link-replaced',
      tone: 'info',
      text: t.linkReplaced,
      actions: (
        <>
          <Button size="sm" onClick={link.restore}>
            {t.restore}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => dismiss('link')} aria-label={t.dismiss}>
            {c.close}
          </Button>
        </>
      ),
    });
  } else if (link.restored) {
    notices.push({
      id: 'link-restored',
      tone: 'info',
      text: t.restored,
      actions: (
        <Button
          ref={restoredCloseRef}
          size="sm"
          variant="ghost"
          onClick={() => dismiss('link')}
          aria-label={t.dismiss}
        >
          {c.close}
        </Button>
      ),
    });
  }
  if (numFloors > 1 && panelsOverlap(layout)) {
    notices.push({
      id: 'overlap',
      tone: 'bad',
      text: t.overlap(f.unit(layout.drop * 100, 'cm'), f.unit(layout.floorHeight * 100, 'cm')),
    });
  }
  // Also with a single floor. From 5 mm on, as in the views' notice (shown as at least "1 cm").
  const depth = panelDepthBelowGround(layout, placements);
  if (depth >= 0.005) {
    notices.push({
      id: 'below-ground',
      tone: 'bad',
      text: t.belowGround(
        f.unit(depth * 100, 'cm'),
        floorLabel(placements[0].storey, lang),
        floorLabel(1, lang),
      ),
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
      <div role="status" aria-atomic="false">
        <ul className={styles.list}>
          {notices.map((n) => (
            <NoticeItem
              key={n.id}
              tone={n.tone}
              detail={n.detail}
              detailLabel={t.details}
              actions={n.actions}
            >
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
  actions,
  children,
}: {
  tone: Tone;
  detail?: string | null;
  detailLabel: string;
  actions?: ReactNode;
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
            <code lang="en" translate="no">
              {detail}
            </code>
          </details>
        )}
        {actions && <span className={styles.actions}>{actions}</span>}
      </span>
    </li>
  );
}
