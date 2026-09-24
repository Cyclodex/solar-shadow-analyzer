import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, LIMITS } from './defaults';
import {
  GEOCODING_URL,
  LOCATION_PRESETS,
  MODULE_PRESETS,
  findLocationPreset,
  findModulePreset,
  geocodingResultToLocation,
  presetToLocation,
  searchLocations,
} from './presets';
import { canonicalTimeZone, sanitizeConfig } from './share';
import { roundToStep } from './units';

/**
 * Raw Open-Meteo geocoding values [latitude, longitude, elevation, timezone] as returned on 2026-09-23
 * (language=de, countryCode filter, first PPL* result; Sion queried as "Sitten").
 */
const RAW_GEOCODING: Record<string, [number, number, number, string]> = {
  bern: [46.94809, 7.44744, 549, 'Europe/Zurich'],
  zuerich: [47.36667, 8.55, 429, 'Europe/Zurich'],
  basel: [47.55839, 7.57327, 279, 'Europe/Zurich'],
  geneve: [46.20222, 6.14569, 400, 'Europe/Zurich'],
  lausanne: [46.516, 6.63282, 453, 'Europe/Zurich'],
  luzern: [47.05048, 8.30635, 437, 'Europe/Zurich'],
  'st-gallen': [47.42391, 9.37477, 684, 'Europe/Zurich'],
  lugano: [46.01008, 8.96004, 284, 'Europe/Zurich'],
  chur: [46.84986, 9.53287, 601, 'Europe/Zurich'],
  sion: [46.22739, 7.35559, 500, 'Europe/Zurich'],
  winterthur: [47.50564, 8.72413, 441, 'Europe/Zurich'],
  'biel-bienne': [47.13713, 7.24608, 434, 'Europe/Zurich'],
  thun: [46.75118, 7.62166, 560, 'Europe/Zurich'],
  fribourg: [46.80237, 7.15128, 610, 'Europe/Zurich'],
  wien: [48.20849, 16.37208, 171, 'Europe/Vienna'],
  innsbruck: [47.26266, 11.39454, 570, 'Europe/Vienna'],
  graz: [47.06733, 15.44197, 362, 'Europe/Vienna'],
  muenchen: [48.13743, 11.57549, 524, 'Europe/Berlin'],
  stuttgart: [48.78232, 9.17702, 252, 'Europe/Berlin'],
  'freiburg-im-breisgau': [47.9959, 7.85222, 278, 'Europe/Berlin'],
  berlin: [52.52437, 13.41053, 74, 'Europe/Berlin'],
  hamburg: [53.55073, 9.99302, 9, 'Europe/Berlin'],
  koeln: [50.93333, 6.95, 58, 'Europe/Berlin'],
  'frankfurt-am-main': [50.11552, 8.68417, 113, 'Europe/Berlin'],
};

/** Real response of GET /v1/search?name=Bern&count=5&language=de (2026-09-23), postcodes/population removed. */
const BERN_RESPONSE = {
  results: [
    {
      id: 2661552,
      name: 'Bern',
      latitude: 46.94809,
      longitude: 7.44744,
      elevation: 549.0,
      feature_code: 'PPLC',
      country_code: 'CH',
      admin1_id: 2661551,
      timezone: 'Europe/Zurich',
      country: 'Schweiz',
      admin1: 'Kanton Bern',
    },
    {
      id: 4918006,
      name: 'Berne',
      latitude: 40.65782,
      longitude: -84.95191,
      elevation: 258.0,
      feature_code: 'PPL',
      country_code: 'US',
      admin1_id: 4921868,
      timezone: 'America/Indiana/Indianapolis',
      country: 'Vereinigte Staaten',
      admin1: 'Indiana',
    },
    {
      id: 4268179,
      name: 'Bern',
      latitude: 39.96222,
      longitude: -95.97194,
      elevation: 390.0,
      feature_code: 'PPL',
      country_code: 'US',
      admin1_id: 4273857,
      timezone: 'America/Chicago',
      country: 'Vereinigte Staaten',
      admin1: 'Kansas',
    },
    {
      id: 2759053,
      name: 'Bern',
      latitude: 51.74833,
      longitude: 5.16528,
      elevation: 5.0,
      feature_code: 'PPL',
      country_code: 'NL',
      admin1_id: 2755634,
      timezone: 'Europe/Amsterdam',
      country: 'Niederlande',
      admin1: 'Gelderland',
    },
    {
      id: 5585377,
      name: 'Bern',
      latitude: 42.33965,
      longitude: -111.38604,
      elevation: 1819.0,
      feature_code: 'PPL',
      country_code: 'US',
      admin1_id: 5596512,
      timezone: 'America/Boise',
      country: 'Vereinigte Staaten',
      admin1: 'Idaho',
    },
  ],
  generationtime_ms: 1.0532141,
};

const REQUIRED_CITIES = [
  'Bern',
  'Zürich',
  'Basel',
  'Genève',
  'Lausanne',
  'Luzern',
  'St. Gallen',
  'Lugano',
  'Chur',
  'Sion',
  'Winterthur',
  'Biel/Bienne',
  'Thun',
  'Fribourg',
  'Wien',
  'Innsbruck',
  'Graz',
  'München',
  'Stuttgart',
  'Freiburg im Breisgau',
  'Berlin',
  'Hamburg',
  'Köln',
  'Frankfurt am Main',
];

describe('LOCATION_PRESETS', () => {
  it('contains the required cities with unique ids and names', () => {
    expect(LOCATION_PRESETS.map((p) => p.name).sort()).toEqual([...REQUIRED_CITIES].sort());
    expect(new Set(LOCATION_PRESETS.map((p) => p.id)).size).toBe(LOCATION_PRESETS.length);
  });

  it('matches the geocoding source values rounded to 4 decimals', () => {
    for (const p of LOCATION_PRESETS) {
      const raw = RAW_GEOCODING[p.id];
      expect(raw, p.id).toBeDefined();
      const [lat, lon, el, tz] = raw!;
      expect(p.latitude, p.id).toBe(roundToStep(lat, 1e-4));
      expect(p.longitude, p.id).toBe(roundToStep(lon, 1e-4));
      expect(p.elevation, p.id).toBe(el);
      expect(p.timezone, p.id).toBe(tz);
      expect(Math.abs(p.latitude - lat)).toBeLessThanOrEqual(5e-5 + 1e-12);
      expect(Math.abs(p.longitude - lon)).toBeLessThanOrEqual(5e-5 + 1e-12);
    }
    expect(Object.keys(RAW_GEOCODING)).toHaveLength(LOCATION_PRESETS.length);
  });

  it('survives sanitizeConfig unchanged and uses valid time zones', () => {
    for (const p of LOCATION_PRESETS) {
      const loc = presetToLocation(p);
      expect(sanitizeConfig({ location: loc }).location, p.id).toEqual(loc);
      expect(canonicalTimeZone(p.timezone)).toBe(p.timezone);
      expect(['CH', 'AT', 'DE']).toContain(p.country);
    }
  });

  it('findLocationPreset finds presets by coordinates', () => {
    for (const p of LOCATION_PRESETS) expect(findLocationPreset(presetToLocation(p))).toBe(p);
    const bern = LOCATION_PRESETS.find((p) => p.id === 'bern')!;
    expect(findLocationPreset({ latitude: bern.latitude + 4e-5, longitude: bern.longitude - 4e-5 })).toBe(
      bern,
    );
    expect(findLocationPreset({ latitude: bern.latitude + 1e-3, longitude: bern.longitude })).toBeUndefined();
    expect(findLocationPreset(DEFAULT_CONFIG.location)).toBeUndefined();
  });
});

describe('MODULE_PRESETS', () => {
  it('have consistent labels, short side first, values within LIMITS and unchanged by sanitizeConfig', () => {
    expect(new Set(MODULE_PRESETS.map((m) => m.id)).size).toBe(MODULE_PRESETS.length);
    for (const m of MODULE_PRESETS) {
      // Label lists long × short side in mm (cm × 10), the power and the cell count.
      expect(m.label).toContain(`${Math.round(m.width * 10)}×${Math.round(m.length * 10)} mm`);
      expect(m.label).toContain(`${m.powerWp} Wp`);
      expect(m.label).toContain(`${m.cells} Zellen`);
      expect(m.label.startsWith('Typ. ')).toBe(true);
      expect(m.length).toBeLessThanOrEqual(m.width);
      const panels = { ...DEFAULT_CONFIG.panels, length: m.length, width: m.width, powerWp: m.powerWp };
      expect(sanitizeConfig({ panels }).panels).toEqual(panels);
      expect(m.length).toBeGreaterThanOrEqual(LIMITS.panels.length.min);
      expect(m.width).toBeLessThanOrEqual(LIMITS.panels.width.max);
    }
  });

  it('include the default module format; findModulePreset matches both orientations', () => {
    const d = DEFAULT_CONFIG.panels;
    const def = findModulePreset(d);
    expect(def?.id).toBe('c144-1762x1134');
    expect(findModulePreset({ length: d.width, width: d.length, powerWp: d.powerWp })).toBe(def);
    expect(findModulePreset({ ...d, powerWp: d.powerWp + 5 })).toBeUndefined();
  });
});

describe('geocodingResultToLocation', () => {
  it('maps Open-Meteo results ("Name, Canton, CC"; 4-decimal coordinates)', () => {
    const [bern, berneIn, bernKs, bernNl] = BERN_RESPONSE.results;
    // 46.94809 → 46.9481, 7.44744 → 7.4474 (4 decimals)
    expect(geocodingResultToLocation(bern)).toEqual({
      name: 'Bern, BE, CH',
      latitude: 46.9481,
      longitude: 7.4474,
      timezone: 'Europe/Zurich',
      elevation: 549,
    });
    // 40.65782 → 40.6578, −84.95191 → −84.9519
    expect(geocodingResultToLocation(berneIn)).toEqual({
      name: 'Berne, Indiana, US',
      latitude: 40.6578,
      longitude: -84.9519,
      timezone: 'America/Indiana/Indianapolis',
      elevation: 258,
    });
    expect(geocodingResultToLocation(bernKs)?.name).toBe('Bern, Kansas, US');
    // 51.74833 → 51.7483, 5.16528 → 5.1653
    expect(geocodingResultToLocation(bernNl)).toMatchObject({
      name: 'Bern, Gelderland, NL',
      latitude: 51.7483,
      longitude: 5.1653,
    });
  });

  it('omits a region that contains the place name as a word', () => {
    const base = {
      latitude: 52.52437,
      longitude: 13.41053,
      elevation: 74,
      timezone: 'Europe/Berlin',
      country_code: 'DE',
    };
    expect(geocodingResultToLocation({ ...base, name: 'Berlin', admin1: 'Land Berlin' })?.name).toBe(
      'Berlin, DE',
    );
    expect(
      geocodingResultToLocation({ ...base, name: 'Hamburg', admin1: 'Freie und Hansestadt Hamburg' })?.name,
    ).toBe('Hamburg, DE');
    expect(geocodingResultToLocation({ ...base, name: 'München', admin1: 'Bayern' })?.name).toBe(
      'München, Bayern, DE',
    );
    expect(geocodingResultToLocation({ ...base, name: 'Baden', admin1: 'Baden-Württemberg' })?.name).toBe(
      'Baden, Baden-Württemberg, DE',
    );
    // CH with an unknown admin1 id → region name kept
    expect(
      geocodingResultToLocation({ ...base, name: 'X', admin1: 'Kanton Y', admin1_id: 1, country_code: 'CH' })
        ?.name,
    ).toBe('X, Kanton Y, CH');
  });

  it('returns sanitizeConfig fixed points: long / control-character labels are normalized (regression)', () => {
    const base = {
      latitude: 48.1,
      longitude: 11.6,
      elevation: 520,
      timezone: 'Europe/Berlin',
      country_code: 'DE',
      admin1: 'Bayern',
    };
    // Label 'a'×100 + ', Bayern, DE' (112 code points) → first MAX_LOCATION_NAME_LENGTH = 80 code points = 'a'×80.
    const long = geocodingResultToLocation({ ...base, name: 'a'.repeat(100) });
    expect(long?.name).toBe('a'.repeat(80));
    // U+0000 → ' ' (control characters are replaced like in any location name).
    const ctrl = geocodingResultToLocation({ ...base, name: 'Ober\u0000dorf' });
    expect(ctrl?.name).toBe('Ober dorf, Bayern, DE');
    for (const loc of [long, ctrl, geocodingResultToLocation(BERN_RESPONSE.results[0])]) {
      expect(sanitizeConfig({ location: loc }).location).toEqual(loc);
    }
  });

  it('rejects results without coordinates, elevation or a valid time zone', () => {
    const ok = BERN_RESPONSE.results[0]!;
    expect(geocodingResultToLocation({ ...ok, timezone: 'Nowhere/Zone' })).toBeNull();
    expect(geocodingResultToLocation({ ...ok, timezone: undefined })).toBeNull();
    expect(geocodingResultToLocation({ ...ok, elevation: undefined })).toBeNull();
    expect(geocodingResultToLocation({ ...ok, latitude: '46.9' })).toBeNull();
    expect(geocodingResultToLocation({ ...ok, longitude: NaN })).toBeNull();
    expect(geocodingResultToLocation({ ...ok, name: '  ' })).toBeNull();
    expect(geocodingResultToLocation(null)).toBeNull();
    expect(geocodingResultToLocation('Bern')).toBeNull();
  });
});

describe('searchLocations', () => {
  type Call = { url: string; init: RequestInit | undefined };

  function mockFetch(respond: () => Promise<Response>): { fetchImpl: typeof fetch; calls: Call[] } {
    const calls: Call[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      calls.push({ url: String(input), init });
      return respond();
    };
    return { fetchImpl, calls };
  }

  const json = (body: unknown, status = 200): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    );

  it('queries Open-Meteo with name, count, language and passes the signal', async () => {
    const { fetchImpl, calls } = mockFetch(() => json(BERN_RESPONSE));
    const ctrl = new AbortController();
    const res = await searchLocations('  St. Gallen ', 'en', { fetchImpl, signal: ctrl.signal });
    expect(calls).toHaveLength(1);
    // encodeURIComponent('St. Gallen') = 'St.%20Gallen'
    expect(calls[0]!.url).toBe(`${GEOCODING_URL}?name=St.%20Gallen&count=10&language=en&format=json`);
    expect(calls[0]!.init?.signal).toBe(ctrl.signal);
    expect(res.map((r) => r.name)).toEqual([
      'Bern, BE, CH',
      'Berne, Indiana, US',
      'Bern, Kansas, US',
      'Bern, Gelderland, NL',
      'Bern, Idaho, US',
    ]);
  });

  it('drops invalid and duplicate results', async () => {
    const r0 = BERN_RESPONSE.results[0]!;
    const { fetchImpl } = mockFetch(() =>
      json({ results: [r0, { ...r0 }, { ...r0, timezone: 'Bad/Zone' }, 42] }),
    );
    expect(await searchLocations('Bern', 'de', { fetchImpl })).toHaveLength(1);
  });

  it('falls back to count=10 for a NaN count and clamps the count to 1…100 (regression)', async () => {
    const { fetchImpl, calls } = mockFetch(() => json({ results: [] }));
    for (const count of [NaN, 0, 1e9, Infinity, 7.4])
      await searchLocations('Bern', 'de', { fetchImpl, count });
    // NaN → default 10 (before the fix: 'count=NaN'); 0 → 1; 1e9 / Infinity → 100; 7.4 → round → 7.
    expect(calls.map((c) => new URL(c.url).searchParams.get('count'))).toEqual([
      '10',
      '1',
      '100',
      '100',
      '7',
    ]);
  });

  it('does not fetch for queries shorter than 2 characters', async () => {
    const { fetchImpl, calls } = mockFetch(() => json(BERN_RESPONSE));
    expect(await searchLocations(' B ', 'de', { fetchImpl })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('returns [] on network errors, aborts, HTTP errors, bad JSON and empty results', async () => {
    const cases: (() => Promise<Response>)[] = [
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.reject(new DOMException('Aborted', 'AbortError')),
      () => json({ error: true, reason: 'x' }, 400),
      () => Promise.resolve(new Response('<html>', { status: 200 })),
      () => json({ generationtime_ms: 0.5 }),
      () => json([]),
    ];
    for (const respond of cases) {
      const { fetchImpl } = mockFetch(respond);
      expect(await searchLocations('Bern', 'de', { fetchImpl })).toEqual([]);
    }
  });

  it('honours an aborted signal via fetch', async () => {
    const ctrl = new AbortController();
    const fetchImpl: typeof fetch = (_input, init) =>
      init?.signal?.aborted ? Promise.reject(new DOMException('Aborted', 'AbortError')) : json(BERN_RESPONSE);
    ctrl.abort();
    expect(await searchLocations('Bern', 'de', { fetchImpl, signal: ctrl.signal })).toEqual([]);
  });
});
