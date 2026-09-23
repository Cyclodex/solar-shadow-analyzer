import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { resetStores } from '../test/utils';
import { useWeatherLoader } from './useWeather';

/** Minimal Open-Meteo archive payload: `hours` hourly stamps from 1 Jan 2025 00:00 UTC. */
function payload(hours: number) {
  const t0 = Date.UTC(2025, 0, 1) / 1000;
  const time = Array.from({ length: hours }, (_, i) => t0 + i * 3600);
  return {
    hourly: {
      time,
      shortwave_radiation: time.map((_, i) => (i % 24 >= 8 && i % 24 <= 16 ? 300 : 0)),
      direct_normal_irradiance: time.map((_, i) => (i % 24 >= 8 && i % 24 <= 16 ? 400 : 0)),
      diffuse_radiation: time.map((_, i) => (i % 24 >= 8 && i % 24 <= 16 ? 100 : 0)),
      temperature_2m: time.map(() => 5),
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('useWeatherLoader', () => {
  beforeEach(resetStores);

  it('loads the Open-Meteo year', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(payload(48)));
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useWeatherLoader());
    expect(useDataStore.getState().weather.status).toBe('loading');
    await waitFor(() => expect(useDataStore.getState().weather.status).toBe('ready'));
    const w = useDataStore.getState().weather;
    expect(w.series?.source).toBe('open-meteo');
    expect(w.series?.ghi.length).toBe(48);
    expect(w.usingFallback).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('archive-api.open-meteo.com');
  });

  it('falls back to the clear-sky year when the request fails', async () => {
    // Default test fetch rejects (network disabled).
    renderHook(() => useWeatherLoader());
    await waitFor(() => expect(useDataStore.getState().weather.status).toBe('error'));
    const w = useDataStore.getState().weather;
    expect(w.usingFallback).toBe(true);
    expect(w.error).toMatch(/network disabled/);
    expect(w.series?.source).toBe('clear-sky');
    expect(w.series?.year).toBe(useConfigStore.getState().config.weather.year);
  });

  it('uses the clear-sky year without network when selected', () => {
    useConfigStore.getState().patch('weather', { source: 'clear-sky' });
    renderHook(() => useWeatherLoader());
    const w = useDataStore.getState().weather;
    expect(w.status).toBe('ready');
    expect(w.series?.source).toBe('clear-sky');
    expect(fetch).not.toHaveBeenCalled();
  });
});
