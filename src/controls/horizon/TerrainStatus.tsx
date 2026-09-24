import { useMemo } from 'react';
import { Button } from '../../components/Button';
import { cssVars } from '../../components/cssVars';
import { ResetIcon } from '../../components/icons';
import { compassPoint, useFormat, useLang, useMessages, type Messages } from '../../i18n';
import { useDataStore } from '../../state/dataStore';
import { profilePeak } from './horizonData';
import styles from './TerrainStatus.module.css';

const de = {
  loading: 'Geländehorizont wird geladen …',
  progress: 'Fortschritt Geländehorizont',
  error: 'Der Geländehorizont konnte nicht geladen werden. Es wird ohne Gelände gerechnet.',
  retry: 'Erneut versuchen',
  site: 'Höhe am Standort (Geländemodell)',
  peak: 'Höchster Geländewinkel',
  peakValue: (el: string, az: string, dir: string) => `${el} bei ${az} (${dir})`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    loading: 'Loading terrain horizon …',
    progress: 'Terrain horizon progress',
    error: 'The terrain horizon could not be loaded. Calculating without terrain.',
    retry: 'Try again',
    site: 'Site elevation (terrain model)',
    peak: 'Highest terrain angle',
    peakValue: (el, az, dir) => `${el} at ${az} (${dir})`,
  },
};

/** Load state of the terrain horizon: progress bar, error with retry, or site elevation and highest angle. */
export function TerrainStatus() {
  const t = useMessages(messages);
  const f = useFormat();
  const lang = useLang();
  const terrain = useDataStore((s) => s.terrain);
  const retry = useDataStore((s) => s.retryTerrain);
  const peak = useMemo(() => (terrain.profile ? profilePeak(terrain.profile) : null), [terrain.profile]);

  if (terrain.status === 'loading') {
    const pct = Math.round(terrain.progress * 100);
    return (
      <div className={styles.loading}>
        <span className={styles.label} aria-hidden="true">
          {t.loading} {f.pct(pct)}
        </span>
        <div
          className={styles.bar}
          role="progressbar"
          aria-label={t.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={f.pct(pct)}
          style={cssVars({ '--progress': terrain.progress })}
        >
          <span className={styles.fill} />
        </div>
      </div>
    );
  }

  if (terrain.status === 'error') {
    return (
      <div className={styles.error}>
        <p>{t.error}</p>
        {terrain.error && <p className={styles.detail}>{terrain.error}</p>}
        <div>
          <Button size="sm" icon={<ResetIcon />} onClick={retry}>
            {t.retry}
          </Button>
        </div>
      </div>
    );
  }

  if (terrain.status === 'ready') {
    return (
      <dl className={styles.facts}>
        {terrain.siteElevation !== null && (
          <div className={styles.fact}>
            <dt>{t.site}</dt>
            <dd>{f.unit(terrain.siteElevation, 'm')}</dd>
          </div>
        )}
        {peak && (
          <div className={styles.fact}>
            <dt>{t.peak}</dt>
            <dd>
              {t.peakValue(f.deg(peak.elevation, 1), f.deg(peak.azimuth), compassPoint(peak.azimuth, lang))}
            </dd>
          </div>
        )}
      </dl>
    );
  }

  return null;
}
