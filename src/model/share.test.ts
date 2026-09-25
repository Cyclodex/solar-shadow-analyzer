import { describe, it, expect } from 'vitest';
import type { Config } from './types';
import { DEFAULT_CONFIG, LIMITS, createObstacle, type FieldLimit } from './defaults';
import {
  HORIZON_POINT_LIMITS,
  MAX_CURRENCY_LENGTH,
  MAX_HORIZON_POINTS,
  MAX_LOCATION_NAME_LENGTH,
  MAX_OBSTACLES,
  MAX_TEXT_LENGTH,
  ROUNDING_OVERRIDES,
  SHARE_BASES,
  SHARE_VERSION,
  buildShareUrl,
  canonicalTimeZone,
  configFromJson,
  configToJson,
  decodeConfig,
  encodeConfig,
  formatCoordinateName,
  readConfigFromHash,
  sanitizeConfig,
} from './share';

// ── Test helpers ─────────────────────────────

type Rec = Record<string, unknown>;

/** mulberry32 PRNG (T. Ettinger, public domain) — deterministic fuzzing. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent base64url encoder (RFC 4648 §5, no padding), bit-by-bit from the spec. */
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function refBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = [2, 3, 4][Math.min(3, bytes.length - i) - 1] ?? 4; // 1 byte → 2 chars, 2 → 3, 3 → 4
    for (let k = 0; k < chars; k++) out += B64URL[(n >> (18 - 6 * k)) & 63];
  }
  return out;
}
const refEncodeJson = (json: string): string => refBase64Url(new TextEncoder().encode(json));

const SECTIONS = [
  'location',
  'building',
  'panels',
  'system',
  'horizon',
  'weather',
  'economics',
  'battery',
] as const;
const NUMERIC_SECTIONS = [
  'location',
  'building',
  'panels',
  'system',
  'weather',
  'economics',
  'battery',
] as const;

/** What a version-1 link (base 1) decodes to: config v3 with the battery section of base 2 (storage off). */
const V1_CONFIG: Config = { ...SHARE_BASES[1], version: 3, battery: SHARE_BASES[2]!.battery! };

function limitsOf(section: string): [string, FieldLimit][] {
  return Object.entries((LIMITS as unknown as Record<string, Record<string, FieldLimit>>)[section] ?? {});
}

function precisionOf(section: string, field: string, limit: FieldLimit): number {
  const o = (ROUNDING_OVERRIDES as unknown as Record<string, Record<string, number>>)[section];
  return o?.[field] ?? limit.step;
}

function onGrid(v: number, step: number): boolean {
  return Math.abs(v / step - Math.round(v / step)) < 1e-6;
}

const codePoints = (s: string): number => Array.from(s).length;

/** Asserts every invariant sanitizeConfig promises. */
function expectValid(c: Config): void {
  expect(c.version).toBe(3);
  expect(Object.keys(c).sort()).toEqual(['version', ...SECTIONS].sort());
  expect(typeof c.battery.enabled).toBe('boolean');
  expect(['shared', 'per-floor']).toContain(c.battery.layout);
  expect(['surplus', 'base-load', 'self-consumption']).toContain(c.battery.strategy);
  expect(['h0', 'flat']).toContain(c.battery.loadProfile);
  expect(c.battery.preset.length).toBeGreaterThan(0);
  for (const s of NUMERIC_SECTIONS) {
    const sec = c[s] as unknown as Rec;
    for (const [field, lim] of limitsOf(s)) {
      const v = sec[field];
      expect(typeof v, `${s}.${field}`).toBe('number');
      const n = v as number;
      expect(Number.isFinite(n), `${s}.${field}`).toBe(true);
      expect(n, `${s}.${field}`).toBeGreaterThanOrEqual(lim.min);
      expect(n, `${s}.${field}`).toBeLessThanOrEqual(lim.max);
      expect(onGrid(n, precisionOf(s, field, lim)), `${s}.${field}=${n}`).toBe(true);
    }
  }
  expect(typeof c.location.name).toBe('string');
  expect(c.location.name.length).toBeGreaterThan(0);
  expect(codePoints(c.location.name)).toBeLessThanOrEqual(MAX_LOCATION_NAME_LENGTH);
  expect(canonicalTimeZone(c.location.timezone)).toBe(c.location.timezone);
  expect(['linear', 'substring']).toContain(c.system.shadingModel);
  expect(['open-meteo', 'clear-sky']).toContain(c.weather.source);
  expect(typeof c.horizon.terrainEnabled).toBe('boolean');
  expect(c.economics.currency.length).toBeGreaterThan(0);
  expect(codePoints(c.economics.currency)).toBeLessThanOrEqual(MAX_CURRENCY_LENGTH);

  expect(c.horizon.obstacles.length).toBeLessThanOrEqual(MAX_OBSTACLES);
  expect(new Set(c.horizon.obstacles.map((o) => o.id)).size).toBe(c.horizon.obstacles.length);
  for (const o of c.horizon.obstacles) {
    expect(o.id.length).toBeGreaterThan(0);
    expect(codePoints(o.id)).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(codePoints(o.name)).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    for (const [field, lim] of limitsOf('obstacle')) {
      const n = (o as unknown as Rec)[field] as number;
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(lim.min);
      expect(n).toBeLessThanOrEqual(lim.max);
      expect(onGrid(n, lim.step)).toBe(true);
    }
  }
  expect(c.horizon.manual.length).toBeLessThanOrEqual(MAX_HORIZON_POINTS);
  c.horizon.manual.forEach((p, i) => {
    expect(p.azimuth).toBeGreaterThanOrEqual(0);
    expect(p.azimuth).toBeLessThan(360);
    expect(p.elevation).toBeGreaterThanOrEqual(HORIZON_POINT_LIMITS.elevation.min);
    expect(p.elevation).toBeLessThanOrEqual(HORIZON_POINT_LIMITS.elevation.max);
    if (i > 0) expect(p.azimuth).toBeGreaterThan(c.horizon.manual[i - 1]!.azimuth);
  });
}

const STRING_ALPHABET = [
  'a',
  'Z',
  '0',
  'ü',
  'é',
  'ß',
  ' ',
  '"',
  '\\',
  '/',
  '&',
  '#',
  '=',
  '%',
  '+',
  '🌞',
  '漢',
  "'",
  '-',
  '_',
  '.',
];
const TIMEZONES = [
  'Europe/Zurich',
  'Europe/Berlin',
  'America/New_York',
  'Asia/Kolkata',
  'Australia/Sydney',
  'UTC',
  'Pacific/Chatham',
];

function randomString(rnd: () => number, maxLen: number): string {
  let s = '';
  const len = Math.floor(rnd() * maxLen);
  for (let i = 0; i < len; i++) s += STRING_ALPHABET[Math.floor(rnd() * STRING_ALPHABET.length)];
  return s;
}

function pickOne<T>(rnd: () => number, items: readonly T[]): T {
  return items[Math.floor(rnd() * items.length)]!;
}

/** Random (mostly valid, off-grid) raw config; each field keeps its default with probability 1/2. */
function randomRawConfig(rnd: () => number): Rec {
  const raw: Rec = { version: 3 };
  for (const s of SECTIONS) {
    const sec: Rec = { ...(DEFAULT_CONFIG[s] as unknown as Rec) };
    for (const [field, lim] of limitsOf(s)) {
      if (rnd() < 0.5) sec[field] = lim.min + rnd() * (lim.max - lim.min);
    }
    raw[s] = sec;
  }
  const loc = raw.location as Rec;
  if (rnd() < 0.5) loc.name = randomString(rnd, 90);
  if (rnd() < 0.5) loc.timezone = pickOne(rnd, TIMEZONES);
  const sys = raw.system as Rec;
  if (rnd() < 0.5) sys.shadingModel = pickOne(rnd, ['linear', 'substring']);
  const wea = raw.weather as Rec;
  if (rnd() < 0.5) wea.source = pickOne(rnd, ['open-meteo', 'clear-sky']);
  const eco = raw.economics as Rec;
  if (rnd() < 0.5) eco.currency = pickOne(rnd, ['CHF', 'EUR', '€', 'US$']);
  const hor = raw.horizon as Rec;
  if (rnd() < 0.5) hor.terrainEnabled = rnd() < 0.5;
  if (rnd() < 0.5) {
    hor.obstacles = Array.from({ length: Math.floor(rnd() * 8) }, (_, i) => {
      const o: Rec = { id: rnd() < 0.8 ? `ob-${i}` : '', name: randomString(rnd, 50) };
      for (const [field, lim] of limitsOf('obstacle')) o[field] = lim.min + rnd() * (lim.max - lim.min);
      return o;
    });
  }
  if (rnd() < 0.5) {
    hor.manual = Array.from({ length: Math.floor(rnd() * 80) }, () =>
      rnd() < 0.5 ? [rnd() * 360, rnd() * 40] : { azimuth: rnd() * 360, elevation: rnd() * 40 },
    );
  }
  return raw;
}

/** Random value of a random JSON-ish type (incl. NaN, ±Infinity, huge numbers, nested junk). */
function garbage(rnd: () => number, depth = 0): unknown {
  const r = rnd();
  if (r < 0.1) return null;
  if (r < 0.15) return undefined;
  if (r < 0.2) return NaN;
  if (r < 0.25) return rnd() < 0.5 ? Infinity : -Infinity;
  if (r < 0.35) return (rnd() - 0.5) * 10 ** Math.floor(rnd() * 320);
  if (r < 0.45) return String((rnd() - 0.5) * 1e4);
  if (r < 0.55) return randomString(rnd, 30);
  if (r < 0.6) return rnd() < 0.5;
  if (r < 0.7) return '1e400';
  if (depth > 2) return 0;
  if (r < 0.85) return Array.from({ length: Math.floor(rnd() * 5) }, () => garbage(rnd, depth + 1));
  const o: Rec = {};
  for (let i = 0; i < 4; i++) o[randomString(rnd, 6) || 'k'] = garbage(rnd, depth + 1);
  return o;
}

// ── sanitizeConfig ───────────────────────────

describe('sanitizeConfig', () => {
  it('returns DEFAULT_CONFIG for non-object input', () => {
    for (const input of [null, undefined, 'config', 42, NaN, true, [], [1, 2], () => 1]) {
      expect(sanitizeConfig(input)).toEqual(DEFAULT_CONFIG);
    }
  });

  it('keeps DEFAULT_CONFIG unchanged (fixed point) and returns fresh objects', () => {
    const c = sanitizeConfig(DEFAULT_CONFIG);
    expect(c).toEqual(DEFAULT_CONFIG);
    expect(c).not.toBe(DEFAULT_CONFIG);
    expect(c.location).not.toBe(DEFAULT_CONFIG.location);
    expect(c.horizon.obstacles).not.toBe(DEFAULT_CONFIG.horizon.obstacles);
    expect(c.horizon.manual).not.toBe(DEFAULT_CONFIG.horizon.manual);
  });

  it('clamps every numeric field to LIMITS (expected = LIMITS min/max)', () => {
    const wrapped = new Set(['building.facadeAzimuth', 'location.longitude']);
    for (const s of NUMERIC_SECTIONS) {
      for (const [field, lim] of limitsOf(s)) {
        if (wrapped.has(`${s}.${field}`)) continue;
        const hi = sanitizeConfig({ [s]: { [field]: lim.max + 1000 } }) as unknown as Record<string, Rec>;
        const lo = sanitizeConfig({ [s]: { [field]: lim.min - 1000 } }) as unknown as Record<string, Rec>;
        expect(hi[s]![field], `${s}.${field}`).toBe(lim.max);
        expect(lo[s]![field], `${s}.${field}`).toBe(lim.min);
      }
    }
  });

  it('rounds to the LIMITS step, with the documented overrides', () => {
    const c = sanitizeConfig({
      location: { latitude: 46.948094, longitude: 7.447449 },
      building: { floorHeight: 280.4, numFloors: 2.6 },
      panels: { length: 113.44, gap: 2.3, powerWp: 432 },
      economics: { electricityPrice: 0.3214, feedInTariff: 0.08126, investmentPerFloor: 849 },
    });
    // 1e-4 grid: 46.948094 → 46.9481 (5th decimal 9 rounds up), 7.447449 → 7.4474 (5th decimal 4 rounds down)
    expect(c.location.latitude).toBe(46.9481);
    expect(c.location.longitude).toBe(7.4474);
    expect(c.building.floorHeight).toBe(280); // step 1
    expect(c.building.numFloors).toBe(3); // step 1: 2.6 → 3
    expect(c.panels.length).toBe(113.4); // step 0.1
    expect(c.panels.gap).toBe(2.5); // step 0.5: 2.3 / 0.5 = 4.6 → 5 → 2.5
    expect(c.panels.powerWp).toBe(432); // override 1 (odd ratings kept)
    expect(c.economics.electricityPrice).toBe(0.3214); // override 1e-4
    expect(c.economics.feedInTariff).toBe(0.0813); // 1e-4 grid: 812.6 → 813
    expect(c.economics.investmentPerFloor).toBe(849); // override 1
  });

  it('accepts numeric strings and falls back on NaN / Infinity / junk', () => {
    const c = sanitizeConfig({
      building: { facadeAzimuth: '180', floorHeight: ' 300 ', railingHeight: 'abc', balconyDepth: '' },
      panels: { count: NaN, gap: Infinity, width: null, length: {} },
      system: { lossesPct: '1e400' },
    });
    expect(c.building.facadeAzimuth).toBe(180);
    expect(c.building.floorHeight).toBe(300);
    expect(c.building.railingHeight).toBe(DEFAULT_CONFIG.building.railingHeight);
    expect(c.building.balconyDepth).toBe(DEFAULT_CONFIG.building.balconyDepth);
    expect(c.panels.count).toBe(DEFAULT_CONFIG.panels.count);
    expect(c.panels.gap).toBe(DEFAULT_CONFIG.panels.gap);
    expect(c.panels.width).toBe(DEFAULT_CONFIG.panels.width);
    expect(c.panels.length).toBe(DEFAULT_CONFIG.panels.length);
    expect(c.system.lossesPct).toBe(DEFAULT_CONFIG.system.lossesPct); // Number('1e400') = Infinity
  });

  it('wraps azimuths and longitudes instead of clamping', () => {
    const az = (v: number): number =>
      sanitizeConfig({ building: { facadeAzimuth: v } }).building.facadeAzimuth;
    expect(az(-22)).toBe(338); // −22 + 360
    expect(az(725)).toBe(5); // 725 − 2·360
    expect(az(359.6)).toBe(0); // rounds to 360 ≡ 0
    expect(az(359.4)).toBe(359);
    const lon = (v: number): number => sanitizeConfig({ location: { longitude: v } }).location.longitude;
    expect(lon(190)).toBe(-170); // 190 − 360
    expect(lon(-190)).toBe(170); // −190 + 360
    expect(lon(180)).toBe(180); // in range: kept
    expect(lon(-180)).toBe(-180);
  });

  it('validates enums, booleans and strings', () => {
    const c = sanitizeConfig({
      system: { shadingModel: 'quantum' },
      weather: { source: 'linear' },
      horizon: { terrainEnabled: 'false' },
      economics: { currency: '   ' },
    });
    expect(c.system.shadingModel).toBe(DEFAULT_CONFIG.system.shadingModel);
    expect(c.weather.source).toBe(DEFAULT_CONFIG.weather.source);
    expect(c.horizon.terrainEnabled).toBe(DEFAULT_CONFIG.horizon.terrainEnabled);
    expect(c.economics.currency).toBe(DEFAULT_CONFIG.economics.currency);
    const d = sanitizeConfig({
      system: { shadingModel: 'linear' },
      weather: { source: 'clear-sky' },
      horizon: { terrainEnabled: false },
      economics: { currency: ' EUR ' },
    });
    expect(d.system.shadingModel).toBe('linear');
    expect(d.weather.source).toBe('clear-sky');
    expect(d.horizon.terrainEnabled).toBe(false);
    expect(d.economics.currency).toBe('EUR');
  });

  it('rejects unknown time zones and canonicalizes known ones', () => {
    const tz = (v: unknown): string => sanitizeConfig({ location: { timezone: v } }).location.timezone;
    expect(tz('Mars/Olympus_Mons')).toBe(DEFAULT_CONFIG.location.timezone);
    expect(tz(42)).toBe(DEFAULT_CONFIG.location.timezone);
    expect(tz('')).toBe(DEFAULT_CONFIG.location.timezone);
    expect(tz('America/New_York')).toBe('America/New_York');
    // Expected value from Intl itself (canonical IANA casing), not hard-coded.
    const canonical = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Vienna' }).resolvedOptions().timeZone;
    expect(tz('europe/vienna')).toBe(canonical);
  });

  it('derives a coordinate name when the location name is missing, trims and truncates names', () => {
    expect(sanitizeConfig({ location: { latitude: 46, longitude: -8.5 } }).location.name).toBe(
      '46.000° N, 8.500° W',
    );
    expect(sanitizeConfig({ location: { name: '  Bern \n' } }).location.name).toBe('Bern');
    const long = 'x'.repeat(MAX_LOCATION_NAME_LENGTH + 20);
    expect(sanitizeConfig({ location: { name: long } }).location.name).toBe(
      'x'.repeat(MAX_LOCATION_NAME_LENGTH),
    );
    expect(sanitizeConfig({ location: { name: 'a\u0000b\u0007c' } }).location.name).toBe('a b c');
  });

  it('sanitizes obstacles: cap, skip junk, fill defaults, unique ids, text limits', () => {
    const many = Array.from({ length: MAX_OBSTACLES + 5 }, (_, i) => ({ id: `x${i}`, name: `N${i}` }));
    expect(sanitizeConfig({ horizon: { obstacles: many } }).horizon.obstacles).toHaveLength(MAX_OBSTACLES);

    const emoji = '🌞'.repeat(MAX_TEXT_LENGTH + 5); // 45 code points, 90 UTF-16 units
    const c = sanitizeConfig({
      horizon: {
        obstacles: [
          'junk',
          null,
          { id: 'a', name: '  Haus  ', distance: 0, height: 1e6, width: 'wide' },
          { id: 'a', name: emoji },
          { name: 'no id' },
        ],
      },
    });
    const obs = c.horizon.obstacles;
    const d = createObstacle('', '');
    expect(obs).toHaveLength(3);
    expect(obs[0]).toEqual({
      id: 'a',
      name: 'Haus',
      offsetAlong: d.offsetAlong,
      distance: LIMITS.obstacle.distance.min,
      width: d.width,
      depth: d.depth,
      height: LIMITS.obstacle.height.max,
    });
    expect(obs[1]!.id).not.toBe('a');
    expect(obs[1]!.name).toBe('🌞'.repeat(MAX_TEXT_LENGTH));
    expect(new Set(obs.map((o) => o.id)).size).toBe(3);
    expectValid(c);
  });

  it('sanitizes manual horizon points: tuples/objects, wrap, clamp, sort, dedupe (max), cap', () => {
    const c = sanitizeConfig({
      horizon: {
        manual: [
          [370, 5], // → azimuth 10
          { azimuth: -10, elevation: 95 }, // → 350, elevation clamped to 90
          [180, -5], // elevation clamped to 0
          [10.04, 7], // rounds to 10.0 → duplicate of 10 → max(5, 7)
          'junk',
          [NaN, 3],
        ],
      },
    });
    expect(c.horizon.manual).toEqual([
      { azimuth: 10, elevation: 7 },
      { azimuth: 180, elevation: 0 },
      { azimuth: 350, elevation: 90 },
    ]);
    // 1000 distinct azimuths (0.3° apart) → only the first MAX_HORIZON_POINTS are kept
    const pts = Array.from({ length: 1000 }, (_, i) => [i * 0.3, 1]);
    expect(sanitizeConfig({ horizon: { manual: pts } }).horizon.manual).toHaveLength(MAX_HORIZON_POINTS);
    const huge = new Array<unknown>(200_000).fill([12, 3]);
    expect(sanitizeConfig({ horizon: { manual: huge } }).horizon.manual).toEqual([
      { azimuth: 12, elevation: 3 },
    ]);
  });

  it('migrates flat v1 configs', () => {
    // Shape of the v1 app config (src/types.ts), values changed from its defaults.
    const v1 = {
      latitude: 46.95,
      longitude: 7.44,
      facadeAzimuth: 180,
      balconyHeight: 300,
      railingHeight: 110,
      panelLength: 100,
      panelWidth: 170,
      numPanels: 3,
      numFloors: 4,
      panelTilt: 30,
      panelThickness: 3,
    };
    const c = sanitizeConfig(v1);
    expect(c).toEqual({
      ...DEFAULT_CONFIG,
      location: { ...DEFAULT_CONFIG.location, name: '46.950° N, 7.440° E', latitude: 46.95, longitude: 7.44 },
      building: {
        ...DEFAULT_CONFIG.building,
        facadeAzimuth: 180,
        floorHeight: 300,
        railingHeight: 110,
        numFloors: 4,
      },
      panels: { ...DEFAULT_CONFIG.panels, length: 100, width: 170, count: 3, tiltFromVertical: 30 },
      horizon: { ...DEFAULT_CONFIG.horizon, obstacles: [], manual: [] },
    });
  });

  it('is immune to prototype pollution and drops unknown keys', () => {
    const input: unknown = JSON.parse(
      '{"__proto__":{"polluted":true},"building":{"__proto__":{"polluted":true},"facadeAzimuth":90},"extra":1}',
    );
    const c = sanitizeConfig(input);
    expect(({} as Rec).polluted).toBeUndefined();
    expect(Object.keys(c).sort()).toEqual(['version', ...SECTIONS].sort());
    expect(c.building.facadeAzimuth).toBe(90);
    expect(Object.keys(c.building).sort()).toEqual(Object.keys(DEFAULT_CONFIG.building).sort());
  });

  it('reads only own properties: inherited / polluted prototype values are ignored (regression)', () => {
    // Sections, obstacles and horizon points whose fields exist only on the prototype chain.
    const input = {
      location: Object.create({ latitude: 5, name: 'inherited' }) as Rec,
      building: Object.assign(Object.create({ facadeAzimuth: 90 }) as Rec, { floorHeight: 300 }),
      horizon: {
        obstacles: [Object.assign(Object.create({ height: 99 }) as Rec, { id: 'a' })],
        manual: [
          Object.assign(Object.create({ elevation: 30 }) as Rec, { azimuth: 10 }),
          { azimuth: 20, elevation: 5 },
        ],
      },
    };
    expect(sanitizeConfig(input)).toEqual({
      ...DEFAULT_CONFIG,
      building: { ...DEFAULT_CONFIG.building, floorHeight: 300 },
      horizon: {
        ...DEFAULT_CONFIG.horizon,
        obstacles: [{ ...createObstacle('a', ''), id: 'a' }],
        manual: [{ azimuth: 20, elevation: 5 }],
      },
    });
    // A polluted Object.prototype must not leak into the result (before the fix: latitude 33, shadingModel 'linear').
    const proto = Object.prototype as Rec;
    const polluted: Rec = {
      location: { latitude: 33 },
      latitude: 12,
      shadingModel: 'linear',
      obstacles: [{ id: 'x' }],
      version: 1,
    };
    try {
      for (const [k, v] of Object.entries(polluted)) proto[k] = v;
      expect(sanitizeConfig({})).toEqual(DEFAULT_CONFIG);
      expect(configFromJson('{"version":2,"panels":{}}')).toEqual(DEFAULT_CONFIG);
      // An inherited `location` section must not make a content-free file look like a config.
      expect(configFromJson('{"version":2}')).toBeNull();
      expect(decodeConfig(encodeConfig(DEFAULT_CONFIG))).toEqual(DEFAULT_CONFIG);
    } finally {
      for (const k of Object.keys(polluted)) delete proto[k];
    }
  });

  it('removes line/paragraph separators U+2028/U+2029 from names (single-line, regression)', () => {
    const c = sanitizeConfig({
      location: { name: '\u2029Bern\u2028Nord\u2028' },
      horizon: { obstacles: [{ id: 'a\u2028b', name: 'Haus\u2029A' }] },
      economics: { currency: '\u2028€' },
    });
    // Separators → ' ', then trimmed: '\u2029Bern\u2028Nord\u2028' → ' Bern Nord ' → 'Bern Nord'.
    expect(c.location.name).toBe('Bern Nord');
    expect(c.horizon.obstacles[0]).toMatchObject({ id: 'a b', name: 'Haus A' });
    expect(c.economics.currency).toBe('€');
  });

  it('fuzz: garbage never throws, output is valid and idempotent', () => {
    const rnd = mulberry32(0xc0ffee);
    for (let n = 0; n < 400; n++) {
      const raw = randomRawConfig(rnd);
      // Replace random fields / whole sections by garbage.
      for (const s of SECTIONS) {
        if (rnd() < 0.1) raw[s] = garbage(rnd);
        const sec = raw[s];
        if (typeof sec === 'object' && sec !== null && !Array.isArray(sec)) {
          for (const k of Object.keys(sec)) if (rnd() < 0.15) (sec as Rec)[k] = garbage(rnd);
        }
      }
      const c = sanitizeConfig(raw);
      expectValid(c);
      expect(sanitizeConfig(c)).toEqual(c);
    }
  });
});

// ── Share encoding ───────────────────────────

describe('encodeConfig / decodeConfig', () => {
  it('encodes the default config as the version-only diff {"v":2}', () => {
    expect(encodeConfig(DEFAULT_CONFIG)).toBe(refEncodeJson('{"v":2}'));
    expect(decodeConfig(refEncodeJson('{"v":2}'))).toEqual(DEFAULT_CONFIG);
    // '{}' = 0x7B 0x7D → 011110 110111 1101(00) → indices 30, 55, 52 → "e30": a link of version 1.
    expect(refEncodeJson('{}')).toBe('e30');
    expect(decodeConfig('e30')).toEqual(V1_CONFIG);
  });

  it('encodes changed battery fields with short keys', () => {
    const c: Config = {
      ...DEFAULT_CONFIG,
      battery: { ...DEFAULT_CONFIG.battery, enabled: true, units: 3, strategy: 'self-consumption' },
    };
    expect(encodeConfig(c)).toBe(refEncodeJson('{"v":2,"x":{"e":true,"u":3,"s":"self-consumption"}}'));
    expect(decodeConfig(encodeConfig(c))).toEqual(c);
  });

  it('encodes only the changed fields with short keys (format is part of the link contract)', () => {
    const c: Config = { ...DEFAULT_CONFIG, building: { ...DEFAULT_CONFIG.building, facadeAzimuth: 180 } };
    expect(encodeConfig(c)).toBe(refEncodeJson('{"v":2,"b":{"a":180}}'));
    const d: Config = {
      ...DEFAULT_CONFIG,
      horizon: {
        terrainEnabled: false,
        obstacles: [
          { id: 'o1', name: 'Haus', offsetAlong: -5, distance: 20, width: 15, depth: 10, height: 12 },
        ],
        manual: [{ azimuth: 90, elevation: 4.5 }],
      },
    };
    expect(encodeConfig(d)).toBe(
      refEncodeJson(
        '{"v":2,"h":{"t":false,"o":[{"i":"o1","n":"Haus","u":-5,"d":20,"w":15,"t":10,"h":12}],"m":[[90,4.5]]}}',
      ),
    );
    expect(decodeConfig(encodeConfig(d))).toEqual(d);
  });

  it('fuzz: round-trips seeded random configs exactly and stays URL-safe', () => {
    const rnd = mulberry32(20260923);
    let sawNonUrlChars = 0;
    for (let n = 0; n < 300; n++) {
      const c = sanitizeConfig(randomRawConfig(rnd));
      const s = encodeConfig(c);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(decodeConfig(s)).toEqual(c);
      // Standard base64 alphabet with padding is accepted as well.
      const std = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
      if (std !== s) sawNonUrlChars++;
      expect(decodeConfig(std)).toEqual(c);
    }
    expect(sawNonUrlChars).toBeGreaterThan(0);
  });

  it('keeps a typical changed config short', () => {
    const c: Config = {
      ...DEFAULT_CONFIG,
      location: {
        name: 'Bern',
        latitude: 46.9481,
        longitude: 7.4474,
        timezone: 'Europe/Zurich',
        elevation: 549,
      },
      building: { ...DEFAULT_CONFIG.building, facadeAzimuth: 180, numFloors: 4 },
      panels: { ...DEFAULT_CONFIG.panels, tiltFromVertical: 30, powerWp: 425, width: 172.2 },
    };
    const json =
      '{"v":2,"l":{"n":"Bern","a":46.9481,"o":7.4474,"e":549},"b":{"a":180,"f":4},"p":{"w":172.2,"t":30,"p":425}}';
    const s = encodeConfig(c);
    expect(s).toBe(refEncodeJson(json));
    // ASCII JSON → base64 without padding has ⌈8·bytes/6⌉ chars
    expect(s.length).toBe(Math.ceil((json.length * 8) / 6));
    expect(s.length).toBeLessThan(150); // 142 incl. the version key "v":2
    expect(decodeConfig(s)).toEqual(c);
  });

  it('returns null for invalid input and never throws', () => {
    const bad: unknown[] = [
      '',
      '!!!',
      'a', // length ≡ 1 (mod 4) is never valid base64
      '%%%',
      refEncodeJson('not json'),
      refEncodeJson('[1,2]'),
      refEncodeJson('42'),
      refEncodeJson('null'),
      refBase64Url(new Uint8Array([0x7b, 0xff, 0x7d])), // invalid UTF-8
      'e'.repeat(300_000), // oversized
      null,
      undefined,
      42,
    ];
    for (const b of bad) expect(decodeConfig(b as string)).toBeNull();
    const rnd = mulberry32(7);
    for (let n = 0; n < 200; n++) {
      const s = randomString(rnd, 40);
      expect(() => decodeConfig(s)).not.toThrow();
    }
  });

  it('accepts long keys, full configs and flat v1 configs', () => {
    const long = decodeConfig(
      refEncodeJson('{"building":{"facadeAzimuth":135},"weather":{"source":"clear-sky"}}'),
    );
    // No `v`: a version-1 payload, unchanged fields from base 1 (e.g. the old 800 W inverter limit).
    expect(long).toEqual({
      ...V1_CONFIG,
      building: { ...V1_CONFIG.building, facadeAzimuth: 135 },
      weather: { ...V1_CONFIG.weather, source: 'clear-sky' },
    });
    expect(long?.system.inverterLimitW).toBe(800);
    expect(decodeConfig(encodeConfig(DEFAULT_CONFIG))?.system.inverterLimitW).toBe(600);
    const full: Config = { ...DEFAULT_CONFIG, panels: { ...DEFAULT_CONFIG.panels, count: 4 } };
    expect(decodeConfig(refEncodeJson(JSON.stringify(full)))).toEqual(full);
    const v1 = decodeConfig(refEncodeJson('{"latitude":46,"balconyHeight":300}'));
    expect(v1?.location.latitude).toBe(46);
    expect(v1?.building.floorHeight).toBe(300);
  });

  it('keeps the default location name when only coordinates changed (diff semantics)', () => {
    const c: Config = { ...DEFAULT_CONFIG, location: { ...DEFAULT_CONFIG.location, latitude: 40 } };
    expect(decodeConfig(encodeConfig(c))).toEqual(c);
  });

  it('ignores __proto__ in payloads', () => {
    const c = decodeConfig(
      refEncodeJson('{"__proto__":{"polluted":1},"b":{"__proto__":{"polluted":1},"a":90}}'),
    );
    expect(({} as Rec).polluted).toBeUndefined();
    expect(c?.building.facadeAzimuth).toBe(90);
  });
});

describe('share format versions', () => {
  // Share links (also printed in reports) store only the diff to a base config. The base must never follow
  // DEFAULT_CONFIG, or changing a default would silently change the meaning of every existing link.

  it('pins share base 1 (the defaults of all links created before versioning)', () => {
    expect(SHARE_BASES[1]).toEqual({
      version: 2,
      location: {
        name: '47.100° N, 7.450° E',
        latitude: 47.1,
        longitude: 7.45,
        timezone: 'Europe/Zurich',
        elevation: 486,
      },
      building: {
        facadeAzimuth: 202,
        floorHeight: 280,
        railingHeight: 100,
        balconyDepth: 150,
        numFloors: 2,
        lowestFloor: 1,
      },
      panels: { length: 113.4, width: 176.2, count: 2, gap: 2, tiltFromVertical: 45, powerWp: 430 },
      system: {
        inverterLimitW: 800,
        lossesPct: 14,
        tempCoeffPct: -0.35,
        noct: 45,
        albedo: 0.2,
        shadingModel: 'substring',
      },
      horizon: { terrainEnabled: true, obstacles: [], manual: [] },
      weather: { source: 'open-meteo', year: 2025 },
      economics: {
        currency: 'CHF',
        electricityPrice: 0.3,
        feedInTariff: 0.08,
        selfConsumptionPct: 70,
        investmentPerFloor: 900,
        degradationPct: 0.5,
        lifetimeYears: 25,
      },
    });
    expect(Object.isFrozen(SHARE_BASES[1].horizon.obstacles)).toBe(true);
  });

  it('DEFAULT_CONFIG equals the current share base', () => {
    // Changed a default? Add SHARE_BASES[SHARE_VERSION + 1] as a literal copy of the new DEFAULT_CONFIG and bump
    // SHARE_VERSION (compactDiff then writes `v`). Never edit an existing base.
    expect(DEFAULT_CONFIG).toEqual(SHARE_BASES[SHARE_VERSION]);
  });

  it('decodes a golden link to the full config it was created with', () => {
    // '{"p":{"t":30}}' — tilt 30°, everything else from base 1.
    expect(refEncodeJson('{"p":{"t":30}}')).toBe('eyJwIjp7InQiOjMwfX0');
    const golden: Config = {
      ...V1_CONFIG,
      panels: { length: 113.4, width: 176.2, count: 2, gap: 2, tiltFromVertical: 30, powerWp: 430 },
    };
    expect(decodeConfig('eyJwIjp7InQiOjMwfX0')).toEqual(golden);
  });

  it('keeps the meaning of existing links when a default changes (regression)', () => {
    const D = DEFAULT_CONFIG;
    const saved = {
      year: D.weather.year,
      price: D.economics.electricityPrice,
      wp: D.panels.powerWp,
      ac: D.battery.acLimitW,
    };
    try {
      // Simulates a later release with new defaults.
      D.battery.acLimitW = 800;
      D.weather.year = 2026;
      D.economics.electricityPrice = 0.32;
      D.panels.powerWp = 450;
      const c = decodeConfig('eyJwIjp7InQiOjMwfX0');
      expect(c?.panels.tiltFromVertical).toBe(30);
      expect(c?.weather.year).toBe(2025);
      expect(c?.economics.electricityPrice).toBe(0.3);
      expect(c?.panels.powerWp).toBe(430);
      expect(c?.battery.acLimitW).toBe(600);
      expect(decodeConfig('e30')).toEqual(V1_CONFIG);
      // A config that uses the new defaults still round-trips.
      const next = sanitizeConfig({ ...D, panels: { ...D.panels, count: 3 } });
      expect(decodeConfig(encodeConfig(next))).toEqual(next);
    } finally {
      D.weather.year = saved.year;
      D.economics.electricityPrice = saved.price;
      D.panels.powerWp = saved.wp;
      D.battery.acLimitW = saved.ac;
    }
  });

  it('reads the version key: unknown versions use base 1, newer ones the newest base', () => {
    const tilt30 = decodeConfig('eyJwIjp7InQiOjMwfX0');
    for (const v of ['1', '0', '-3', '1.5', '"1"', 'null', '"__proto__"', '"constructor"']) {
      expect(decodeConfig(refEncodeJson(`{"v":${v},"p":{"t":30}}`))).toEqual(tilt30);
    }
    const future = decodeConfig(refEncodeJson(`{"v":${SHARE_VERSION + 1},"p":{"t":30}}`));
    expect(future).toEqual({
      ...SHARE_BASES[SHARE_VERSION],
      panels: { ...SHARE_BASES[SHARE_VERSION].panels, tiltFromVertical: 30 },
    });
    // From version 2 on every link carries `v`: the default config is '{"v":2}'.
    expect(JSON.parse(atob(encodeConfig(DEFAULT_CONFIG)))).toEqual({ v: SHARE_VERSION });
  });
});

describe('config v2 → v3 (battery)', () => {
  it('fills the battery section of a v2 JSON export or stored config with the defaults (storage off)', () => {
    const v2 = { ...SHARE_BASES[1], panels: { ...SHARE_BASES[1].panels, count: 3 } };
    const c = configFromJson(JSON.stringify(v2));
    expect(c).toEqual({ ...V1_CONFIG, panels: { ...V1_CONFIG.panels, count: 3 } });
    expect(c?.battery.enabled).toBe(false);
    expect(sanitizeConfig({ state: {} })).toEqual(DEFAULT_CONFIG);
  });

  it('keeps a valid battery section and repairs an invalid one', () => {
    const c = sanitizeConfig({
      battery: { enabled: true, layout: 'per-floor', strategy: 'x', units: 99, minSocPct: -5, preset: '' },
    });
    expect(c.battery.enabled).toBe(true);
    expect(c.battery.layout).toBe('per-floor');
    expect(c.battery.strategy).toBe(DEFAULT_CONFIG.battery.strategy);
    expect(c.battery.units).toBe(LIMITS.battery.units.max);
    expect(c.battery.minSocPct).toBe(0);
    expect(c.battery.preset).toBe(DEFAULT_CONFIG.battery.preset);
  });
});

describe('readConfigFromHash / buildShareUrl', () => {
  const c: Config = {
    ...DEFAULT_CONFIG,
    location: { ...DEFAULT_CONFIG.location, name: 'Zürich & Co #1', timezone: 'Europe/Zurich' },
    panels: { ...DEFAULT_CONFIG.panels, count: 3 },
  };

  it('builds a link from the base URL without its old hash', () => {
    expect(buildShareUrl('https://example.org/app/?x=1#c=old', c)).toBe(
      `https://example.org/app/?x=1#c=${encodeConfig(c)}`,
    );
    expect(buildShareUrl('https://example.org/', c)).toBe(`https://example.org/#c=${encodeConfig(c)}`);
  });

  it('reads the config back from the hash (also via URL parsing and with other params)', () => {
    const url = buildShareUrl('https://example.org/app/', c);
    expect(readConfigFromHash(new URL(url).hash)).toEqual(c);
    expect(readConfigFromHash(`#view=3d&c=${encodeConfig(c)}`)).toEqual(c);
    expect(readConfigFromHash(`c=${encodeURIComponent(encodeConfig(c))}`)).toEqual(c);
  });

  it('returns null when absent or invalid', () => {
    for (const h of ['', '#', '#c=', '#x=e30', '#c=%E0%A4%A', '#c=!!!'])
      expect(readConfigFromHash(h)).toBeNull();
  });
});

describe('configToJson / configFromJson', () => {
  it('round-trips seeded random configs', () => {
    const rnd = mulberry32(42);
    for (let n = 0; n < 100; n++) {
      const c = sanitizeConfig(randomRawConfig(rnd));
      const json = configToJson(c);
      expect(JSON.parse(json)).toEqual(c);
      expect(configFromJson(json)).toEqual(c);
    }
  });

  it('accepts BOM and v1 files, rejects non-configs', () => {
    expect(configFromJson('﻿' + configToJson(DEFAULT_CONFIG))).toEqual(DEFAULT_CONFIG);
    expect(configFromJson('{"version":2,"panels":{}}')).toEqual(DEFAULT_CONFIG);
    expect(configFromJson('{"panelTilt":20}')?.panels.tiltFromVertical).toBe(20);
    for (const t of ['', 'nope', '42', '[]', 'null', '{"foo":1}', '{"location":"x"}']) {
      expect(configFromJson(t)).toBeNull();
    }
  });

  it('rejects JSON with only a version number instead of loading the defaults (regression)', () => {
    for (const t of ['{"version":2}', '{"version":2,"foo":1}', '{"version":"2"}', '{"version":1}']) {
      expect(configFromJson(t)).toBeNull();
    }
  });

  it('reads the config out of a persisted store value', () => {
    const custom = sanitizeConfig({
      location: { name: 'Zürich', latitude: 47.3769, longitude: 8.5417 },
      panels: { tiltFromVertical: 25 },
    });
    const inner: unknown = JSON.parse(configToJson(custom));
    expect(configFromJson(JSON.stringify({ state: { config: inner }, version: 2 }))).toEqual(custom);
    expect(configFromJson(JSON.stringify({ config: inner }))).toEqual(custom);
    // Persisted v1 value: a flat config inside the wrapper.
    expect(configFromJson('{"state":{"config":{"panelTilt":20}},"version":1}')?.panels.tiltFromVertical).toBe(
      20,
    );
    // A wrapper without a config is not a config.
    expect(configFromJson('{"state":{"lang":"de"},"version":2}')).toBeNull();
  });
});

describe('helpers', () => {
  it('formatCoordinateName matches the default location label', () => {
    expect(formatCoordinateName(DEFAULT_CONFIG.location.latitude, DEFAULT_CONFIG.location.longitude)).toBe(
      DEFAULT_CONFIG.location.name,
    );
    // toFixed(3): 33.8688 → 33.869, 151.2093 → 151.209
    expect(formatCoordinateName(-33.8688, 151.2093)).toBe('33.869° S, 151.209° E');
  });

  it('canonicalTimeZone', () => {
    expect(canonicalTimeZone('Europe/Zurich')).toBe('Europe/Zurich');
    expect(canonicalTimeZone(' Europe/Zurich ')).toBe('Europe/Zurich');
    // Valid aliases are kept even where ICU resolves them to a legacy id (Asia/Kolkata → Asia/Calcutta in V8).
    expect(canonicalTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(canonicalTimeZone('America/Indiana/Indianapolis')).toBe('America/Indiana/Indianapolis');
    expect(canonicalTimeZone('Nowhere/City')).toBeNull();
    expect(canonicalTimeZone(undefined)).toBeNull();
    expect(canonicalTimeZone('x'.repeat(100))).toBeNull();
  });
});
