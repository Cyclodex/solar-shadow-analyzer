import { NetError, fetchReadWithRetry, sleepWithSignal, type RetryOptions } from './fetchRetry';
import { lv95ToWgs84, wgs84ToLv95, type Lv95Point } from './lv95';
import { roundToStep } from './units';

// ─────────────────────────────────────────────
// SWISS ADDRESSES, BUILDING REGISTER AND GROUND HEIGHT (geo.admin.ch, Switzerland and Liechtenstein)
// Address search: SearchServer (origins=address, sr=2056), the official directory of building addresses of CH
// and FL. The point is the entrance coordinate of the federal building register (GWR); it comes to the
// millimetre from geom_st_box2d (LV95) and is converted with lv95.ts, so wgs84ToLv95 of the stored location gives
// the same point back (attrs.lat/lon are float32 and attrs.x/y are swapped: not used). attrs.num drops the
// letter and the dot of house numbers ("12a" → 12, "5.1" → 51): the number comes from the label.
// Exact match (docs.geo.admin.ch/access-data/search.html: "weight > 1000 indicates fuzzy search results"; weight
// 100 only appears when a postcode is typed, "Kramgasse 49 Bern" has weight 7): street and house number of the
// result appear in the typed text. Fuzzy hits are kept only when their house number was typed AND their street is
// spelled like typed words (streetResemblesQuery: at most one edit per 5 letters; a typo in the street:
// "Kramgase 49 Bern" → Kramgasse 49). SearchServer answers every query with a house number with fuzzy Swiss hits
// of that number, so foreign or unknown addresses give no addresses ("Stephansplatz 1 Wien" → "Wien-Strasse 2,
// 4053 Basel"; "Via Roma 1 Milano" → "Via Milano 1, 6830 Chiasso"; "Bahnhofstrasse 12a Zürich" → "Aubruggweg
// 12a", all dropped; recorded 2026-09-25). Abbreviations ("Bahnhofstr. 1") are normal hits, not fuzzy ones.
// Liechtenstein: the result detail ends in "… <BFS no.> <municipality> ch" without a canton, and the municipality
// numbers are 7001–7011 (all 11 FL municipalities checked 2026-09-25).
// Building register: …/ech/MapServer/ch.bfs.gebaeude_wohnungs_register/<EGID>_<EDID>; codes from the GWR
// Merkmalskatalog 4.2 (housing-stat.ch/files/881-2200.pdf). No record in Liechtenstein (HTTP 404 → null).
// Ground height: …/rest/services/height (LV95 → "height" in m, as a string; HTTP 400 outside the model).
// Nearest address: identify on the address layer with a tolerance circle (1 m per pixel), geometry to 0.1 m.
// Requests: fetchRetry.ts (backoff with jitter), at most API3_BUDGET per minute from this module (FSDI terms:
// "API Rest Services (general) | *.geo.admin.ch | 21 Mio requests / year | 40 requests / minute"): every attempt
// takes a slot, a retry after its backoff and fetchRetry's deadline check (its time limit starts once it has the
// slot). Results cached per query / feature / point. Nothing here throws: every call returns a GeoResult.
// ─────────────────────────────────────────────

export const API3_URL = 'https://api3.geo.admin.ch/rest/services';
export const SEARCH_SERVER_URL = `${API3_URL}/api/SearchServer`;
export const GWR_URL = `${API3_URL}/ech/MapServer/ch.bfs.gebaeude_wohnungs_register`;
export const HEIGHT_URL = `${API3_URL}/height`;
export const IDENTIFY_URL = `${API3_URL}/api/MapServer/identify`;
/** Layer of the official directory of building addresses (CH and FL), used for the nearest address. */
export const ADDRESS_LAYER = 'ch.swisstopo.amtliches-gebaeudeadressverzeichnis';

/** api3 requests this module starts per minute at most (FSDI limit: 40; room for the other geo.admin.ch users). */
export const API3_BUDGET = { requests: 30, windowMs: 60_000 } as const;
/** Results per address search (SearchServer allows up to 50). */
export const ADDRESS_SEARCH_LIMIT = 8;
/** SearchServer rejects a searchText with more than 10 words (HTTP 400). */
export const MAX_SEARCH_WORDS = 10;
/** Weights above this mark fuzzy SearchServer results (docs.geo.admin.ch, "Search"). */
export const FUZZY_WEIGHT = 1000;
/** Default radius of the nearest-address lookup, m. */
export const NEAREST_ADDRESS_RADIUS = 50;
/** Municipality numbers (BFS/FOS) of Liechtenstein: Vaduz 7001 … Schellenberg 7011. */
const LI_MUNICIPALITIES = { min: 7001, max: 7011 } as const;
/** Postcodes of Liechtenstein (9485 Nendeln … 9498 Planken); fallback when the detail cannot be read. */
const LI_POSTCODES = { min: 9485, max: 9498 } as const;
/** Entries kept per cache. */
const CACHE_SIZE = 50;

/** Retries of the interactive calls: a new keystroke aborts a search anyway, so keep the waits short. */
const SEARCH_RETRY: RetryOptions = { retries: 2, deadlineMs: 10_000, attemptTimeoutMs: 8_000 };
const DETAIL_RETRY: RetryOptions = { retries: 3, deadlineMs: 15_000, attemptTimeoutMs: 10_000 };

// ── Results and errors ───────────────────────

/** Why a geo.admin.ch call failed: fetchRetry's kinds, or 'invalid' (unexpected response or argument). */
export type GeoErrorKind = 'aborted' | 'network' | 'http' | 'timeout' | 'invalid';

export interface GeoError {
  kind: GeoErrorKind;
  /** HTTP status for kind 'http'. */
  status?: number;
  /** Technical message (English). */
  message: string;
}

export type GeoResult<T> = { ok: true; value: T } | { ok: false; error: GeoError };

export type AddressCountry = 'CH' | 'LI';

/**
 * How a search result relates to the typed text: 'exact' = its street and house number were typed,
 * 'partial' = a normal (prefix) hit, 'fuzzy' = SearchServer's fuzzy search (weight > 1000, similar spelling).
 */
export type AddressMatch = 'exact' | 'partial' | 'fuzzy';

/** A building address of Switzerland or Liechtenstein (entrance point of the building register). */
export interface SwissAddress {
  /** "Kramgasse 49, 3011 Bern" (without "#" for entrances without a number). */
  label: string;
  street: string;
  /** "49", "12a", "5.1"; '' when the entrance has no number ("#"). */
  houseNumber: string;
  postcode: string;
  /** Postal locality, e.g. "Bern", "Buchs SG". */
  locality: string;
  /** WGS84 degrees, rounded to 1e-6 (≤ 0.07 m). */
  latitude: number;
  longitude: number;
  /** Entrance point in LV95 as delivered (mm from the search, 0.1 m from identify). */
  lv95: Lv95Point;
  /** Building register feature id "<EGID>_<EDID>" (building and entrance). */
  featureId: string;
  egid: string;
  country: AddressCountry;
  /** IANA time zone: Europe/Zurich or Europe/Vaduz. */
  timezone: string;
  match: AddressMatch;
}

/** Construction period of the building register (GBAUP), inclusive years; null = open end. */
export interface ConstructionPeriod {
  code: number;
  from: number | null;
  to: number | null;
}

/** Building category codes of the building register (GKAT). */
export const BUILDING_CATEGORIES = [1010, 1020, 1030, 1040, 1060, 1080] as const;
export type BuildingCategory = (typeof BUILDING_CATEGORIES)[number];

/** Attributes of a building register (GWR) record; null where the register has no value. */
export interface BuildingInfo {
  egid: string;
  /** GASTW: storeys incl. ground floor; attics and basements only if (partly) lived in or heated; no cellars. */
  storeys: number | null;
  /** GBAUJ: year of construction. */
  year: number | null;
  /** GBAUP: construction period (often set when the year is not). */
  period: ConstructionPeriod | null;
  /** GAREA: footprint area, m² (from the cadastral survey). */
  area: number | null;
  /** GKAT: building category. */
  category: BuildingCategory | null;
}

/** GBAUP codes → periods (GWR Merkmalskatalog 4.2, "Codierung - Bauperiode"). */
const PERIODS: Record<number, [number | null, number | null]> = {
  8011: [null, 1918],
  8012: [1919, 1945],
  8013: [1946, 1960],
  8014: [1961, 1970],
  8015: [1971, 1980],
  8016: [1981, 1985],
  8017: [1986, 1990],
  8018: [1991, 1995],
  8019: [1996, 2000],
  8020: [2001, 2005],
  8021: [2006, 2010],
  8022: [2011, 2015],
  8023: [2016, null],
};

/** Construction period of a GBAUP code, null for unknown codes. */
export function constructionPeriod(code: unknown): ConstructionPeriod | null {
  if (typeof code !== 'number' || !Object.prototype.hasOwnProperty.call(PERIODS, code)) return null;
  const [from, to] = PERIODS[code];
  return { code, from, to };
}

// ── Request budget ───────────────────────────

/** Sliding-window request budget: `acquire` resolves when a request may start (rejects on abort). */
export interface RateLimiter {
  acquire: (signal?: AbortSignal) => Promise<void>;
}

export function createRateLimiter(
  max: number,
  windowMs: number,
  now: () => number = Date.now,
  sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void> = sleepWithSignal,
): RateLimiter {
  const started: number[] = [];
  return {
    async acquire(signal) {
      for (;;) {
        if (signal?.aborted) throw new NetError('aborted', '', 'The request was aborted.', 0);
        const t = now();
        while (started.length > 0 && started[0] <= t - windowMs) started.shift();
        if (started.length < max) {
          started.push(t);
          return;
        }
        await sleep(started[0] + windowMs - t, signal);
      }
    },
  };
}

let api3Limiter = createRateLimiter(API3_BUDGET.requests, API3_BUDGET.windowMs);

/** Options of every call: abort signal, fetch implementation and request budget (tests). */
export interface GeoOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Request budget; default the module's API3_BUDGET limiter, null = none (tests). */
  limiter?: RateLimiter | null;
  /** Overrides of the retry parameters (tests). */
  retry?: Omit<RetryOptions, 'signal' | 'fetchImpl'>;
}

// ── Caches ───────────────────────────────────

function lruGet<T>(cache: Map<string, T>, key: string): T | undefined {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function lruSet<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
}

const searchCache = new Map<string, SwissAddress[]>();
const buildingCache = new Map<string, BuildingInfo | null>();
const heightCache = new Map<string, number>();

/** Empties the result caches and restores the full request budget (tests). */
export function clearGeocodeCaches(): void {
  searchCache.clear();
  buildingCache.clear();
  heightCache.clear();
  api3Limiter = createRateLimiter(API3_BUDGET.requests, API3_BUDGET.windowMs);
}

// ── Request helper ───────────────────────────

function toGeoError(e: unknown): GeoError {
  if (e instanceof NetError) return { kind: e.kind, status: e.status, message: e.message };
  return { kind: 'invalid', message: e instanceof Error ? e.message : String(e) };
}

/**
 * GET `url` as JSON with retries, every attempt within the budget (the first one before fetchReadWithRetry, each
 * retry after its backoff: fetchRetry calls `sleep` once before every retry); typed errors instead of exceptions.
 */
async function getJson(url: string, opts: GeoOptions, retry: RetryOptions): Promise<GeoResult<unknown>> {
  const { signal, fetchImpl } = opts;
  const limiter = opts.limiter === undefined ? api3Limiter : opts.limiter;
  const backoff = opts.retry?.sleep ?? retry.sleep ?? sleepWithSignal;
  try {
    await limiter?.acquire(signal);
    const value = await fetchReadWithRetry(url, (res) => res.json() as Promise<unknown>, {
      ...retry,
      ...opts.retry,
      signal,
      fetchImpl,
      ...(limiter
        ? {
            sleep: async (ms: number, s: AbortSignal | undefined) => {
              await backoff(ms, s);
              await limiter.acquire(s);
            },
          }
        : {}),
    });
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: toGeoError(e) };
  }
}

const invalid = (message: string): { ok: false; error: GeoError } => ({
  ok: false,
  error: { kind: 'invalid', message },
});

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ── Text helpers ─────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** Label without markup ("Kramgasse 49 <b>3011 Bern</b>" → "Kramgasse 49 3011 Bern"). */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, k: string) => ENTITIES[k])
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Comparable form of a text: lower case, German umlauts as ae/oe/ue (the address detail spells "Städtle"
 * "staedtle"), other accents removed, punctuation as spaces; dots are kept only between digits ("5.1").
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

/** Text as sent to SearchServer: commas as spaces, single spaces, at most MAX_SEARCH_WORDS words. */
export function searchTextOf(query: string): string {
  return query
    .replace(/[,;]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_WORDS)
    .join(' ');
}

/** Numbers typed in a query ("Kramgasse 49 3011 Bern" → {49, 3011}), normalized like house numbers. */
function typedNumbers(normalizedQuery: string): Set<string> {
  return new Set(normalizedQuery.split(' ').filter((w) => /^\d/.test(w)));
}

/**
 * Edit distance of two strings: insertions, deletions, substitutions and swaps of two neighbouring letters count
 * one each (Damerau–Levenshtein, optimal string alignment; "kramgsase" → "kramgasse" is 1).
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);
  let before = new Array<number>(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d = Math.min(d, before[j - 2] + 1);
      row[j] = d;
    }
    [before, prev, row] = [prev, row, before];
  }
  return prev[b.length];
}

/** Letters of a street per allowed edit when a fuzzy hit is compared with the typed words (at least 1 edit). */
export const FUZZY_LETTERS_PER_EDIT = 5;

/**
 * A fuzzy hit's street is spelled like the typed text: some consecutive typed words without a digit (house
 * numbers and postcodes split the text), joined without spaces, are within max(1, ⌊letters / 5⌋) edits of the
 * street without spaces (both normalized). "Kramgase 49 Bern" ~ Kramgasse (1 of 1), "Rte de Lausanne 10" ~ Rue
 * de Lausanne (1 of 2), "Wienstrasse" ~ Wien-Strasse (0); "Via Roma 1 Milano" ≁ Via Milano, Via Rime (2 of 1).
 */
export function streetResemblesQuery(query: string, street: string): boolean {
  const target = normalizeText(street).replace(/ /g, '');
  if (!target) return false;
  const allowed = Math.max(1, Math.floor(target.length / FUZZY_LETTERS_PER_EDIT));
  const runs: string[][] = [[]];
  for (const word of normalizeText(query).split(' ')) {
    if (/\d/.test(word)) runs.push([]);
    else if (word) runs[runs.length - 1].push(word);
  }
  for (const run of runs) {
    for (let i = 0; i < run.length; i++) {
      let gram = '';
      for (let j = i; j < run.length && gram.length <= target.length + allowed; j++) {
        gram += run[j];
        if (Math.abs(gram.length - target.length) <= allowed && editDistance(gram, target) <= allowed) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Exact / partial / fuzzy, see the header. */
export function addressMatch(
  query: string,
  street: string,
  houseNumber: string,
  weight: number,
): AddressMatch {
  if (weight > FUZZY_WEIGHT) return 'fuzzy';
  const q = ` ${normalizeText(query)} `;
  const s = normalizeText(street);
  const n = normalizeText(houseNumber);
  if (!s || !n) return 'partial';
  return q.includes(` ${s} ${n} `) ? 'exact' : 'partial';
}

/**
 * Country of a SearchServer detail ("kramgasse 49 3011 bern 351 bern ch be", "staedtle 1 9490 vaduz 7001 vaduz
 * ch"): the municipality number before "ch", else the missing canton; the postcode when the detail is unusable.
 */
export function addressCountry(detail: string, postcode: string): AddressCountry {
  const words = detail.trim().toLowerCase().split(/\s+/);
  const ch = words.lastIndexOf('ch');
  if (ch > 0) {
    const municipality = words
      .slice(0, ch)
      .reverse()
      .find((w) => /^\d+$/.test(w));
    if (municipality !== undefined) {
      const n = Number(municipality);
      return n >= LI_MUNICIPALITIES.min && n <= LI_MUNICIPALITIES.max ? 'LI' : 'CH';
    }
    return ch === words.length - 1 ? 'LI' : 'CH';
  }
  const plz = Number(postcode);
  return plz >= LI_POSTCODES.min && plz <= LI_POSTCODES.max ? 'LI' : 'CH';
}

export const timeZoneOf = (country: AddressCountry): string =>
  country === 'LI' ? 'Europe/Vaduz' : 'Europe/Zurich';

/** "Kramgasse 49" → street "Kramgasse", number "49"; "Fösera #" → number ''; no number token → ''. */
function splitStreet(streetPart: string): { street: string; houseNumber: string } {
  const m = /^(.*\S)\s+(#|\d\S*)$/.exec(streetPart.trim());
  if (!m) return { street: streetPart.trim(), houseNumber: '' };
  return { street: m[1], houseNumber: m[2] === '#' ? '' : m[2] };
}

/** "3011 Bern" → postcode "3011", locality "Bern". */
function splitLocality(localityPart: string): { postcode: string; locality: string } {
  const m = /^(\d{4})\s+(.+)$/.exec(localityPart.trim());
  return m ? { postcode: m[1], locality: m[2] } : { postcode: '', locality: localityPart.trim() };
}

/** "Kramgasse 49, 3011 Bern"; "Fösera, 9470 Buchs SG" without a number. */
function addressLabel(street: string, houseNumber: string, postcode: string, locality: string): string {
  const first = houseNumber ? `${street} ${houseNumber}` : street;
  const second = [postcode, locality].filter(Boolean).join(' ');
  return second ? `${first}, ${second}` : first;
}

/** "BOX(2600863.761 1199640.374,2600863.761 1199640.374)" → centre in LV95; null when malformed. */
export function parseBox2d(box: unknown): Lv95Point | null {
  if (typeof box !== 'string') return null;
  const m = /^BOX\(\s*([\d.]+)\s+([\d.]+)\s*,\s*([\d.]+)\s+([\d.]+)\s*\)$/.exec(box.trim());
  if (!m) return null;
  const [e1, n1, e2, n2] = m.slice(1).map(Number);
  if (![e1, n1, e2, n2].every(Number.isFinite)) return null;
  const east = (e1 + e2) / 2;
  const north = (n1 + n2) / 2;
  // LV95 (not LV03 or degrees): E 2.4–2.9 M, N 1.0–1.4 M.
  if (east < 2_000_000 || east > 3_000_000 || north < 1_000_000 || north > 1_500_000) return null;
  return { east: Math.round(east * 1000) / 1000, north: Math.round(north * 1000) / 1000 };
}

/** WGS84 of an LV95 point, rounded to 1e-6° like config.location. */
function roundedWgs84(p: Lv95Point): { latitude: number; longitude: number } {
  const { latitude, longitude } = lv95ToWgs84(p.east, p.north);
  return { latitude: roundToStep(latitude, 1e-6), longitude: roundToStep(longitude, 1e-6) };
}

const FEATURE_ID = /^(\d+)_(\d+)$/;

/** One SearchServer result → SwissAddress (null when a required part is missing or malformed). */
export function parseSearchResult(r: unknown, query: string): SwissAddress | null {
  if (!isRecord(r) || !isRecord(r.attrs)) return null;
  const a = r.attrs;
  if (typeof a.label !== 'string' || typeof a.featureId !== 'string') return null;
  const fid = FEATURE_ID.exec(a.featureId);
  const lv95 = parseBox2d(a.geom_st_box2d);
  if (!fid || !lv95) return null;
  // "Kramgasse 49 <b>3011 Bern</b>": street part, then the locality in bold.
  const m = /^(.*?)<b>(.*?)<\/b>\s*$/.exec(a.label);
  const streetPart = stripTags(m ? m[1] : a.label);
  const { street, houseNumber } = splitStreet(streetPart);
  const { postcode, locality } = splitLocality(m ? stripTags(m[2]) : '');
  if (!street) return null;
  const weight = typeof r.weight === 'number' ? r.weight : 0;
  const country = addressCountry(typeof a.detail === 'string' ? a.detail : '', postcode);
  return {
    label: addressLabel(street, houseNumber, postcode, locality),
    street,
    houseNumber,
    postcode,
    locality,
    ...roundedWgs84(lv95),
    lv95,
    featureId: a.featureId,
    egid: fid[1],
    country,
    timezone: timeZoneOf(country),
    match: addressMatch(query, street, houseNumber, weight),
  };
}

const MATCH_ORDER: Record<AddressMatch, number> = { exact: 0, partial: 1, fuzzy: 2 };

/**
 * Results of a SearchServer response: fuzzy hits only with a typed house number and a street spelled like the
 * typed words, exact first, unique.
 */
export function parseSearchResponse(data: unknown, query: string): SwissAddress[] | null {
  if (!isRecord(data) || !Array.isArray(data.results)) return null;
  const numbers = typedNumbers(normalizeText(query));
  const seen = new Set<string>();
  const out: SwissAddress[] = [];
  for (const r of data.results) {
    const address = parseSearchResult(r, query);
    if (!address || seen.has(address.featureId)) continue;
    if (
      address.match === 'fuzzy' &&
      !(numbers.has(normalizeText(address.houseNumber)) && streetResemblesQuery(query, address.street))
    ) {
      continue;
    }
    seen.add(address.featureId);
    out.push(address);
  }
  // Array.prototype.sort is stable: SearchServer's order stays within each class.
  return out.sort((x, y) => MATCH_ORDER[x.match] - MATCH_ORDER[y.match]);
}

// ── Public API ───────────────────────────────

/** Queries shorter than this (after trimming) are not sent. */
export const MIN_ADDRESS_QUERY_LENGTH = 2;

/**
 * Address search in Switzerland and Liechtenstein (SearchServer). ok [] for short queries (no request) and when
 * nothing matches; results are cached per query text. Never throws.
 */
export async function searchSwissAddresses(
  query: string,
  opts: GeoOptions & { limit?: number } = {},
): Promise<GeoResult<SwissAddress[]>> {
  const text = searchTextOf(typeof query === 'string' ? query : '');
  if (text.length < MIN_ADDRESS_QUERY_LENGTH) return { ok: true, value: [] };
  const limit = Math.min(50, Math.max(1, Math.round(opts.limit ?? ADDRESS_SEARCH_LIMIT)));
  const key = `${limit}|${text.toLowerCase()}`;
  const cached = lruGet(searchCache, key);
  if (cached) return { ok: true, value: cached.map((a) => ({ ...a })) };
  const params = new URLSearchParams({
    searchText: text,
    type: 'locations',
    origins: 'address',
    sr: '2056',
    limit: String(limit),
  });
  const res = await getJson(`${SEARCH_SERVER_URL}?${params.toString()}`, opts, SEARCH_RETRY);
  if (!res.ok) return res;
  const addresses = parseSearchResponse(res.value, text);
  if (!addresses) return invalid('SearchServer: no results array');
  lruSet(searchCache, key, addresses);
  return { ok: true, value: addresses.map((a) => ({ ...a })) };
}

/** Integer attribute within [min, max], else null. */
function intIn(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

/** Attributes of a GWR feature response → BuildingInfo (null when the response has no feature). */
export function parseBuildingInfo(data: unknown, now: Date = new Date()): BuildingInfo | null {
  if (!isRecord(data) || !isRecord(data.feature) || !isRecord(data.feature.attributes)) return null;
  const a = data.feature.attributes;
  const egid = typeof a.egid === 'string' || typeof a.egid === 'number' ? String(a.egid) : '';
  if (!/^\d+$/.test(egid)) return null;
  const category = intIn(a.gkat, 1010, 1080);
  return {
    egid,
    // Value ranges of the Merkmalskatalog: storeys 1–99, year 1000 – current year, area 1–99'999 m².
    storeys: intIn(a.gastw, 1, 99),
    year: intIn(a.gbauj, 1000, now.getFullYear()),
    period: constructionPeriod(a.gbaup),
    area: intIn(a.garea, 1, 99_999),
    category:
      category !== null && (BUILDING_CATEGORIES as readonly number[]).includes(category)
        ? (category as BuildingCategory)
        : null,
  };
}

/**
 * Building register record of an address (featureId "<EGID>_<EDID>" from the search). ok null when the register
 * has no record (HTTP 404, e.g. every address in Liechtenstein). Cached per feature. Never throws.
 */
export async function fetchBuildingInfo(
  featureId: string,
  opts: GeoOptions = {},
): Promise<GeoResult<BuildingInfo | null>> {
  if (typeof featureId !== 'string' || !FEATURE_ID.test(featureId)) return invalid('Invalid feature id');
  if (buildingCache.has(featureId)) {
    const hit = lruGet(buildingCache, featureId) ?? null;
    return { ok: true, value: hit && { ...hit } };
  }
  const res = await getJson(`${GWR_URL}/${featureId}`, opts, DETAIL_RETRY);
  if (!res.ok) {
    if (res.error.kind === 'http' && res.error.status === 404) {
      lruSet(buildingCache, featureId, null);
      return { ok: true, value: null };
    }
    return res;
  }
  const info = parseBuildingInfo(res.value);
  if (!info) return invalid('Building register: no feature attributes');
  lruSet(buildingCache, featureId, info);
  return { ok: true, value: { ...info } };
}

/**
 * Ground height (m above sea level, LHN95, 0.1 m) at an LV95 point from the height service. HTTP 400 outside the
 * height model (kind 'http'). Cached per point (1 cm). Never throws.
 */
export async function fetchGroundHeight(point: Lv95Point, opts: GeoOptions = {}): Promise<GeoResult<number>> {
  if (!point || !Number.isFinite(point.east) || !Number.isFinite(point.north)) {
    return invalid('Invalid LV95 point');
  }
  const easting = point.east.toFixed(2);
  const northing = point.north.toFixed(2);
  const key = `${easting}|${northing}`;
  const cached = lruGet(heightCache, key);
  if (cached !== undefined) return { ok: true, value: cached };
  const res = await getJson(
    `${HEIGHT_URL}?easting=${easting}&northing=${northing}&sr=2056`,
    opts,
    DETAIL_RETRY,
  );
  if (!res.ok) return res;
  const raw = isRecord(res.value) ? res.value.height : undefined;
  const height = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  if (!Number.isFinite(height)) return invalid('Height service: no height');
  const value = roundToStep(height, 0.1);
  lruSet(heightCache, key, value);
  return { ok: true, value };
}

/** Nearest address to a position and its distance (m, from the 0.1 m point of the address layer). */
export interface NearestAddress {
  address: SwissAddress;
  distance: number;
}

/** One feature of the identify response (address layer, GeoJSON) → SwissAddress; null when incomplete. */
export function parseAddressFeature(f: unknown): SwissAddress | null {
  if (!isRecord(f) || !isRecord(f.properties) || !isRecord(f.geometry)) return null;
  const p = f.properties;
  const coords = f.geometry.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [east, north] = coords as unknown[];
  if (typeof east !== 'number' || typeof north !== 'number') return null;
  if (typeof p.stn_label !== 'string' || !p.stn_label.trim()) return null;
  const egid = intIn(p.bdg_egid, 1, Number.MAX_SAFE_INTEGER);
  const edid = intIn(p.adr_edid, 0, Number.MAX_SAFE_INTEGER);
  if (egid === null || edid === null) return null;
  const street = p.stn_label.trim();
  const houseNumber = typeof p.adr_number === 'string' ? p.adr_number.trim() : '';
  const { postcode, locality } = splitLocality(typeof p.zip_label === 'string' ? p.zip_label : '');
  const fos = intIn(p.com_fosnr, 1, 99_999);
  const country: AddressCountry =
    fos !== null
      ? fos >= LI_MUNICIPALITIES.min && fos <= LI_MUNICIPALITIES.max
        ? 'LI'
        : 'CH'
      : addressCountry('', postcode);
  const lv95 = { east, north };
  return {
    label: addressLabel(street, houseNumber, postcode, locality),
    street,
    houseNumber,
    postcode,
    locality,
    ...roundedWgs84(lv95),
    lv95,
    featureId: `${egid}_${edid}`,
    egid: String(egid),
    country,
    timezone: timeZoneOf(country),
    match: 'exact',
  };
}

/**
 * Nearest building address within `radius` m (default NEAREST_ADDRESS_RADIUS) of a WGS84 position: identify on
 * the address layer (CH and FL). ok null when there is none (also outside Switzerland and Liechtenstein).
 * Never throws.
 */
export async function findNearestAddress(
  latitude: number,
  longitude: number,
  opts: GeoOptions & { radius?: number } = {},
): Promise<GeoResult<NearestAddress | null>> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return invalid('Invalid position');
  const radius = Math.min(200, Math.max(5, Math.round(opts.radius ?? NEAREST_ADDRESS_RADIUS)));
  const p = wgs84ToLv95(latitude, longitude);
  const e = p.east.toFixed(1);
  const n = p.north.toFixed(1);
  const extent = [p.east - radius, p.north - radius, p.east + radius, p.north + radius].map((v) =>
    v.toFixed(1),
  );
  // 1 m per pixel: the tolerance (pixels) is the search radius in metres.
  const params = new URLSearchParams({
    geometry: `${e},${n}`,
    geometryType: 'esriGeometryPoint',
    layers: `all:${ADDRESS_LAYER}`,
    tolerance: String(radius),
    mapExtent: extent.join(','),
    imageDisplay: `${2 * radius},${2 * radius},96`,
    sr: '2056',
    returnGeometry: 'true',
    geometryFormat: 'geojson',
  });
  const res = await getJson(`${IDENTIFY_URL}?${params.toString()}`, opts, DETAIL_RETRY);
  if (!res.ok) return res;
  if (!isRecord(res.value) || !Array.isArray(res.value.results)) return invalid('Identify: no results array');
  let best: NearestAddress | null = null;
  for (const f of res.value.results) {
    const address = parseAddressFeature(f);
    if (!address) continue;
    const distance = Math.hypot(address.lv95.east - p.east, address.lv95.north - p.north);
    if (distance <= radius && (!best || distance < best.distance)) best = { address, distance };
  }
  return { ok: true, value: best };
}
