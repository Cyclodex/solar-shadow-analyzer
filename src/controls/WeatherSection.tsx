import { NumberField } from '../components/NumberField';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { Spinner } from '../components/Spinner';
import { useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { LIMITS, latestCompleteWeatherYear } from '../model/defaults';
import type { WeatherSource } from '../model/types';
import { useConfigSection, usePatch } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import styles from './sections.module.css';

/** Latest selectable weather year (evaluated once at start-up). */
const MAX_YEAR = latestCompleteWeatherYear(Date.now());

const de = {
  title: 'Wetterdaten',
  source: 'Datenquelle',
  openMeteoHint: 'Stündliche Wetterdaten (Reanalyse) des gewählten Jahres von Open-Meteo.',
  clearSkyHint: 'Synthetisches Jahr ohne Wolken – theoretisches Maximum, kein reales Wetter.',
  year: 'Jahr',
  loading: 'Wetterdaten werden geladen …',
  ready: 'Wetterdaten geladen.',
  fallback: 'Laden fehlgeschlagen – es wird mit klarem Himmel gerechnet.',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Weather data',
    source: 'Data source',
    openMeteoHint: 'Hourly reanalysis data of the selected year from Open-Meteo.',
    clearSkyHint: 'Synthetic cloudless year – a theoretical maximum, not real weather.',
    year: 'Year',
    loading: 'Loading weather data …',
    ready: 'Weather data loaded.',
    fallback: 'Loading failed – calculating with clear skies.',
  },
};

/** Weather source and year. (Basic version.) */
export function WeatherSection() {
  const t = useMessages(messages);
  const c = useCommon();
  const weatherConfig = useConfigSection('weather');
  const patch = usePatch();
  const weather = useDataStore((s) => s.weather);
  const summary = weatherConfig.source === 'open-meteo' ? `${c.openMeteo} ${weatherConfig.year}` : c.clearSky;

  return (
    <Section id="weather" title={t.title} summary={summary}>
      <div className={styles.group}>
        <Segmented<WeatherSource>
          label={t.source}
          showLabel
          fullWidth
          value={weatherConfig.source}
          onChange={(source) => patch('weather', { source })}
          options={[
            { value: 'open-meteo', label: c.openMeteo },
            { value: 'clear-sky', label: c.clearSky },
          ]}
        />
        <p className={styles.hint}>
          {weatherConfig.source === 'open-meteo' ? t.openMeteoHint : t.clearSkyHint}
        </p>
      </div>
      <NumberField
        label={t.year}
        value={weatherConfig.year}
        onChange={(year) => patch('weather', { year })}
        limit={LIMITS.weather.year}
        max={MAX_YEAR}
        slider={false}
      />
      {weatherConfig.source === 'open-meteo' && (
        <div className={styles.status} aria-live="polite">
          {weather.status === 'loading' && <Spinner size="sm" showLabel label={t.loading} />}
          {weather.status === 'ready' && <span>{t.ready}</span>}
          {weather.status === 'error' && <span className={styles.statusError}>{t.fallback}</span>}
        </div>
      )}
    </Section>
  );
}
