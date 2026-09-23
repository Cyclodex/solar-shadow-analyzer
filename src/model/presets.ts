import type { Lang, LocationConfig, PanelConfig } from './types';
import { LIMITS } from './defaults';
import { canonicalTimeZone, sanitizeConfig } from './share';
import { clamp, roundToStep } from './units';

// ─────────────────────────────────────────────
// LOCATION & MODULE PRESETS, PLACE SEARCH
// ─────────────────────────────────────────────

export interface LocationPreset {
  /** Stable slug, e.g. "bern". */
  id: string;
  /** Local display name, e.g. "Genève". */
  name: string;
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  latitude: number;
  longitude: number;
  /** IANA time zone. */
  timezone: string;
  /** m above sea level. */
  elevation: number;
}

export interface ModulePreset {
  id: string;
  /** German label with typical values, e.g. "Typ. 108 Zellen · 1722×1134 mm · 425 Wp". */
  label: string;
  /** Short side, cm (= PanelConfig.length: hangs down the slope in landscape mounting). */
  length: number;
  /** Long side, cm (= PanelConfig.width: along the railing). */
  width: number;
  /** Typical rated power, Wp. */
  powerWp: number;
  /** Number of cells per datasheet (for building localized labels). */
  cells: number;
}

/**
 * Source: Open-Meteo Geocoding API (GeoNames data), https://geocoding-api.open-meteo.com/v1/search
 * ?name=…&language=de&countryCode=…, queried 2026-09-23; first populated-place result (feature code PPL*,
 * GeoNames id in the comment). Latitude/longitude rounded to 4 decimals (roundToStep 1e-4), elevation in m.
 * Sion was queried by its German name "Sitten" (the query "Sion" only returns the airport).
 */
export const LOCATION_PRESETS: readonly LocationPreset[] = [
  // Switzerland
  { id: 'bern', name: 'Bern', country: 'CH', latitude: 46.9481, longitude: 7.4474, timezone: 'Europe/Zurich', elevation: 549 }, // 2661552
  { id: 'zuerich', name: 'Zürich', country: 'CH', latitude: 47.3667, longitude: 8.55, timezone: 'Europe/Zurich', elevation: 429 }, // 2657896
  { id: 'basel', name: 'Basel', country: 'CH', latitude: 47.5584, longitude: 7.5733, timezone: 'Europe/Zurich', elevation: 279 }, // 2661604
  { id: 'geneve', name: 'Genève', country: 'CH', latitude: 46.2022, longitude: 6.1457, timezone: 'Europe/Zurich', elevation: 400 }, // 2660646
  { id: 'lausanne', name: 'Lausanne', country: 'CH', latitude: 46.516, longitude: 6.6328, timezone: 'Europe/Zurich', elevation: 453 }, // 2659994
  { id: 'luzern', name: 'Luzern', country: 'CH', latitude: 47.0505, longitude: 8.3064, timezone: 'Europe/Zurich', elevation: 437 }, // 2659811
  { id: 'st-gallen', name: 'St. Gallen', country: 'CH', latitude: 47.4239, longitude: 9.3748, timezone: 'Europe/Zurich', elevation: 684 }, // 2658822
  { id: 'lugano', name: 'Lugano', country: 'CH', latitude: 46.0101, longitude: 8.96, timezone: 'Europe/Zurich', elevation: 284 }, // 2659836
  { id: 'chur', name: 'Chur', country: 'CH', latitude: 46.8499, longitude: 9.5329, timezone: 'Europe/Zurich', elevation: 601 }, // 2661169
  { id: 'sion', name: 'Sion', country: 'CH', latitude: 46.2274, longitude: 7.3556, timezone: 'Europe/Zurich', elevation: 500 }, // 2658576
  { id: 'winterthur', name: 'Winterthur', country: 'CH', latitude: 47.5056, longitude: 8.7241, timezone: 'Europe/Zurich', elevation: 441 }, // 2657970
  { id: 'biel-bienne', name: 'Biel/Bienne', country: 'CH', latitude: 47.1371, longitude: 7.2461, timezone: 'Europe/Zurich', elevation: 434 }, // 2661513
  { id: 'thun', name: 'Thun', country: 'CH', latitude: 46.7512, longitude: 7.6217, timezone: 'Europe/Zurich', elevation: 560 }, // 2658377
  { id: 'fribourg', name: 'Fribourg', country: 'CH', latitude: 46.8024, longitude: 7.1513, timezone: 'Europe/Zurich', elevation: 610 }, // 2660718
  // Austria
  { id: 'wien', name: 'Wien', country: 'AT', latitude: 48.2085, longitude: 16.3721, timezone: 'Europe/Vienna', elevation: 171 }, // 2761369
  { id: 'innsbruck', name: 'Innsbruck', country: 'AT', latitude: 47.2627, longitude: 11.3945, timezone: 'Europe/Vienna', elevation: 570 }, // 2775220
  { id: 'graz', name: 'Graz', country: 'AT', latitude: 47.0673, longitude: 15.442, timezone: 'Europe/Vienna', elevation: 362 }, // 2778067
  // Germany
  { id: 'muenchen', name: 'München', country: 'DE', latitude: 48.1374, longitude: 11.5755, timezone: 'Europe/Berlin', elevation: 524 }, // 2867714
  { id: 'stuttgart', name: 'Stuttgart', country: 'DE', latitude: 48.7823, longitude: 9.177, timezone: 'Europe/Berlin', elevation: 252 }, // 2825297
  { id: 'freiburg-im-breisgau', name: 'Freiburg im Breisgau', country: 'DE', latitude: 47.9959, longitude: 7.8522, timezone: 'Europe/Berlin', elevation: 278 }, // 2925177
  { id: 'berlin', name: 'Berlin', country: 'DE', latitude: 52.5244, longitude: 13.4105, timezone: 'Europe/Berlin', elevation: 74 }, // 2950159
  { id: 'hamburg', name: 'Hamburg', country: 'DE', latitude: 53.5507, longitude: 9.993, timezone: 'Europe/Berlin', elevation: 9 }, // 2911298
  { id: 'koeln', name: 'Köln', country: 'DE', latitude: 50.9333, longitude: 6.95, timezone: 'Europe/Berlin', elevation: 58 }, // 2886242
  { id: 'frankfurt-am-main', name: 'Frankfurt am Main', country: 'DE', latitude: 50.1155, longitude: 8.6842, timezone: 'Europe/Berlin', elevation: 113 }, // 2925533
];

/**
 * Common crystalline module formats, dimensions and cell counts from manufacturer datasheets; power = a value
 * inside the datasheet's power range (labelled "Typ."). Sorted by long side.
 */
export const MODULE_PRESETS: readonly ModulePreset[] = [
  // LONGi Hi-MO 6 Explorer LR5-54HTH 415~435M: 108 (6×18) cells, 1722×1134×30 mm.
  { id: 'c108-1722x1134', label: 'Typ. 108 Zellen · 1722×1134 mm · 425 Wp', length: 113.4, width: 172.2, powerWp: 425, cells: 108 },
  // LONGi Hi-MO 4m LR4-60HPH 350~380M (datasheet 20200401): 120 (6×20) cells, 1755×1038×35 mm.
  { id: 'c120-1755x1038', label: 'Typ. 120 Zellen · 1755×1038 mm · 365 Wp', length: 103.8, width: 175.5, powerWp: 365, cells: 120 },
  // Trina Vertex S+ TSM-NEG9R.28 (datasheet EN 2024 C): 430–460 W, 144 cells, 1762×1134×30 mm. = DEFAULT_CONFIG panels.
  { id: 'c144-1762x1134', label: 'Typ. 144 Zellen · 1762×1134 mm · 430 Wp', length: 113.4, width: 176.2, powerWp: 430, cells: 144 },
  // Trina Vertex S+ TSM-NEG18R.28 (datasheet EN 2024 A): 475–505 W, 108 cells, 1961×1134×30 mm.
  { id: 'c108-1961x1134', label: 'Typ. 108 Zellen · 1961×1134 mm · 490 Wp', length: 113.4, width: 196.1, powerWp: 490, cells: 108 },
  // LONGi Hi-MO 6 LR5-72HTH 590~600M and JA Solar JAM72D40 GB 570–595 W: 144 (6×24) cells, 2278×1134×30 mm.
  { id: 'c144-2278x1134', label: 'Typ. 144 Zellen · 2278×1134 mm · 590 Wp', length: 113.4, width: 227.8, powerWp: 590, cells: 144 },
];

/** LocationConfig for a preset (display name = preset name). */
export function presetToLocation(p: LocationPreset): LocationConfig {
  return { name: p.name, latitude: p.latitude, longitude: p.longitude, timezone: p.timezone, elevation: p.elevation };
}

/** Preset at the same coordinates (±0.00005°, i.e. equal after 4-decimal rounding), if any. */
export function findLocationPreset(loc: Pick<LocationConfig, 'latitude' | 'longitude'>): LocationPreset | undefined {
  const eps = 5e-5;
  return LOCATION_PRESETS.find(
    (p) => Math.abs(p.latitude - loc.latitude) < eps && Math.abs(p.longitude - loc.longitude) < eps,
  );
}

/** Module preset with the same dimensions (either orientation) and power, if any. */
export function findModulePreset(panels: Pick<PanelConfig, 'length' | 'width' | 'powerWp'>): ModulePreset | undefined {
  const eq = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  return MODULE_PRESETS.find(
    (m) =>
      eq(m.powerWp, panels.powerWp) &&
      ((eq(m.length, panels.length) && eq(m.width, panels.width)) ||
        (eq(m.length, panels.width) && eq(m.width, panels.length))),
  );
}

// ── Place search (Open-Meteo geocoding) ──────

export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/**
 * Swiss canton codes by GeoNames admin1 id (language independent). Ids from the Open-Meteo geocoding API
 * (admin1_id of each canton capital, queried 2026-09-23).
 */
const CANTON_BY_ADMIN1_ID: Readonly<Record<number, string>> = {
  2657895: 'ZH', 2661551: 'BE', 2659810: 'LU', 2658226: 'UR', 2658664: 'SZ', 2659315: 'OW', 2659471: 'NW',
  2660593: 'GL', 2657907: 'ZG', 2660717: 'FR', 2658563: 'SO', 2661602: 'BS', 2661603: 'BL', 2658760: 'SH',
  2661739: 'AR', 2661741: 'AI', 2658821: 'SG', 2660522: 'GR', 2661876: 'AG', 2658372: 'TG', 2658370: 'TI',
  2658182: 'VD', 2658205: 'VS', 2659495: 'NE', 2660645: 'GE', 2660207: 'JU',
};

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * "Name, Region, CC": Swiss cantons as code ("Bern, BE, CH"); other regions by name, omitted when they
 * contain the place name as a word ("Berlin, DE" instead of "Berlin, Land Berlin, DE").
 */
function placeLabel(name: string, admin1: string, admin1Id: unknown, country: string): string {
  const parts = [name];
  const canton = country === 'CH' && typeof admin1Id === 'number' ? CANTON_BY_ADMIN1_ID[admin1Id] : undefined;
  if (canton) parts.push(canton);
  else if (admin1 && !` ${admin1} `.includes(` ${name} `)) parts.push(admin1);
  if (country) parts.push(country);
  return parts.join(', ');
}

/**
 * Maps one Open-Meteo geocoding result to a LocationConfig. Null when name, coordinates, elevation or a valid
 * time zone are missing (all are needed for a correct analysis). The result is a fixed point of sanitizeConfig
 * (label length / control characters normalized like any location name).
 */
export function geocodingResultToLocation(r: unknown): LocationConfig | null {
  if (!isRecord(r)) return null;
  const name = str(r.name);
  const { latitude: latL, longitude: lonL, elevation: elL } = LIMITS.location;
  const { latitude, longitude, elevation } = r;
  if (!name || typeof latitude !== 'number' || typeof longitude !== 'number' || typeof elevation !== 'number') {
    return null;
  }
  if (![latitude, longitude, elevation].every(Number.isFinite)) return null;
  const timezone = canonicalTimeZone(r.timezone);
  if (!timezone) return null;
  const location: LocationConfig = {
    name: placeLabel(name, str(r.admin1), r.admin1_id, str(r.country_code).toUpperCase()),
    latitude: clamp(roundToStep(latitude, 1e-4), latL.min, latL.max),
    longitude: clamp(roundToStep(longitude, 1e-4), lonL.min, lonL.max),
    timezone,
    elevation: clamp(Math.round(elevation), elL.min, elL.max),
  };
  return sanitizeConfig({ location }).location;
}

/**
 * Place search via the Open-Meteo geocoding API (names in `lang`). Returns [] for queries shorter than
 * 2 characters and on any error (network, HTTP, JSON, abort). Duplicates (same label and coordinates) are removed.
 */
export async function searchLocations(
  query: string,
  lang: Lang,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch; count?: number } = {},
): Promise<LocationConfig[]> {
  const q = typeof query === 'string' ? query.trim() : '';
  if (q.length < 2) return [];
  const n = Math.round(opts.count ?? 10);
  const count = Number.isNaN(n) ? 10 : clamp(n, 1, 100);
  const url = `${GEOCODING_URL}?name=${encodeURIComponent(q)}&count=${count}&language=${lang}&format=json`;
  const doFetch = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  try {
    const res = await doFetch(url, { signal: opts.signal });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!isRecord(data) || !Array.isArray(data.results)) return [];
    const seen = new Set<string>();
    const out: LocationConfig[] = [];
    for (const r of data.results) {
      const loc = geocodingResultToLocation(r);
      if (!loc) continue;
      const key = `${loc.name}|${loc.latitude}|${loc.longitude}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(loc);
    }
    return out;
  } catch {
    return [];
  }
}
