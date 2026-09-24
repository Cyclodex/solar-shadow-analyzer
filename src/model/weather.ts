import type { WeatherSeries } from './types';
import { MS_PER_DAY, MS_PER_MINUTE, daysInYear } from './time';
import { sunPosition } from './sun';
import { clearSkyIrradiance } from './irradiance';
import { getStorage, touchCacheEntry, writeCacheEntry } from './storageCache';

// ─────────────────────────────────────────────
// WEATHER SERIES
// Hourly irradiance + air temperature for one calendar year: Open-Meteo historical archive
// (model best_match: ERA5 reanalysis and ECMWF IFS analysis; CORS, no key) or a synthetic clear-sky year.
// timesUtc = interval midpoints.
// ─────────────────────────────────────────────

/** Air temperature of the synthetic clear-sky year, °C (no weather → constant, roughly the Swiss Plateau's mean daytime value). */
export const CLEAR_SKY_TEMPERATURE_C = 15;

/**
 * Synthetic clear-sky year (Meinel DNI, DHI = 0.1·DNI; see clearSkyIrradiance), intervals of `stepMinutes`
 * from 00:00 UTC on 1 January, each evaluated at its midpoint. Temperature is constant
 * CLEAR_SKY_TEMPERATURE_C. An upper bound of the yield ("theoretical maximum on clear days").
 */
export function clearSkyYear(
  latitude: number,
  longitude: number,
  year: number,
  stepMinutes = 60,
): WeatherSeries {
  if (!(stepMinutes > 0) || !Number.isFinite(stepMinutes))
    throw new RangeError(`Invalid step: ${stepMinutes}`);
  const start = Date.UTC(year, 0, 1);
  const n = Math.floor((daysInYear(year) * 1440) / stepMinutes + 1e-9);
  const stepMs = stepMinutes * MS_PER_MINUTE;
  const timesUtc = new Array<number>(n);
  const ghi = new Array<number>(n);
  const dni = new Array<number>(n);
  const dhi = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const t = start + (i + 0.5) * stepMs;
    const sun = sunPosition(t, latitude, longitude);
    const cs = clearSkyIrradiance(sun.altitude, Math.floor((t - start) / MS_PER_DAY) + 1);
    timesUtc[i] = t;
    ghi[i] = cs.ghi;
    dni[i] = cs.dni;
    dhi[i] = cs.dhi;
  }
  return {
    source: 'clear-sky',
    year,
    latitude,
    longitude,
    stepMinutes,
    timesUtc,
    ghi,
    dni,
    dhi,
    temperature: new Array<number>(n).fill(CLEAR_SKY_TEMPERATURE_C),
  };
}

// ── Open-Meteo ───────────────────────────────

/** Open-Meteo historical weather API (ERA5 family / ECMWF IFS analysis, CORS, no key). */
export const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

/** Hourly variables requested, in the order of the WeatherSeries fields ghi, dni, dhi, temperature. */
const HOURLY_VARS = [
  'shortwave_radiation',
  'direct_normal_irradiance',
  'diffuse_radiation',
  'temperature_2m',
] as const;

/** More missing radiation hours than this share → the year is treated as incomplete (error). */
export const MAX_MISSING_SHARE = 0.01;

/** Options of fetchOpenMeteoYear. */
export interface OpenMeteoOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Read/write the localStorage cache. Default true. */
  cache?: boolean;
  /**
   * Open-Meteo `models` parameter. Default: none = Open-Meteo "best_match" (for 2023 at 47.1° N 7.45° E this
   * returned exactly the `ecmwf_ifs` series; annual GHI within 0.3 % of PVGIS-SARAH3). 'era5' / 'era5_seamless'
   * select pure reanalysis (≈ 3.5 % lower GHI there, matching PVGIS-ERA5).
   */
  model?: string;
}

/** Coordinates are rounded to this many decimals (≈ 1 km) for the request and the cache key. */
const COORD_DECIMALS = 2;

/** `x` rounded to the request precision (−0.001 and 0.001 both give 0). */
const roundCoord = (x: number): number => Number(x.toFixed(COORD_DECIMALS));

/**
 * True if `series` is the weather of this site and year: coordinates compared at the request precision
 * (Open-Meteo series store the rounded coordinates, clear-sky series the exact ones). The source is not
 * compared: the clear-sky fallback after an Open-Meteo error belongs to the site as well.
 */
export function sameWeatherSite(
  series: Pick<WeatherSeries, 'latitude' | 'longitude' | 'year'>,
  latitude: number,
  longitude: number,
  year: number,
): boolean {
  return (
    series.year === year &&
    roundCoord(series.latitude) === roundCoord(latitude) &&
    roundCoord(series.longitude) === roundCoord(longitude)
  );
}

/** Request URL for one calendar year (UTC timestamps as Unix seconds). */
export function openMeteoUrl(latitude: number, longitude: number, year: number, model?: string): string {
  const q = new URLSearchParams({
    latitude: latitude.toFixed(COORD_DECIMALS),
    longitude: longitude.toFixed(COORD_DECIMALS),
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`,
    hourly: HOURLY_VARS.join(','),
    timezone: 'GMT',
    timeformat: 'unixtime',
  });
  if (model) q.set('models', model);
  return `${OPEN_METEO_ARCHIVE_URL}?${q.toString()}`;
}

const isNumArray = (a: unknown): a is (number | null)[] =>
  Array.isArray(a) && a.every((x) => x === null || (typeof x === 'number' && Number.isFinite(x)));

/** Radiation: null → 0, negative → 0. */
function radiation(a: (number | null)[]): number[] {
  return a.map((x) => (x !== null && x > 0 ? x : 0));
}

/** Temperature: nulls linearly interpolated between the nearest valid neighbours (edges: nearest value). */
function fillTemperature(a: (number | null)[]): number[] {
  const out = new Array<number>(a.length);
  let prev = -1;
  let prevX = CLEAR_SKY_TEMPERATURE_C; // only used if every value is missing
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === null) continue;
    for (let j = prev + 1; j < i; j++)
      out[j] = prev < 0 ? x : prevX + ((x - prevX) * (j - prev)) / (i - prev);
    out[i] = x;
    prev = i;
    prevX = x;
  }
  for (let j = prev + 1; j < a.length; j++) out[j] = prevX;
  return out;
}

/**
 * Converts an Open-Meteo archive JSON response (timeformat=unixtime, timezone=GMT) into a WeatherSeries.
 * Radiation values are means over the PRECEDING hour, so each timestamp t becomes the midpoint t − 30 min.
 * Throws if the payload is malformed or more than MAX_MISSING_SHARE of the GHI hours are missing.
 */
export function parseOpenMeteo(
  json: unknown,
  latitude: number,
  longitude: number,
  year: number,
): WeatherSeries {
  const root = json as { hourly?: Record<string, unknown>; error?: unknown; reason?: unknown } | null;
  if (root && root.error) throw new Error(`Open-Meteo: ${String(root.reason ?? 'error')}`);
  const h = root?.hourly;
  const time = h?.time;
  if (!h || !isNumArray(time) || time.length < 2 || time.some((t) => t === null)) {
    throw new Error('Open-Meteo: malformed response (hourly.time)');
  }
  const cols = HOURLY_VARS.map((k) => h[k]);
  if (!cols.every((c): c is (number | null)[] => isNumArray(c) && c.length === time.length)) {
    throw new Error('Open-Meteo: malformed response (hourly values)');
  }
  const times = time as number[];
  const stepSec = times[1] - times[0];
  if (!(stepSec > 0) || times.some((t, i) => i > 0 && t - times[i - 1] !== stepSec)) {
    throw new Error('Open-Meteo: irregular time axis');
  }
  const missing = cols[0].filter((x) => x === null).length;
  if (missing > MAX_MISSING_SHARE * times.length) {
    throw new Error(`Open-Meteo: ${missing} of ${times.length} hours missing (year ${year} incomplete?)`);
  }
  const half = (stepSec * 1000) / 2;
  return {
    source: 'open-meteo',
    year,
    latitude,
    longitude,
    stepMinutes: stepSec / 60,
    timesUtc: times.map((t) => t * 1000 - half),
    ghi: radiation(cols[0]),
    dni: radiation(cols[1]),
    dhi: radiation(cols[2]),
    temperature: fillTemperature(cols[3]),
  };
}

// ── localStorage cache ───────────────────────

const CACHE_PREFIX = 'ssa.weather.v1:';
/** Cached years (≈ 120 kB each; the least recently used one is evicted). */
export const WEATHER_CACHE_MAX = 3;

interface StoredSeries {
  /** Last use (see storageCache). */
  t: number;
  /** First interval midpoint, UTC ms. */
  t0: number;
  step: number;
  g: number[];
  b: number[];
  d: number[];
  T: number[];
}

function cacheKey(lat: number, lon: number, year: number, model: string | undefined): string {
  return `${CACHE_PREFIX}${lat.toFixed(COORD_DECIMALS)},${lon.toFixed(COORD_DECIMALS)},${year},${model ?? ''}`;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** Cached series (refreshing its last-use stamp), or null if absent or invalid. */
function readCache(key: string, lat: number, lon: number, year: number): WeatherSeries | null {
  try {
    const storage = getStorage();
    const raw = storage?.getItem(key);
    if (!storage || !raw) return null;
    const s = JSON.parse(raw) as Partial<StoredSeries>;
    const { g, b, d, T, t0, step } = s;
    const ok = (a: unknown): a is number[] =>
      Array.isArray(a) && a.every((x) => typeof x === 'number' && Number.isFinite(x));
    if (
      !ok(g) ||
      !ok(b) ||
      !ok(d) ||
      !ok(T) ||
      typeof t0 !== 'number' ||
      typeof step !== 'number' ||
      !(step > 0)
    ) {
      return null;
    }
    const n = g.length;
    if (n < 2 || b.length !== n || d.length !== n || T.length !== n) return null;
    touchCacheEntry(storage, key, s);
    const stepMs = step * MS_PER_MINUTE;
    return {
      source: 'open-meteo',
      year,
      latitude: lat,
      longitude: lon,
      stepMinutes: step,
      timesUtc: Array.from({ length: n }, (_, i) => t0 + i * stepMs),
      ghi: g,
      dni: b,
      dhi: d,
      temperature: T,
    };
  } catch {
    return null;
  }
}

function writeCache(key: string, w: WeatherSeries): void {
  const storage = getStorage();
  if (!storage) return;
  const value: Omit<StoredSeries, 't'> = {
    t0: w.timesUtc[0],
    step: w.stepMinutes,
    g: w.ghi.map(round1),
    b: w.dni.map(round1),
    d: w.dhi.map(round1),
    T: w.temperature.map(round1),
  };
  writeCacheEntry(storage, CACHE_PREFIX, WEATHER_CACHE_MAX, key, value);
}

/**
 * Hourly weather of one calendar year from the Open-Meteo archive (GHI, DNI, DHI, 2 m air temperature).
 * Timestamps are requested in UTC; each value is the mean of the preceding hour, so timesUtc = t − 30 min.
 * The series covers 00:00–23:00 UTC stamps, i.e. the intervals from 31 Dec 23:00 (previous year) to
 * 31 Dec 23:00 — a one-hour shift at the year boundary. Coordinates are rounded to 0.01°.
 * The result is cached in localStorage (the WEATHER_CACHE_MAX most recently used years, keyed by rounded
 * lat/lon, year, model).
 * Rejects on HTTP/API errors, malformed data, an incomplete year, or abort (signal's reason).
 */
export async function fetchOpenMeteoYear(
  latitude: number,
  longitude: number,
  year: number,
  opts: OpenMeteoOptions = {},
): Promise<WeatherSeries> {
  const lat = roundCoord(latitude);
  const lon = roundCoord(longitude);
  const useCache = opts.cache ?? true;
  const key = cacheKey(lat, lon, year, opts.model);
  if (useCache) {
    const hit = readCache(key, lat, lon, year);
    if (hit) return hit;
  }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const res = await fetchImpl(openMeteoUrl(lat, lon, year, opts.model), { signal: opts.signal });
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Open-Meteo: HTTP ${res.status}`);
  }
  if (!res.ok) {
    const reason = (json as { reason?: unknown } | null)?.reason;
    throw new Error(`Open-Meteo: HTTP ${res.status}${reason ? ` – ${String(reason)}` : ''}`);
  }
  const series = parseOpenMeteo(json, lat, lon, year);
  if (useCache) writeCache(key, series);
  return series;
}
