import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { latestCompleteWeatherYear } from '../model/defaults';
import type { WeatherSeries } from '../model/types';
import { clearSkyYear } from '../model/weather';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { useWeatherLoader } from '../hooks/useWeather';
import { WeatherSection } from './WeatherSection';

/** Section plus the weather loader, which performs the retries. */
function WithLoader() {
  useWeatherLoader();
  return <WeatherSection />;
}

const weatherConfig = () => useConfigStore.getState().config.weather;

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/** Minimal Open-Meteo archive payload: 48 hourly stamps, 300 W/m² GHI from 08:00 to 16:00 UTC. */
function payload() {
  const t0 = Date.UTC(2025, 0, 1) / 1000;
  const time = Array.from({ length: 48 }, (_, i) => t0 + i * 3600);
  const day = (v: number) => time.map((_, i) => (i % 24 >= 8 && i % 24 <= 16 ? v : 0));
  return {
    hourly: {
      time,
      shortwave_radiation: day(300),
      direct_normal_irradiance: day(400),
      diffuse_radiation: day(100),
      temperature_2m: time.map(() => 5),
    },
  };
}

/** Two hours of 1000 W/m² → 2 kWh/m². */
function tinySeries(source: WeatherSeries['source'], year: number): WeatherSeries {
  return {
    source,
    year,
    latitude: 47.1,
    longitude: 7.45,
    stepMinutes: 60,
    timesUtc: [0, 3_600_000],
    ghi: [1000, 1000],
    dni: [800, 800],
    dhi: [200, 200],
    temperature: [15, 15],
  };
}

describe('WeatherSection', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.setState({ openSections: { weather: true } });
  });

  it('switches the data source', () => {
    render(<WeatherSection />);
    const openMeteo = screen.getByRole('radio', { name: 'Open-Meteo' });
    const clearSky = screen.getByRole('radio', { name: 'Klarer Himmel' });
    expect(openMeteo).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Wetterdaten von/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lizenz CC BY 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    );

    fireEvent.click(clearSky);
    expect(weatherConfig().source).toBe('clear-sky');
    expect(clearSky).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Synthetisches Jahr ohne Wolken/)).toBeInTheDocument();
    expect(screen.getByText('Beim klaren Himmel legt das Jahr nur den Kalender fest.')).toBeInTheDocument();
    expect(screen.queryByText(/Wetterdaten von/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Wetterdaten/ })).toHaveTextContent('Klarer Himmel');

    fireEvent.keyDown(clearSky, { key: 'ArrowLeft' });
    expect(weatherConfig().source).toBe('open-meteo');
  });

  it('offers every year from the latest complete one back to 1940', () => {
    render(<WeatherSection />);
    const select = screen.getByRole('combobox', { name: 'Jahr' });
    const years = Array.from((select as HTMLSelectElement).options, (o) => Number(o.value));
    const latest = latestCompleteWeatherYear(Date.now());
    expect(years[0]).toBe(latest);
    expect(years[years.length - 1]).toBe(1940);
    expect(years).toHaveLength(latest - 1940 + 1);
    fireEvent.change(select, { target: { value: '2020' } });
    expect(weatherConfig().year).toBe(2020);
  });

  it('keeps a stored year outside the list selectable', () => {
    act(() => useConfigStore.getState().patch('weather', { year: 2090 }));
    render(<WeatherSection />);
    expect(screen.getByRole('combobox', { name: 'Jahr' })).toHaveValue('2090');
  });

  it('shows the loading state and the annual irradiation of the loaded series', () => {
    useDataStore.getState().setWeather({ status: 'loading' });
    const { rerender } = render(<WeatherSection />);
    expect(screen.getByText('Wetterdaten 2025 werden geladen …')).toBeInTheDocument();

    act(() =>
      useDataStore.getState().setWeather({ status: 'ready', series: tinySeries('open-meteo', 2025) }),
    );
    rerender(<WeatherSection />);
    expect(screen.getByText('Wetterdaten 2025 geladen.')).toBeInTheDocument();
    expect(screen.getByText('Globalstrahlung (horizontal)').nextSibling).toHaveTextContent(
      /^2\skWh\/m² im Jahr$/,
    );
  });

  it('shows the annual irradiation of the clear-sky year', () => {
    act(() => useConfigStore.getState().patch('weather', { source: 'clear-sky' }));
    useDataStore.getState().setWeather({ status: 'ready', series: clearSkyYear(47.1, 7.45, 2025) });
    render(<WeatherSection />);
    expect(screen.getByText('Klarer Himmel berechnet.')).toBeInTheDocument();
    expect(screen.getByText('Globalstrahlung (horizontal)').nextSibling).toHaveTextContent(/kWh\/m² im Jahr/);
  });

  it('does not show a stale series from another year', () => {
    useDataStore.getState().setWeather({ status: 'ready', series: tinySeries('open-meteo', 2019) });
    render(<WeatherSection />);
    expect(screen.queryByText('Globalstrahlung (horizontal)')).not.toBeInTheDocument();
  });

  it('warns about the clear-sky fallback and retries Open-Meteo', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockImplementation(async () => jsonResponse(payload()));
    vi.stubGlobal('fetch', fetchMock);
    render(<WithLoader />);
    await waitFor(() => expect(useDataStore.getState().weather.usingFallback).toBe(true));
    expect(screen.getByText(/Open-Meteo ist nicht erreichbar/)).toBeInTheDocument();
    expect(screen.getByText('Keine Verbindung zum Server (offline oder blockiert).')).toBeInTheDocument();
    expect(screen.getByText('network down')).toHaveAttribute('lang', 'en');

    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(useDataStore.getState().weather.status).toBe('ready'));
    const w = useDataStore.getState().weather;
    expect(w.usingFallback).toBe(false);
    expect(w.series?.source).toBe('open-meteo');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Wetterdaten 2025 geladen.')).toBeInTheDocument();
  });

  it('translates the load error and keeps the raw message only as marked-up English details', () => {
    useDataStore.getState().setWeather({
      status: 'error',
      series: clearSkyYear(47.1, 7.45, 2025),
      error: 'Failed to fetch',
      usingFallback: true,
    });
    const { container } = render(<WeatherSection />);
    expect(screen.getByText('Keine Verbindung zum Server (offline oder blockiert).')).toBeInTheDocument();
    const raw = screen.getByText('Failed to fetch');
    expect(raw.closest('[lang]')).toHaveAttribute('lang', 'en');
    expect(raw).toHaveAttribute('translate', 'no');
    expect(raw.closest('details')).not.toHaveAttribute('open');
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it('names the HTTP status of a failed request', () => {
    useDataStore.getState().setWeather({
      status: 'error',
      series: clearSkyYear(47.1, 7.45, 2025),
      error: 'Open-Meteo: HTTP 500 – test',
      usingFallback: true,
    });
    render(<WeatherSection />);
    expect(screen.getByText('Der Server hat mit Fehler 500 geantwortet.')).toBeInTheDocument();
  });

  it('drops a retried result when the year changed meanwhile', async () => {
    let resolveFirstRetry: (r: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockImplementationOnce(() => new Promise<Response>((r) => (resolveFirstRetry = r)))
      .mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    render(<WithLoader />);
    await waitFor(() => expect(useDataStore.getState().weather.status).toBe('error'));
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    act(() => useConfigStore.getState().patch('weather', { year: 2020 }));
    await act(async () => resolveFirstRetry(jsonResponse(payload())));
    // The 2025 response arrives after the switch to 2020 and must not be used.
    expect(useDataStore.getState().weather.series?.source).not.toBe('open-meteo');
  });

  it('renders in English', () => {
    useUiStore.getState().setLang('en');
    render(<WeatherSection />);
    expect(screen.getByRole('radiogroup', { name: 'Data source' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Clear sky' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Year' })).toBeInTheDocument();
    expect(screen.getByText(/Weather data by/)).toBeInTheDocument();
  });
});
