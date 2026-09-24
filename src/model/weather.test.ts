// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CLEAR_SKY_TEMPERATURE_C,
  OPEN_METEO_ARCHIVE_URL,
  WEATHER_CACHE_MAX,
  clearSkyYear,
  fetchOpenMeteoYear,
  openMeteoUrl,
  parseOpenMeteo,
  sameWeatherSite,
} from './weather';
import { clearSkyIrradiance } from './irradiance';
import { sunPosition } from './sun';

const HOUR = 3_600_000;

describe('clearSkyYear', () => {
  it('has one midpoint-stamped step per hour of the year', () => {
    const w = clearSkyYear(47.1, 7.45, 2023);
    expect(w.source).toBe('clear-sky');
    expect(w.stepMinutes).toBe(60);
    expect(w.timesUtc).toHaveLength(8760);
    expect(w.timesUtc[0]).toBe(Date.UTC(2023, 0, 1, 0, 30));
    expect(w.timesUtc[8759]).toBe(Date.UTC(2023, 11, 31, 23, 30));
    expect(clearSkyYear(47.1, 7.45, 2024).timesUtc).toHaveLength(8784);
    expect(clearSkyYear(47.1, 7.45, 2023, 15).timesUtc).toHaveLength(8760 * 4);
    expect(() => clearSkyYear(47.1, 7.45, 2023, 0)).toThrow(RangeError);
  });

  it('holds clearSkyIrradiance at the interval midpoint and a constant temperature', () => {
    const w = clearSkyYear(47.1, 7.45, 2023);
    // 2023-06-21 11:30 UTC = step 171·24 + 11 (doy 172).
    const i = 171 * 24 + 11;
    const ref = clearSkyIrradiance(sunPosition(w.timesUtc[i], 47.1, 7.45).altitude, 172);
    expect(w.ghi[i]).toBe(ref.ghi);
    expect(w.dni[i]).toBe(ref.dni);
    expect(w.dhi[i]).toBe(ref.dhi);
    expect(w.ghi[0]).toBe(0); // 00:30 UTC in January: night
    expect(new Set(w.temperature)).toEqual(new Set([CLEAR_SKY_TEMPERATURE_C]));
  });
});

// ── Open-Meteo ───────────────────────────────

/** Fake archive payload: `hours` hourly stamps from 2023-01-01 00:00 UTC. */
function payload(hours: number, over: Partial<Record<string, (number | null)[]>> = {}): unknown {
  const t0 = Date.UTC(2023, 0, 1) / 1000;
  const time = Array.from({ length: hours }, (_, i) => t0 + i * 3600);
  const fill = (v: number): number[] => new Array<number>(hours).fill(v);
  return {
    latitude: 47.065,
    longitude: 7.463,
    utc_offset_seconds: 0,
    hourly: {
      time,
      shortwave_radiation: fill(100),
      direct_normal_irradiance: fill(200),
      diffuse_radiation: fill(50),
      temperature_2m: fill(10),
      ...over,
    },
  };
}

function fakeFetch(
  body: unknown,
  status = 200,
): { fn: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fn, calls };
}

describe('parseOpenMeteo', () => {
  it('shifts preceding-hour means to the interval midpoint', () => {
    const w = parseOpenMeteo(payload(4), 47.1, 7.45, 2023);
    expect(w.source).toBe('open-meteo');
    expect(w.stepMinutes).toBe(60);
    expect(w.timesUtc).toEqual([-0.5, 0.5, 1.5, 2.5].map((h) => Date.UTC(2023, 0, 1) + h * HOUR));
    expect(w.ghi).toEqual([100, 100, 100, 100]);
    expect(w.dni).toEqual([200, 200, 200, 200]);
    expect(w.dhi).toEqual([50, 50, 50, 50]);
  });

  it('replaces missing/negative radiation by 0 and interpolates temperature', () => {
    const w = parseOpenMeteo(
      payload(200, {
        shortwave_radiation: [null, -2, ...new Array<number>(198).fill(5)],
        temperature_2m: [null, 4, null, null, 10, ...new Array<number>(194).fill(10), null],
      }),
      0,
      0,
      2023,
    );
    expect(w.ghi.slice(0, 3)).toEqual([0, 0, 5]);
    // Leading gap → first valid value; inner gap → linear 4 → 10 over 3 steps; trailing gap → last value.
    expect(w.temperature.slice(0, 5)).toEqual([4, 4, 6, 8, 10]);
    expect(w.temperature[199]).toBe(10);
  });

  it('rejects incomplete years, API errors and malformed payloads', () => {
    // 3 of 200 missing = 1.5 % > 1 %.
    const gappy = payload(200, {
      shortwave_radiation: [null, null, null, ...new Array<number>(197).fill(1)],
    });
    expect(() => parseOpenMeteo(gappy, 0, 0, 2023)).toThrow(/missing/);
    expect(() =>
      parseOpenMeteo({ error: true, reason: 'Parameter end_date out of range' }, 0, 0, 2023),
    ).toThrow(/end_date/);
    expect(() => parseOpenMeteo({ hourly: { time: [1, 2] } }, 0, 0, 2023)).toThrow(/malformed/);
    expect(() => parseOpenMeteo(null, 0, 0, 2023)).toThrow(/malformed/);
    const irregular = payload(3) as { hourly: { time: number[] } };
    irregular.hourly.time[2] += 60;
    expect(() => parseOpenMeteo(irregular, 0, 0, 2023)).toThrow(/irregular/);
  });
});

describe('sameWeatherSite', () => {
  const series = { year: 2023, latitude: 47.1, longitude: 7.45 };

  it('compares the year and the coordinates at the request precision (0.01°)', () => {
    expect(sameWeatherSite(series, 47.1004, 7.4496, 2023)).toBe(true);
    expect(sameWeatherSite(series, 47.1, 7.45, 2024)).toBe(false);
    expect(sameWeatherSite(series, 47.11, 7.45, 2023)).toBe(false);
    expect(sameWeatherSite(series, 47.1, 7.46, 2023)).toBe(false);
  });

  it('accepts exact (clear-sky) coordinates and the sign of zero', () => {
    expect(sameWeatherSite(clearSkyYear(46.0043, 8.9511, 2025), 46.0, 8.95, 2025)).toBe(true);
    expect(sameWeatherSite({ year: 2023, latitude: 0, longitude: -0 }, -0.001, 0.004, 2023)).toBe(true);
  });
});

describe('fetchOpenMeteoYear', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('requests one UTC year of the four hourly variables', async () => {
    const f = fakeFetch(payload(48));
    const ctrl = new AbortController();
    const w = await fetchOpenMeteoYear(47.1004, 7.4496, 2023, { fetchImpl: f.fn, signal: ctrl.signal });
    expect(f.calls).toHaveLength(1);
    const url = new URL(f.calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(OPEN_METEO_ARCHIVE_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '47.10',
      longitude: '7.45',
      start_date: '2023-01-01',
      end_date: '2023-12-31',
      hourly: 'shortwave_radiation,direct_normal_irradiance,diffuse_radiation,temperature_2m',
      timezone: 'GMT',
      timeformat: 'unixtime',
    });
    expect(f.calls[0].init?.signal).toBe(ctrl.signal);
    expect(w.latitude).toBe(47.1);
    expect(w.longitude).toBe(7.45);
    expect(w.timesUtc).toHaveLength(48);
    expect(openMeteoUrl(1, 2, 2020, 'era5')).toContain('models=era5');
  });

  it('serves the second call from localStorage', async () => {
    const f = fakeFetch(payload(48, { temperature_2m: new Array<number>(48).fill(3.14159) }));
    const a = await fetchOpenMeteoYear(47.1, 7.45, 2023, { fetchImpl: f.fn });
    const b = await fetchOpenMeteoYear(47.1, 7.45, 2023, { fetchImpl: f.fn });
    expect(f.calls).toHaveLength(1);
    expect(b.timesUtc).toEqual(a.timesUtc);
    expect(b.ghi).toEqual(a.ghi);
    expect(b.temperature[0]).toBe(3.1); // stored with 0.1 resolution
    await fetchOpenMeteoYear(47.1, 7.45, 2023, { fetchImpl: f.fn, cache: false });
    expect(f.calls).toHaveLength(2);
  });

  it(`keeps at most ${WEATHER_CACHE_MAX} years`, async () => {
    const f = fakeFetch(payload(24));
    for (let y = 2015; y < 2020; y++) await fetchOpenMeteoYear(47.1, 7.45, y, { fetchImpl: f.fn });
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k) =>
      k?.startsWith('ssa.weather'),
    );
    expect(keys).toHaveLength(WEATHER_CACHE_MAX);
  });

  it('evicts the least recently used year, not the first downloaded one', async () => {
    const f = fakeFetch(payload(24));
    const get = (y: number) => fetchOpenMeteoYear(47.1, 7.45, y, { fetchImpl: f.fn });
    for (let y = 2015; y < 2015 + WEATHER_CACHE_MAX; y++) await get(y);
    expect(f.calls).toHaveLength(WEATHER_CACHE_MAX);
    await get(2015); // cache hit, marks 2015 as used
    expect(f.calls).toHaveLength(WEATHER_CACHE_MAX);
    await get(2030); // evicts 2016, the least recently used year
    expect(f.calls).toHaveLength(WEATHER_CACHE_MAX + 1);
    await get(2015);
    expect(f.calls).toHaveLength(WEATHER_CACHE_MAX + 1);
    await get(2016);
    expect(f.calls).toHaveLength(WEATHER_CACHE_MAX + 2);
  });

  it('still caches a new year when other data fills the storage', async () => {
    const m = new Map<string, string>([['other.app', 'x'.repeat(20_000)]]);
    const size = (): number => [...m].reduce((a, [k, v]) => a + k.length + v.length, 0);
    const QUOTA = 21_100; // room for the foreign value and two of these small years (≈ 440 chars each)
    vi.stubGlobal('localStorage', {
      get length() {
        return m.size;
      },
      key: (i: number) => [...m.keys()][i] ?? null,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (size() - (m.get(k)?.length ?? 0) + (m.has(k) ? 0 : k.length) + v.length > QUOTA) {
          throw new DOMException('full', 'QuotaExceededError');
        }
        m.set(k, v);
      },
      removeItem: (k: string) => void m.delete(k),
    } as unknown as Storage);
    const f = fakeFetch(payload(24));
    for (let y = 2015; y < 2020; y++) await fetchOpenMeteoYear(47.1, 7.45, y, { fetchImpl: f.fn });
    expect(f.calls).toHaveLength(5);
    await fetchOpenMeteoYear(47.1, 7.45, 2019, { fetchImpl: f.fn });
    expect(f.calls).toHaveLength(5); // the newest year was cached despite the full storage
    expect(m.get('other.app')).toHaveLength(20_000);
  });

  it('ignores corrupt cache entries and works without localStorage', async () => {
    const f = fakeFetch(payload(24));
    await fetchOpenMeteoYear(47.1, 7.45, 2023, { fetchImpl: f.fn });
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('ssa.weather')) localStorage.setItem(k, '{"g":[1,2]');
    }
    await fetchOpenMeteoYear(47.1, 7.45, 2023, { fetchImpl: f.fn });
    expect(f.calls).toHaveLength(2);
    vi.stubGlobal('localStorage', undefined);
    const w = await fetchOpenMeteoYear(47.1, 7.45, 2023, { fetchImpl: f.fn });
    expect(w.ghi).toHaveLength(24);
  });

  it('rejects HTTP errors with the API reason and does not cache them', async () => {
    const f = fakeFetch({ error: true, reason: 'Daily API request limit exceeded' }, 429);
    await expect(fetchOpenMeteoYear(47.1, 7.45, 2023, { fetchImpl: f.fn })).rejects.toThrow(/429.*limit/);
    expect(localStorage.length).toBe(0);
  });

  it('propagates an abort', async () => {
    const ctrl = new AbortController();
    const fn = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const p = fetchOpenMeteoYear(47.1, 7.45, 2023, { fetchImpl: fn, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
