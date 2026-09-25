import type {
  Building,
  BuildingImport,
  Config,
  HorizonConfig,
  HorizonPoint,
  LocationConfig,
  Obstacle,
  SurfaceModelConfig,
} from './types';
import { DEFAULT_CONFIG, LIMITS, createObstacle, type FieldLimit } from './defaults';
import { dropDuplicateVertices, ensureCcw, ringArea, simplifyRing, type Ring } from './polygon';
import { clamp, normalizeDeg, roundToStep } from './units';

// ─────────────────────────────────────────────
// CONFIG VALIDATION & SHARE LINKS
// sanitizeConfig: untrusted input (URL, file, localStorage) → valid Config, never throws.
// Share link: '#c=' + base64url(UTF-8(JSON of the diff vs the frozen share base SHARE_BASES[v], short keys)).
// ─────────────────────────────────────────────

/** Max. obstacles kept by sanitizeConfig. */
export const MAX_OBSTACLES = 20;
/** Max. manual horizon points kept by sanitizeConfig (0.5° resolution). */
export const MAX_HORIZON_POINTS = 720;
/** Max. length (code points) of obstacle ids/names. */
export const MAX_TEXT_LENGTH = 40;
/** Max. length (code points) of the location name. */
export const MAX_LOCATION_NAME_LENGTH = 80;
/** Max. length of the currency label. */
export const MAX_CURRENCY_LENGTH = 8;
/** Max. surrounding buildings kept by sanitizeConfig (further ones are dropped). */
export const MAX_BUILDINGS = 150;
/** Max. footprint vertices per building (longer rings are simplified, see simplifyRing). */
export const MAX_BUILDING_VERTICES = 64;
/** Max. footprint vertices of all buildings together (buildings beyond it are dropped). */
export const MAX_TOTAL_BUILDING_VERTICES = 2000;
/** Footprints with a smaller area (m², after rounding) are dropped as degenerate. */
export const MIN_BUILDING_AREA = 0.5;
/** Rings with more raw vertices are dropped before any work is done on them (untrusted input). */
const MAX_RAW_RING_VERTICES = 4096;

/** decodeConfig rejects longer inputs (a full config with 720 horizon points is ≈ 15 k chars). */
const MAX_ENCODED_LENGTH = 200_000;
/** configFromJson rejects longer inputs. */
const MAX_JSON_LENGTH = 2_000_000;

/**
 * Rounding precision where it deliberately differs from the LIMITS slider step: coordinates keep 1e-6° (≤ 0.07 m:
 * exact addresses and the balcony point on the facade), money keeps typed tariffs such as 0.3214, module power
 * keeps odd ratings.
 */
export const ROUNDING_OVERRIDES = {
  location: { latitude: 1e-6, longitude: 1e-6 },
  panels: { powerWp: 1 },
  economics: { electricityPrice: 1e-4, feedInTariff: 1e-4, investmentPerFloor: 1 },
} as const;

/** Manual horizon points: azimuth wrapped to [0, 360), elevation clamped (negative values never matter: sun ≤ 0° is night). */
export const HORIZON_POINT_LIMITS = {
  azimuth: { min: 0, max: 360, step: 0.1 },
  elevation: { min: 0, max: 90, step: 0.1 },
} as const satisfies Record<string, FieldLimit>;

type Rec = Record<string, unknown>;
type SectionKey = Exclude<keyof Config, 'version'>;

const SECTION_KEYS: readonly SectionKey[] = [
  'location',
  'building',
  'panels',
  'system',
  'horizon',
  'weather',
  'economics',
];

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasOwn(o: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

/** Own property `key` of `o`, else undefined. */
function ownValue(o: object, key: string): unknown {
  return hasOwn(o, key) ? (o as Rec)[key] : undefined;
}

/**
 * Own enumerable properties of `v` on a null-prototype object ({} for non-records), so inherited
 * (possibly polluted) values are never read.
 */
function ownRecord(v: unknown): Rec {
  const out = Object.create(null) as Rec;
  if (isRecord(v)) for (const k of Object.keys(v)) out[k] = v[k];
  return out;
}

// ── Field sanitizers ─────────────────────────

/** Finite number from a number or numeric string, else undefined. */
function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function num(v: unknown, limit: FieldLimit, fallback: number, precision: number = limit.step): number {
  const n = toNumber(v);
  if (n === undefined) return fallback;
  return clamp(roundToStep(n, precision), limit.min, limit.max);
}

/** Angle wrapped into [0, 360) before rounding, then clamped (0…359 for the facade). */
function azimuth(v: unknown, limit: FieldLimit, fallback: number): number {
  const n = toNumber(v);
  if (n === undefined) return fallback;
  return clamp(normalizeDeg(roundToStep(normalizeDeg(n), limit.step)), limit.min, limit.max);
}

/** Longitudes outside ±180° are wrapped (190 → −170), not clamped. */
function longitude(v: unknown, fallback: number): number {
  const n = toNumber(v);
  if (n === undefined) return fallback;
  const wrapped = n > 180 || n < -180 ? normalizeDeg(n + 180) - 180 : n;
  const { min, max } = LIMITS.location.longitude;
  return clamp(roundToStep(wrapped, ROUNDING_OVERRIDES.location.longitude), min, max);
}

// Control characters (C0, DEL, C1) and the line/paragraph separators U+2028/U+2029 are removed from free text.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** Trimmed single-line string limited to `maxLength` code points ('' if not a string). */
function text(v: unknown, maxLength: number): string {
  if (typeof v !== 'string') return '';
  const clean = v.replace(CONTROL_CHARS, ' ').trim();
  const chars = Array.from(clean);
  return chars.length <= maxLength ? clean : chars.slice(0, maxLength).join('').trim();
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

const tzCache = new Map<string, string | null>();

/**
 * Validated time zone name, or null if the runtime's Intl does not know it. Casing is normalized
 * ('europe/zurich' → 'Europe/Zurich'); valid aliases are kept as given, because engines resolve them
 * differently (V8/ICU: 'Asia/Kolkata' → 'Asia/Calcutta'). Results are cached.
 */
export function canonicalTimeZone(tz: unknown): string | null {
  if (typeof tz !== 'string') return null;
  const key = tz.trim();
  if (key === '' || key.length > 64) return null;
  const cached = tzCache.get(key);
  if (cached !== undefined) return cached;
  let result: string | null;
  try {
    const resolved = new Intl.DateTimeFormat('en', { timeZone: key }).resolvedOptions().timeZone;
    result = resolved.toLowerCase() === key.toLowerCase() ? resolved : key;
  } catch {
    result = null;
  }
  if (tzCache.size > 200) tzCache.clear();
  tzCache.set(key, result);
  return result;
}

/**
 * Coordinate label in the style of the default location, e.g. "47.100° N, 7.450° E". Language-neutral
 * (always N/S/E/W): it is stored as location.name and ends up in share links and file names, so the UI
 * localises it for display instead of storing a translated label.
 */
export function formatCoordinateName(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(3)}° ${latitude < 0 ? 'S' : 'N'}`;
  const lon = `${Math.abs(longitude).toFixed(3)}° ${longitude < 0 ? 'W' : 'E'}`;
  return `${lat}, ${lon}`;
}

// ── Collections ──────────────────────────────

function uniqueId(used: Set<string>, prefix = 'o'): string {
  let k = used.size + 1;
  while (used.has(`${prefix}${k}`)) k++;
  return `${prefix}${k}`;
}

function sanitizeObstacles(v: unknown): Obstacle[] {
  if (!Array.isArray(v)) return [];
  const L = LIMITS.obstacle;
  const out: Obstacle[] = [];
  const used = new Set<string>();
  for (const raw of v) {
    if (out.length >= MAX_OBSTACLES) break;
    if (!isRecord(raw)) continue;
    const item = ownRecord(raw);
    const d = createObstacle('', '');
    let id = text(item.id, MAX_TEXT_LENGTH);
    if (id === '' || used.has(id)) id = uniqueId(used);
    used.add(id);
    out.push({
      id,
      name: text(item.name, MAX_TEXT_LENGTH),
      offsetAlong: num(item.offsetAlong, L.offsetAlong, d.offsetAlong),
      distance: num(item.distance, L.distance, d.distance),
      width: num(item.width, L.width, d.width),
      depth: num(item.depth, L.depth, d.depth),
      height: num(item.height, L.height, d.height),
    });
  }
  return out;
}

/** Accepts {azimuth, elevation} objects and [azimuth, elevation] tuples; sorted, one point per azimuth (max wins). */
function sanitizeHorizonPoints(v: unknown): HorizonPoint[] {
  if (!Array.isArray(v)) return [];
  const byAz = new Map<number, number>();
  let accepted = 0;
  for (const item of v) {
    if (accepted >= MAX_HORIZON_POINTS) break;
    const [rawAz, rawEl] = Array.isArray(item)
      ? [ownValue(item, '0'), ownValue(item, '1')]
      : isRecord(item)
        ? [ownValue(item, 'azimuth'), ownValue(item, 'elevation')]
        : [undefined, undefined];
    const az = toNumber(rawAz);
    const el = toNumber(rawEl);
    if (az === undefined || el === undefined) continue;
    accepted++;
    const A = HORIZON_POINT_LIMITS.azimuth;
    const a = normalizeDeg(roundToStep(normalizeDeg(az), A.step));
    const e = num(el, HORIZON_POINT_LIMITS.elevation, 0);
    const prev = byAz.get(a);
    byAz.set(a, prev === undefined ? e : Math.max(prev, e));
  }
  return [...byAz.entries()].sort((p, q) => p[0] - q[0]).map(([az, el]) => ({ azimuth: az, elevation: el }));
}

// ── Surroundings ─────────────────────────────

/**
 * Footprint ring: [east, north] tuples (or {e, n} / {x, y} objects), clamped to ±2000 m and rounded to 0.1 m;
 * consecutive and closing duplicates removed; counter-clockwise; simplified to MAX_BUILDING_VERTICES. Null if
 * any vertex is invalid, fewer than 3 remain or the area is below MIN_BUILDING_AREA.
 */
function sanitizeRing(v: unknown): Ring | null {
  if (!Array.isArray(v) || v.length < 3 || v.length > MAX_RAW_RING_VERTICES) return null;
  const L = LIMITS.neighbour.coord;
  const pts: Ring = [];
  for (const item of v as unknown[]) {
    const [rawE, rawN] = Array.isArray(item)
      ? [ownValue(item, '0'), ownValue(item, '1')]
      : isRecord(item)
        ? [ownValue(item, 'e') ?? ownValue(item, 'x'), ownValue(item, 'n') ?? ownValue(item, 'y')]
        : [undefined, undefined];
    const e = toNumber(rawE);
    const n = toNumber(rawN);
    if (e === undefined || n === undefined) return null;
    pts.push([num(e, L, 0), num(n, L, 0)]);
  }
  let ring = ensureCcw(dropDuplicateVertices(pts));
  if (ring.length > MAX_BUILDING_VERTICES) ring = ensureCcw(simplifyRing(ring, MAX_BUILDING_VERTICES));
  if (ring.length < 3 || Math.abs(ringArea(ring)) < MIN_BUILDING_AREA) return null;
  return ring;
}

/**
 * Surrounding buildings: invalid entries skipped, at most MAX_BUILDINGS and MAX_TOTAL_BUILDING_VERTICES
 * (later buildings dropped), unique ids ('b<k>' when missing or taken), removed/edited only on imported
 * buildings and only when true.
 */
function sanitizeBuildings(v: unknown): Building[] {
  if (!Array.isArray(v)) return [];
  const L = LIMITS.neighbour;
  const out: Building[] = [];
  const used = new Set<string>();
  let vertices = 0;
  for (const raw of v) {
    if (out.length >= MAX_BUILDINGS) break;
    if (!isRecord(raw)) continue;
    const item = ownRecord(raw);
    const footprint = sanitizeRing(item.footprint);
    if (!footprint) continue;
    if (vertices + footprint.length > MAX_TOTAL_BUILDING_VERTICES) break;
    vertices += footprint.length;
    let id = text(item.id, MAX_TEXT_LENGTH);
    if (id === '' || used.has(id)) id = uniqueId(used, 'b');
    used.add(id);
    const source = oneOf(item.source, ['swisstopo', 'manual'], 'manual');
    const b: Building = {
      id,
      name: text(item.name, MAX_TEXT_LENGTH),
      footprint,
      base: num(item.base, L.base, 0),
      height: num(item.height, L.height, 10),
      source,
    };
    if (source === 'swisstopo' && item.removed === true) b.removed = true;
    if (source === 'swisstopo' && item.edited === true) b.edited = true;
    out.push(b);
  }
  return out;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** 'YYYY-MM-DD' (a longer ISO timestamp is cut to its date), '' if not a valid calendar date. */
function isoDate(v: unknown): string {
  if (typeof v !== 'string') return '';
  const m = ISO_DATE.exec(v.trim());
  if (!m) return '';
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date ? date : '';
}

/**
 * Anchor of the building footprints. Buildings without an anchor (only possible from hand-made input) get the
 * location as anchor with radius 0, so they stay put from then on.
 */
function sanitizeBuildingImport(
  v: unknown,
  hasBuildings: boolean,
  location: Pick<LocationConfig, 'latitude' | 'longitude'>,
): BuildingImport | null {
  if (!isRecord(v)) {
    return hasBuildings
      ? { latitude: location.latitude, longitude: location.longitude, radius: 0, date: '' }
      : null;
  }
  const o = ownRecord(v);
  const latitude = num(
    o.latitude,
    LIMITS.location.latitude,
    location.latitude,
    ROUNDING_OVERRIDES.location.latitude,
  );
  return {
    latitude,
    longitude: longitude(o.longitude, location.longitude),
    radius: num(o.radius, LIMITS.buildingImport.radius, 0),
    date: isoDate(o.date),
  };
}

function sanitizeSurfaceModel(v: unknown): SurfaceModelConfig {
  const o = ownRecord(v);
  const D = DEFAULT_CONFIG.horizon.surfaceModel;
  return {
    enabled: bool(o.enabled, D.enabled),
    trees: bool(o.trees, D.trees),
    radius: num(o.radius, LIMITS.surfaceModel.radius, D.radius),
  };
}

function sanitizeHorizon(hor: Rec, location: Pick<LocationConfig, 'latitude' | 'longitude'>): HorizonConfig {
  const D = DEFAULT_CONFIG.horizon;
  const buildings = sanitizeBuildings(hasOwn(hor, 'buildings') ? hor.buildings : D.buildings);
  return {
    terrainEnabled: bool(hor.terrainEnabled, D.terrainEnabled),
    obstacles: sanitizeObstacles(hasOwn(hor, 'obstacles') ? hor.obstacles : D.obstacles),
    manual: sanitizeHorizonPoints(hasOwn(hor, 'manual') ? hor.manual : D.manual),
    buildings,
    buildingImport: sanitizeBuildingImport(hor.buildingImport, buildings.length > 0, location),
    surfaceModel: sanitizeSurfaceModel(hor.surfaceModel),
  };
}

// ── v1 migration ─────────────────────────────

/** Keys of the flat v1 config (pre-2.0 app, localStorage / JSON exports). */
const V1_KEYS = [
  'latitude',
  'longitude',
  'facadeAzimuth',
  'balconyHeight',
  'railingHeight',
  'panelLength',
  'panelWidth',
  'numPanels',
  'numFloors',
  'panelTilt',
  'panelThickness',
] as const;

function isV1(o: Rec): boolean {
  return o.version !== 2 && V1_KEYS.some((k) => hasOwn(o, k));
}

/** Maps a flat v1 config onto the v2 structure (v1 balconyHeight = floor-to-floor height; panelThickness dropped). */
function migrateV1(o: Rec): Rec {
  return {
    version: 2,
    location: { latitude: o.latitude, longitude: o.longitude },
    building: {
      facadeAzimuth: o.facadeAzimuth,
      floorHeight: o.balconyHeight,
      railingHeight: o.railingHeight,
      numFloors: o.numFloors,
    },
    panels: {
      length: o.panelLength,
      width: o.panelWidth,
      count: o.numPanels,
      tiltFromVertical: o.panelTilt,
    },
  };
}

// ── sanitizeConfig ───────────────────────────

function section(o: Rec, key: SectionKey): Rec {
  return ownRecord(ownValue(o, key));
}

/**
 * Deep-validates untrusted input into a complete Config. Never throws.
 * Missing/invalid fields fall back to DEFAULT_CONFIG, numbers are clamped to LIMITS and rounded to the LIMITS
 * step (see ROUNDING_OVERRIDES), azimuths/longitudes are wrapped, unknown time zones → default,
 * obstacles capped at MAX_OBSTACLES, manual horizon at MAX_HORIZON_POINTS, surrounding buildings at
 * MAX_BUILDINGS / MAX_BUILDING_VERTICES / MAX_TOTAL_BUILDING_VERTICES (footprints on the 0.1 m grid, CCW,
 * degenerate ones dropped). Fields added later (buildings, buildingImport, surfaceModel) default to
 * "none/off" when absent. Flat v1 configs are migrated.
 * A missing location name becomes the coordinate label. The result shares no references with the input.
 * Only own properties are read, so values inherited from a (polluted) prototype are ignored.
 */
export function sanitizeConfig(input: unknown): Config {
  try {
    return sanitizeRecord(ownRecord(input));
  } catch {
    // Defensive only (e.g. throwing getters on exotic objects).
    return sanitizeRecord({});
  }
}

function sanitizeRecord(raw: Rec): Config {
  const o = isV1(raw) ? migrateV1(raw) : raw;
  const D = DEFAULT_CONFIG;
  const L = LIMITS;

  const loc = section(o, 'location');
  const latitude = num(
    loc.latitude,
    L.location.latitude,
    D.location.latitude,
    ROUNDING_OVERRIDES.location.latitude,
  );
  const lon = longitude(loc.longitude, D.location.longitude);
  const name = text(loc.name, MAX_LOCATION_NAME_LENGTH) || formatCoordinateName(latitude, lon);

  const bld = section(o, 'building');
  const pan = section(o, 'panels');
  const sys = section(o, 'system');
  const hor = section(o, 'horizon');
  const wea = section(o, 'weather');
  const eco = section(o, 'economics');

  return {
    version: 2,
    location: {
      name,
      latitude,
      longitude: lon,
      timezone: canonicalTimeZone(loc.timezone) ?? D.location.timezone,
      elevation: num(loc.elevation, L.location.elevation, D.location.elevation),
    },
    building: {
      facadeAzimuth: azimuth(bld.facadeAzimuth, L.building.facadeAzimuth, D.building.facadeAzimuth),
      floorHeight: num(bld.floorHeight, L.building.floorHeight, D.building.floorHeight),
      railingHeight: num(bld.railingHeight, L.building.railingHeight, D.building.railingHeight),
      balconyDepth: num(bld.balconyDepth, L.building.balconyDepth, D.building.balconyDepth),
      numFloors: num(bld.numFloors, L.building.numFloors, D.building.numFloors),
      lowestFloor: num(bld.lowestFloor, L.building.lowestFloor, D.building.lowestFloor),
    },
    panels: {
      length: num(pan.length, L.panels.length, D.panels.length),
      width: num(pan.width, L.panels.width, D.panels.width),
      count: num(pan.count, L.panels.count, D.panels.count),
      gap: num(pan.gap, L.panels.gap, D.panels.gap),
      tiltFromVertical: num(pan.tiltFromVertical, L.panels.tiltFromVertical, D.panels.tiltFromVertical),
      powerWp: num(pan.powerWp, L.panels.powerWp, D.panels.powerWp, ROUNDING_OVERRIDES.panels.powerWp),
    },
    system: {
      inverterLimitW: num(sys.inverterLimitW, L.system.inverterLimitW, D.system.inverterLimitW),
      lossesPct: num(sys.lossesPct, L.system.lossesPct, D.system.lossesPct),
      tempCoeffPct: num(sys.tempCoeffPct, L.system.tempCoeffPct, D.system.tempCoeffPct),
      noct: num(sys.noct, L.system.noct, D.system.noct),
      albedo: num(sys.albedo, L.system.albedo, D.system.albedo),
      shadingModel: oneOf(sys.shadingModel, ['linear', 'substring'], D.system.shadingModel),
    },
    horizon: sanitizeHorizon(hor, { latitude, longitude: lon }),
    weather: {
      source: oneOf(wea.source, ['open-meteo', 'clear-sky'], D.weather.source),
      year: num(wea.year, L.weather.year, D.weather.year),
    },
    economics: {
      currency: text(eco.currency, MAX_CURRENCY_LENGTH) || D.economics.currency,
      electricityPrice: num(
        eco.electricityPrice,
        L.economics.electricityPrice,
        D.economics.electricityPrice,
        ROUNDING_OVERRIDES.economics.electricityPrice,
      ),
      feedInTariff: num(
        eco.feedInTariff,
        L.economics.feedInTariff,
        D.economics.feedInTariff,
        ROUNDING_OVERRIDES.economics.feedInTariff,
      ),
      selfConsumptionPct: num(
        eco.selfConsumptionPct,
        L.economics.selfConsumptionPct,
        D.economics.selfConsumptionPct,
      ),
      investmentPerFloor: num(
        eco.investmentPerFloor,
        L.economics.investmentPerFloor,
        D.economics.investmentPerFloor,
        ROUNDING_OVERRIDES.economics.investmentPerFloor,
      ),
      degradationPct: num(eco.degradationPct, L.economics.degradationPct, D.economics.degradationPct),
      lifetimeYears: num(eco.lifetimeYears, L.economics.lifetimeYears, D.economics.lifetimeYears),
    },
  };
}

// ── Compact share format ─────────────────────
// Short keys halve the link length. Decoding also accepts the long keys, so plain JSON diffs work too.
// Manual horizon points are encoded as [azimuth, elevation] tuples.
// A link stores only the fields that differ from a frozen, versioned base config (SHARE_BASES), never from
// the live DEFAULT_CONFIG: changing a default must not change what existing (and printed) links mean.

function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/**
 * Current share format version. Changing a default in DEFAULT_CONFIG requires a new base: add
 * SHARE_BASES[n + 1] = literal copy of the new defaults and bump this; compactDiff then writes `v`.
 */
export const SHARE_VERSION: number = 1;

/**
 * A frozen share base: the config shape of its app version. Horizon fields added later without a version bump
 * (buildings, buildingImport, surfaceModel) are missing from it; SHARE_ADDED_FIELDS supplies them.
 */
export type ShareBase = Omit<Config, 'horizon'> & {
  horizon: Omit<HorizonConfig, keyof typeof SHARE_ADDED_FIELDS.horizon> & Partial<HorizonConfig>;
};

/**
 * Fields added after a share base was frozen, with the value a payload (and base) without them means: "absent =
 * none/off". Frozen like the bases (never edit): an old link must keep meaning "no buildings, laser scan off"
 * even if DEFAULT_CONFIG changes. compactDiff omits such a field while it equals this value.
 */
export const SHARE_ADDED_FIELDS = deepFreeze({
  horizon: {
    buildings: [] as Building[],
    buildingImport: null as BuildingImport | null,
    surfaceModel: { enabled: false, trees: true, radius: 300 } as SurfaceModelConfig,
  },
});

/**
 * Diff base of each share format version (literal snapshots; never edit an existing entry). Payloads without
 * `v` — every link created before versioning — are version 1.
 */
export const SHARE_BASES: Readonly<Record<number, ShareBase>> = deepFreeze({
  1: {
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
  },
});

/** Base of payload version `v`: 1 when absent or unknown, the newest base for versions from a newer app. */
function shareBase(v: unknown): ShareBase {
  if (typeof v !== 'number' || !Number.isInteger(v)) return SHARE_BASES[1];
  if (v > SHARE_VERSION) return SHARE_BASES[SHARE_VERSION];
  return hasOwn(SHARE_BASES, String(v)) ? SHARE_BASES[v] : SHARE_BASES[1];
}

type AliasTable = { [S in SectionKey]: { key: string; fields: { [F in keyof Config[S]]-?: string } } };

const ALIASES: AliasTable = {
  location: { key: 'l', fields: { name: 'n', latitude: 'a', longitude: 'o', timezone: 'z', elevation: 'e' } },
  building: {
    key: 'b',
    fields: {
      facadeAzimuth: 'a',
      floorHeight: 'h',
      railingHeight: 'r',
      balconyDepth: 'd',
      numFloors: 'f',
      lowestFloor: 'l',
    },
  },
  panels: {
    key: 'p',
    fields: { length: 'l', width: 'w', count: 'c', gap: 'g', tiltFromVertical: 't', powerWp: 'p' },
  },
  system: {
    key: 's',
    fields: {
      inverterLimitW: 'i',
      lossesPct: 'l',
      tempCoeffPct: 't',
      noct: 'n',
      albedo: 'a',
      shadingModel: 'm',
    },
  },
  horizon: {
    key: 'h',
    fields: {
      terrainEnabled: 't',
      obstacles: 'o',
      manual: 'm',
      buildings: 'g',
      buildingImport: 'k',
      surfaceModel: 's',
    },
  },
  weather: { key: 'w', fields: { source: 's', year: 'y' } },
  economics: {
    key: 'e',
    fields: {
      currency: 'c',
      electricityPrice: 'p',
      feedInTariff: 'f',
      selfConsumptionPct: 's',
      investmentPerFloor: 'i',
      degradationPct: 'd',
      lifetimeYears: 'y',
    },
  },
};

const OBSTACLE_ALIASES: { [F in keyof Obstacle]-?: string } = {
  id: 'i',
  name: 'n',
  offsetAlong: 'u',
  distance: 'd',
  width: 'w',
  depth: 't',
  height: 'h',
};

/** Value of `alias` if present, else of `full`, else undefined (own properties only). */
function pick(o: Rec, alias: string, full: string): unknown {
  if (hasOwn(o, alias)) return o[alias];
  if (hasOwn(o, full)) return o[full];
  return undefined;
}

function aliasKeys(o: Rec, table: Record<string, string>): Rec {
  const out: Rec = {};
  for (const [full, alias] of Object.entries(table)) if (hasOwn(o, full)) out[alias] = o[full];
  return out;
}

function unaliasKeys(o: Rec, table: Record<string, string>): Rec {
  const out: Rec = {};
  for (const [full, alias] of Object.entries(table)) {
    const v = pick(o, alias, full);
    if (v !== undefined) out[full] = v;
  }
  return out;
}

const BUILDING_IMPORT_ALIASES: { [F in keyof BuildingImport]-?: string } = {
  latitude: 'a',
  longitude: 'o',
  radius: 'r',
  date: 'd',
};

const SURFACE_MODEL_ALIASES: { [F in keyof SurfaceModelConfig]-?: string } = {
  enabled: 'e',
  trees: 't',
  radius: 'r',
};

/** Values of the fields section `s` gained after the share bases were frozen (SHARE_ADDED_FIELDS). */
function addedFields(s: SectionKey): Rec {
  const added = (SHARE_ADDED_FIELDS as Record<string, unknown>)[s];
  return isRecord(added) ? added : {};
}

/** Value a payload means when it omits `full`: the base's value, else the added-field value. */
function referenceValue(def: Rec, s: SectionKey, full: string): unknown {
  return hasOwn(def, full) ? def[full] : addedFields(s)[full];
}

/** Length on the 0.1 m grid as an integer number of decimetres. */
const dm = (m: number): number => Math.round(m * 10);

/**
 * Compact building (share links): [height, base, e0, n0, Δe1, Δn1, …] as integer decimetres, every vertex after
 * the first as the difference to the previous one (≈ 11–12 chars per vertex). A building with a name, an id other
 * than 'b<index + 1>', source 'manual' or a removed/edited flag becomes {g: […], i?, n?, m?: 1, r?: 1, e?: 1}.
 */
function encodeBuilding(b: Building, index: number): unknown {
  const g = [dm(b.height), dm(b.base)];
  let pe = 0;
  let pn = 0;
  b.footprint.forEach(([e, n], k) => {
    const ie = dm(e);
    const iN = dm(n);
    g.push(k === 0 ? ie : ie - pe, k === 0 ? iN : iN - pn);
    pe = ie;
    pn = iN;
  });
  const meta: Rec = {};
  if (b.id !== `b${index + 1}`) meta.i = b.id;
  if (b.name !== '') meta.n = b.name;
  if (b.source === 'manual') meta.m = 1;
  if (b.removed) meta.r = 1;
  if (b.edited) meta.e = 1;
  return Object.keys(meta).length === 0 ? g : { g, ...meta };
}

/** Inverse of encodeBuilding; a full Building object (long-key JSON) passes through. sanitizeConfig validates. */
function decodeBuilding(v: unknown, index: number): unknown {
  const compact: Rec | null = Array.isArray(v)
    ? { g: v }
    : isRecord(v) && !hasOwn(v, 'footprint')
      ? ownRecord(v)
      : null;
  if (!compact) return v;
  const g = compact.g;
  if (!Array.isArray(g)) return null;
  const nums: number[] = [];
  for (const x of g as unknown[]) {
    const n = toNumber(x);
    if (n === undefined) return null;
    nums.push(n);
  }
  const footprint: [number, number][] = [];
  let e = 0;
  let n = 0;
  for (let k = 2; k + 1 < nums.length; k += 2) {
    e += nums[k];
    n += nums[k + 1];
    footprint.push([e / 10, n / 10]);
  }
  const flag = (x: unknown): boolean => x === 1 || x === true;
  return {
    id: hasOwn(compact, 'i') ? compact.i : `b${index + 1}`,
    name: hasOwn(compact, 'n') ? compact.n : '',
    footprint,
    height: (nums[0] ?? NaN) / 10,
    base: (nums[1] ?? NaN) / 10,
    source: flag(compact.m) ? 'manual' : 'swisstopo',
    removed: flag(compact.r),
    edited: flag(compact.e),
  };
}

/** Compact payload of the fields that differ from SHARE_BASES[SHARE_VERSION] (`v` written from version 2 on). */
function compactDiff(c: Config): Rec {
  const out: Rec = {};
  // Version 1 omits `v`, so links (and the default config's 'e30') stay as they were before versioning.
  if (SHARE_VERSION > 1) out.v = SHARE_VERSION;
  const base = SHARE_BASES[SHARE_VERSION];
  for (const s of SECTION_KEYS) {
    const cur = c[s] as unknown as Rec;
    const def = base[s] as unknown as Rec;
    const fields = ALIASES[s].fields as Record<string, string>;
    const sec: Rec = {};
    for (const [full, alias] of Object.entries(fields)) {
      const ref = referenceValue(def, s, full);
      if (JSON.stringify(cur[full]) === JSON.stringify(ref)) continue;
      const v = cur[full];
      if (s === 'horizon' && full === 'obstacles') {
        sec[alias] = (v as Obstacle[]).map((ob) => aliasKeys(ob as unknown as Rec, OBSTACLE_ALIASES));
      } else if (s === 'horizon' && full === 'manual') {
        sec[alias] = (v as HorizonPoint[]).map((p) => [p.azimuth, p.elevation]);
      } else if (s === 'horizon' && full === 'buildings') {
        sec[alias] = (v as Building[]).map(encodeBuilding);
      } else if (s === 'horizon' && full === 'buildingImport') {
        sec[alias] = v === null ? null : aliasKeys(v as Rec, BUILDING_IMPORT_ALIASES);
      } else if (s === 'horizon' && full === 'surfaceModel') {
        // Only the sub-fields that differ from the reference ({"e":true} for "laser scan on").
        const r = ownRecord(ref);
        const m = v as Rec;
        const diff: Rec = {};
        for (const [f, a] of Object.entries(SURFACE_MODEL_ALIASES)) if (m[f] !== r[f]) diff[a] = m[f];
        sec[alias] = diff;
      } else {
        sec[alias] = v;
      }
    }
    if (Object.keys(sec).length > 0) out[ALIASES[s].key] = sec;
  }
  return out;
}

/**
 * Inverse of compactDiff, merged onto the base of the payload's version `v` (see shareBase; long keys accepted
 * as well). Unknown keys are dropped.
 */
function expandPayload(o: Rec): Rec {
  const out: Rec = { version: 2 };
  const base = shareBase(ownValue(o, 'v'));
  for (const s of SECTION_KEYS) {
    const def = base[s] as unknown as Rec;
    const src = pick(o, ALIASES[s].key, s);
    // Fields added without a version bump: absent = SHARE_ADDED_FIELDS (the base wins where it has them).
    const sec: Rec = { ...addedFields(s), ...def };
    if (isRecord(src)) {
      const fields = ALIASES[s].fields as Record<string, string>;
      for (const [full, alias] of Object.entries(fields)) {
        const v = pick(src, alias, full);
        if (v === undefined) continue;
        if (s === 'horizon' && full === 'obstacles' && Array.isArray(v)) {
          sec[full] = v.map((ob: unknown) => (isRecord(ob) ? unaliasKeys(ob, OBSTACLE_ALIASES) : ob));
        } else if (s === 'horizon' && full === 'buildings' && Array.isArray(v)) {
          sec[full] = v.map(decodeBuilding);
        } else if (s === 'horizon' && full === 'buildingImport' && isRecord(v)) {
          sec[full] = unaliasKeys(v, BUILDING_IMPORT_ALIASES);
        } else if (s === 'horizon' && full === 'surfaceModel' && isRecord(v)) {
          sec[full] = { ...ownRecord(sec[full]), ...unaliasKeys(v, SURFACE_MODEL_ALIASES) };
        } else {
          sec[full] = v;
        }
      }
    }
    out[s] = sec;
  }
  return out;
}

// ── base64url ────────────────────────────────

function utf8ToBase64Url(textIn: string): string {
  const bytes = new TextEncoder().encode(textIn);
  let bin = '';
  // Chunked to stay below the argument limit of fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Accepts base64url and standard base64 (with or without padding). Throws on invalid input. */
function base64UrlToUtf8(s: string): string {
  const b64 = s.replace(/\s+/g, '').replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*$/.test(b64) || b64.length % 4 === 1) throw new Error('invalid base64');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// ── Public share API ─────────────────────────

/**
 * URL-safe share string: base64url (no padding) of the UTF-8 JSON of the fields that differ from the share base
 * SHARE_BASES[SHARE_VERSION], with short keys. The config is sanitized first, so decodeConfig(encodeConfig(c))
 * deep-equals sanitizeConfig(c). Unchanged fields are restored from the base the link was encoded against, not
 * from the DEFAULT_CONFIG of the decoding app, so a link keeps its meaning when defaults change.
 */
export function encodeConfig(config: Config): string {
  return utf8ToBase64Url(JSON.stringify(compactDiff(sanitizeConfig(config))));
}

/** Inverse of encodeConfig. Also accepts long keys, plain base64 and flat v1 configs. Returns null on any error. */
export function decodeConfig(s: string): Config | null {
  try {
    if (typeof s !== 'string' || s.length > MAX_ENCODED_LENGTH) return null;
    const parsed: unknown = JSON.parse(base64UrlToUtf8(s));
    if (!isRecord(parsed)) return null;
    return sanitizeConfig(isV1(parsed) ? parsed : expandPayload(parsed));
  } catch {
    return null;
  }
}

/** Reads the config from a location hash like '#c=…' (other '&'-separated params are ignored). Null if absent/invalid. */
export function readConfigFromHash(hash: string): Config | null {
  if (typeof hash !== 'string') return null;
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of body.split('&')) {
    if (!part.startsWith('c=')) continue;
    try {
      return decodeConfig(decodeURIComponent(part.slice(2)));
    } catch {
      return null;
    }
  }
  return null;
}

/** Share link: `baseUrl` without its hash + '#c=' + encodeConfig(config). */
export function buildShareUrl(baseUrl: string, config: Config): string {
  const i = baseUrl.indexOf('#');
  return `${i >= 0 ? baseUrl.slice(0, i) : baseUrl}#c=${encodeConfig(config)}`;
}

/** Full, sanitized config as pretty-printed JSON (file export). */
export function configToJson(config: Config): string {
  return JSON.stringify(sanitizeConfig(config), null, 2);
}

/** The config inside a persisted store value ({state: {config}, version}) or {config}; else `o` itself. */
function unwrapPersisted(o: Rec): Rec {
  const state = ownValue(o, 'state');
  const inner = isRecord(state) ? ownValue(state, 'config') : ownValue(o, 'config');
  return isRecord(inner) ? inner : o;
}

/**
 * Parses a JSON export (v2 or flat v1; also the persisted store value {state: {config}}). Returns null for
 * invalid JSON or JSON that does not look like a config (no known section object, no v1 key; a bare
 * version number is not enough); otherwise the sanitized config.
 */
export function configFromJson(textIn: string): Config | null {
  try {
    if (typeof textIn !== 'string' || textIn.length > MAX_JSON_LENGTH) return null;
    const parsed: unknown = JSON.parse(textIn.replace(/^\uFEFF/, ''));
    if (!isRecord(parsed)) return null;
    const o = unwrapPersisted(parsed);
    const known = isV1(o) || SECTION_KEYS.some((k) => isRecord(ownValue(o, k)));
    return known ? sanitizeConfig(o) : null;
  } catch {
    return null;
  }
}
