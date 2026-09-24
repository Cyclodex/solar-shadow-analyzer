/**
 * Validates the annual yield of the energy model (src/model/simulation.ts) against PVGIS.
 *
 *   npx tsx scripts/validate-yield.ts [--ref-dir DIR]
 *
 *   --ref-dir DIR   read/write the downloaded data in DIR (Open-Meteo series, PVGIS annual sums), so a run
 *                   can be repeated offline
 *
 * Setup: Bern (47.1° N, 7.45° E), one free-standing 1 kWp row (no facade, no horizon, no inverter limit),
 * 14 % system losses; β = 35° south, and β = 45° and 90° at azimuth 202° (the default facade).
 * Weather: Open-Meteo 2020–2023 with the model `era5` and with the app's default `best_match`.
 * Reference: PVGIS 5.3 `seriescalc` for the same years with PVGIS-ERA5 and PVGIS-SARAH3, and `PVcalc`
 * (PVGIS-SARAH3, mean of 2005–2023).
 *
 * Needs network (Open-Meteo, PVGIS API). Behind an HTTP proxy, Node's built-in fetch needs
 * NODE_USE_ENV_PROXY=1 (Node ≥ 22.21).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/model/defaults';
import { simulateYear } from '../src/model/simulation';
import type { Config, WeatherSeries } from '../src/model/types';
import { fetchOpenMeteoYear } from '../src/model/weather';

const LAT = 47.1;
const LON = 7.45;
const YEARS = [2020, 2021, 2022, 2023];
const LOSSES_PCT = 14;
const PVGIS_API = 'https://re.jrc.ec.europa.eu/api/v5_3';

interface Case {
  name: string;
  /** Tilt from horizontal, degrees. */
  beta: number;
  /** Azimuth the panel faces (0 = north, clockwise), degrees. */
  azimuth: number;
}

const CASES: Case[] = [
  { name: 'β 35°, south', beta: 35, azimuth: 180 },
  { name: 'β 45°, azimuth 202°', beta: 45, azimuth: 202 },
  { name: 'β 90°, azimuth 202°', beta: 90, azimuth: 202 },
];

/** Open-Meteo `models` values; undefined = the app's default (best_match). */
const WEATHER_MODELS: { label: string; model: string | undefined }[] = [
  { label: 'era5', model: 'era5' },
  { label: 'best_match', model: undefined },
];

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const refDir = option('--ref-dir');

/** `load()`, or its result stored in the ref dir by an earlier run. */
async function cached<T>(file: string, load: () => Promise<T>): Promise<T> {
  const path = refDir ? join(refDir, file) : null;
  if (path && existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as T;
  const value = await load();
  if (path) writeFileSync(path, JSON.stringify(value));
  return value;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return (await res.json()) as T;
}

/** PVGIS query of a case: 1 kWp, LOSSES_PCT, no horizon; PVGIS aspect 0 = south, −90 = east. */
function pvgisQuery(c: Case, extra: Record<string, string>): string {
  return new URLSearchParams({
    lat: String(LAT),
    lon: String(LON),
    peakpower: '1',
    loss: String(LOSSES_PCT),
    angle: String(c.beta),
    aspect: String(c.azimuth - 180),
    usehorizon: '0',
    outputformat: 'json',
    ...extra,
  }).toString();
}

/** PVGIS seriescalc: annual PV output per year of YEARS, kWh. */
function pvgisSeries(c: Case, db: 'PVGIS-ERA5' | 'PVGIS-SARAH3'): Promise<Record<string, number>> {
  return cached(`pvgis_series_${c.beta}_${c.azimuth}_${db}.json`, async () => {
    const query = pvgisQuery(c, {
      raddatabase: db,
      startyear: String(YEARS[0]),
      endyear: String(YEARS[YEARS.length - 1]),
      pvcalculation: '1',
    });
    const json = await getJson<{ outputs: { hourly: { time: string; P: number }[] } }>(
      `${PVGIS_API}/seriescalc?${query}`,
    );
    const byYear: Record<string, number> = {};
    for (const r of json.outputs.hourly) {
      const year = r.time.slice(0, 4);
      byYear[year] = (byYear[year] ?? 0) + r.P / 1000; // W for one hour → kWh
    }
    return byYear;
  });
}

/** PVGIS PVcalc: mean annual PV output of PVGIS-SARAH3 2005–2023, kWh. */
function pvgisPvcalc(c: Case): Promise<number> {
  return cached(`pvgis_pvcalc_${c.beta}_${c.azimuth}.json`, async () => {
    const json = await getJson<{ outputs: { totals: { fixed: { E_y: number } } } }>(
      `${PVGIS_API}/PVcalc?${pvgisQuery(c, {})}`,
    );
    return json.outputs.totals.fixed.E_y;
  });
}

function weatherSeries(model: string | undefined, year: number): Promise<WeatherSeries> {
  return cached(`openmeteo_${model ?? 'best_match'}_${year}.json`, () =>
    fetchOpenMeteoYear(LAT, LON, year, { cache: false, model }),
  );
}

/** The case as the app's config: one floor, one 1 kWp module, free-standing. */
function caseConfig(c: Case): Config {
  const config = structuredClone(DEFAULT_CONFIG);
  config.location = { ...config.location, latitude: LAT, longitude: LON };
  config.building = { ...config.building, numFloors: 1, facadeAzimuth: c.azimuth };
  config.panels = { ...config.panels, count: 1, powerWp: 1000, tiltFromVertical: 90 - c.beta };
  config.system = { ...config.system, lossesPct: LOSSES_PCT, inverterLimitW: Infinity };
  config.horizon = { ...config.horizon, terrainEnabled: false, obstacles: [], manual: [] };
  return config;
}

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
const deviation = (ours: number, ref: number): string => {
  const pct = (ours / ref - 1) * 100;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)} %`;
};

const weather = new Map<string, WeatherSeries[]>();
for (const { label, model } of WEATHER_MODELS) {
  const series: WeatherSeries[] = [];
  for (const year of YEARS) series.push(await weatherSeries(model, year));
  weather.set(label, series);
}

const period = `${YEARS[0]}–${YEARS[YEARS.length - 1]}`;
console.log(`Annual yield, 1 kWp free-standing at ${LAT}° N ${LON}° E, ${LOSSES_PCT} % losses (kWh)\n`);
for (const c of CASES) {
  const config = caseConfig(c);
  const series = {
    'PVGIS-ERA5': await pvgisSeries(c, 'PVGIS-ERA5'),
    'PVGIS-SARAH3': await pvgisSeries(c, 'PVGIS-SARAH3'),
  };
  const refs: [string, number][] = [
    [`PVGIS-ERA5 ${period}`, mean(YEARS.map((y) => series['PVGIS-ERA5'][y]))],
    [`PVGIS-SARAH3 ${period}`, mean(YEARS.map((y) => series['PVGIS-SARAH3'][y]))],
    ['PVGIS-SARAH3 2005–2023 (PVcalc)', await pvgisPvcalc(c)],
  ];
  console.log(`${c.name}: ${refs.map(([name, kwh]) => `${name} ${kwh.toFixed(1)}`).join(' | ')}`);
  for (const [label, list] of weather) {
    const ours = mean(list.map((w) => simulateYear(config, w, [null], { facade: false }).totalAnnualKwh));
    const vs = refs.map(([name, kwh]) => `${deviation(ours, kwh)} vs ${name}`).join(', ');
    console.log(`  model with Open-Meteo ${label.padEnd(10)} ${period}: ${ours.toFixed(1)} → ${vs}`);
  }
  console.log('');
}
