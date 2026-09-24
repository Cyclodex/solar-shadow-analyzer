import { useCallback, useMemo } from 'react';
import { Button } from '../components/Button';
import { ResetIcon } from '../components/icons';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { SelectField } from '../components/SelectField';
import { useFormat, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { LIMITS, latestCompleteWeatherYear } from '../model/defaults';
import { fetchOpenMeteoYear } from '../model/weather';
import type { Config, WeatherSeries, WeatherSource } from '../model/types';
import { useConfigSection, useConfigStore, usePatch } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import sections from './sections.module.css';
import styles from './WeatherSection.module.css';

/** Latest selectable weather year (evaluated once at start-up). */
const MAX_YEAR = latestCompleteWeatherYear(Date.now());
const MIN_YEAR = LIMITS.weather.year.min;

const de = {
  title: 'Wetterdaten',
  source: 'Datenquelle',
  openMeteoHint: 'Stündliche Einstrahlung und Temperatur des gewählten Jahres (Reanalyse) von Open-Meteo.',
  clearSkyHint: 'Synthetisches Jahr ohne Wolken: ein theoretisches Maximum, kein reales Wetter.',
  year: 'Jahr',
  yearHintClearSky: 'Beim klaren Himmel legt das Jahr nur den Kalender fest.',
  loading: (year: number) => `Wetterdaten ${year} werden geladen …`,
  ready: (year: number) => `Wetterdaten ${year} geladen.`,
  clearSkyReady: 'Klarer Himmel berechnet.',
  ghi: 'Globalstrahlung (horizontal)',
  perYear: (kwh: string) => `${kwh}/m² im Jahr`,
  fallback:
    'Open-Meteo ist nicht erreichbar. Es wird mit klarem Himmel gerechnet – ein theoretisches Maximum.',
  retry: 'Erneut versuchen',
  attribution: 'Weather data by',
  license: 'Lizenz CC BY 4.0',
  reanalysis: 'Reanalyse u. a. ERA5 (Copernicus/ECMWF).',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Weather data',
    source: 'Data source',
    openMeteoHint: 'Hourly irradiance and temperature of the selected year (reanalysis) from Open-Meteo.',
    clearSkyHint: 'Synthetic cloudless year: a theoretical maximum, not real weather.',
    year: 'Year',
    yearHintClearSky: 'With clear skies the year only sets the calendar.',
    loading: (year) => `Loading ${year} weather data …`,
    ready: (year) => `${year} weather data loaded.`,
    clearSkyReady: 'Clear sky computed.',
    ghi: 'Global horizontal irradiation',
    perYear: (kwh) => `${kwh}/m² per year`,
    fallback: 'Open-Meteo cannot be reached. Calculating with clear skies – a theoretical maximum.',
    retry: 'Try again',
    attribution: 'Weather data by',
    license: 'licence CC BY 4.0',
    reanalysis: 'Reanalysis incl. ERA5 (Copernicus/ECMWF).',
  },
};

/** Annual sum of the global horizontal irradiance, kWh/m² (Σ GHI · step). */
function annualGhiKwhPerM2(series: WeatherSeries): number {
  let wh = 0;
  for (const g of series.ghi) wh += g;
  return (wh * series.stepMinutes) / 60 / 1000;
}

/** Weather request of the loader: a retried result only applies while the config still asks for it. */
function weatherRequest(config: Config): string | null {
  if (config.weather.source !== 'open-meteo') return null;
  return `${config.location.latitude},${config.location.longitude},${config.weather.year}`;
}

/**
 * Retries the Open-Meteo request after a failure (same request as useWeatherLoader). While it runs the
 * clear-sky fallback stays in place; a result is dropped when location, year or source changed meanwhile.
 */
function useWeatherRetry(): () => void {
  return useCallback(() => {
    const config = useConfigStore.getState().config;
    const request = weatherRequest(config);
    if (request === null) return;
    const current = (): boolean => weatherRequest(useConfigStore.getState().config) === request;
    const { setWeather } = useDataStore.getState();
    setWeather({ status: 'loading', error: null });
    fetchOpenMeteoYear(config.location.latitude, config.location.longitude, config.weather.year).then(
      (series) => {
        if (current()) setWeather({ status: 'ready', series, error: null, usingFallback: false });
      },
      (e: unknown) => {
        if (current()) setWeather({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      },
    );
  }, []);
}

/** Weather source (Open-Meteo year or clear sky), year, load state with annual irradiation, attribution. */
export function WeatherSection() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const weatherConfig = useConfigSection('weather');
  const patch = usePatch();
  const weather = useDataStore((s) => s.weather);
  const retry = useWeatherRetry();
  const { source, year } = weatherConfig;
  const summary = source === 'open-meteo' ? `${c.openMeteo} ${year}` : c.clearSky;

  const years = useMemo(() => {
    const list: string[] = [];
    for (let y = MAX_YEAR; y >= MIN_YEAR; y--) list.push(String(y));
    // A shared/stored config may name a year outside the list: keep it selectable.
    if (!list.includes(String(year))) list.unshift(String(year));
    return list.map((y) => ({ value: y, label: y }));
  }, [year]);

  const series = weather.series;
  const current =
    weather.status === 'ready' && series?.source === source && series.year === year ? series : null;
  const ghi = useMemo(() => (current ? annualGhiKwhPerM2(current) : null), [current]);

  return (
    <Section id="weather" title={t.title} summary={summary}>
      <div className={sections.group}>
        <Segmented<WeatherSource>
          label={t.source}
          showLabel
          fullWidth
          value={source}
          onChange={(s) => patch('weather', { source: s })}
          options={[
            { value: 'open-meteo', label: c.openMeteo },
            { value: 'clear-sky', label: c.clearSky },
          ]}
        />
        <p className={sections.hint}>{source === 'open-meteo' ? t.openMeteoHint : t.clearSkyHint}</p>
      </div>
      <SelectField
        label={t.year}
        value={String(year)}
        options={years}
        onChange={(y) => patch('weather', { year: Number(y) })}
        hint={source === 'clear-sky' ? t.yearHintClearSky : undefined}
      />

      <div className={styles.status} aria-live="polite">
        {weather.status === 'loading' && (
          <p className={styles.loading}>
            <span className={styles.spinner} aria-hidden="true" />
            {t.loading(year)}
          </p>
        )}
        {weather.status === 'error' && source === 'open-meteo' && (
          <div className={styles.fallback}>
            <p>{t.fallback}</p>
            {weather.error && <p className={styles.detail}>{weather.error}</p>}
            <div>
              <Button size="sm" icon={<ResetIcon />} onClick={retry}>
                {t.retry}
              </Button>
            </div>
          </div>
        )}
        {current && ghi !== null && (
          <div className={styles.ready}>
            <p className={styles.readyText}>{source === 'open-meteo' ? t.ready(year) : t.clearSkyReady}</p>
            <dl className={styles.fact}>
              <dt>{t.ghi}</dt>
              <dd>{t.perYear(f.kwh(ghi))}</dd>
            </dl>
          </div>
        )}
      </div>

      {source === 'open-meteo' && (
        <p className={styles.attribution}>
          {t.attribution}{' '}
          <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
            Open-Meteo.com
          </a>
          ,{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
            {t.license}
          </a>
          . {t.reanalysis}
        </p>
      )}
    </Section>
  );
}
