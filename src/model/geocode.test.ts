import { afterEach, describe, expect, it, vi } from 'vitest';
import fixtures from './geocode.fixtures.json';
import {
  ADDRESS_SEARCH_LIMIT,
  API3_BUDGET,
  GWR_URL,
  HEIGHT_URL,
  IDENTIFY_URL,
  SEARCH_SERVER_URL,
  addressCountry,
  addressMatch,
  clearGeocodeCaches,
  constructionPeriod,
  createRateLimiter,
  editDistance,
  fetchBuildingInfo,
  fetchGroundHeight,
  findNearestAddress,
  normalizeText,
  parseBox2d,
  parseBuildingInfo,
  parseSearchResponse,
  searchSwissAddresses,
  searchTextOf,
  streetResemblesQuery,
  stripTags,
  type GeoOptions,
  type RateLimiter,
} from './geocode';
import { lv95ToWgs84, wgs84ToLv95 } from './lv95';

// Fixtures: verbatim geo.admin.ch responses recorded on 2026-09-25 (see "_" in the JSON).
const SEARCH = fixtures.search as Record<string, unknown>;
const GWR = fixtures.gwr as Record<string, { status: number; body: unknown }>;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** fetch stub answering every request with `respond(url)`; records the URLs. */
function stubFetch(
  respond: (url: string) => Response | Promise<Response>,
): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const f = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return respond(url);
  });
  return Object.assign(f as unknown as typeof fetch, { urls });
}

/** No request budget and instant retries (the defaults wait 1 s, 2 s …). */
const FAST: GeoOptions = { limiter: null, retry: { sleep: () => Promise.resolve(), random: () => 0 } };

afterEach(() => clearGeocodeCaches());

describe('text helpers', () => {
  it('strips the markup of labels and decodes entities', () => {
    expect(stripTags('Kramgasse 49 <b>3011 Bern</b>')).toBe('Kramgasse 49 3011 Bern');
    expect(stripTags('Rue de l&#39;H&ocirc;pital <b>2000</b>')).toBe("Rue de l'H&ocirc;pital 2000");
  });

  it('normalizes umlauts like the SearchServer detail, keeps dotted numbers', () => {
    expect(normalizeText('Städtle 1, Vaduz')).toBe('staedtle 1 vaduz');
    expect(normalizeText('Rue du Rhône 48')).toBe('rue du rhone 48');
    expect(normalizeText('Seestrasse 5.1')).toBe('seestrasse 5.1');
    expect(normalizeText('Breitenrainstr. 10')).toBe('breitenrainstr 10');
  });

  it('sends at most 10 words (SearchServer answers HTTP 400 beyond) and no commas', () => {
    expect(searchTextOf('  Kramgasse 49,3011   Bern ')).toBe('Kramgasse 49 3011 Bern');
    expect(searchTextOf('a b c d e f g h i j k l').split(' ')).toHaveLength(10);
  });

  it('reads the LV95 point of geom_st_box2d to the millimetre and rejects other boxes', () => {
    expect(parseBox2d('BOX(2600863.761 1199640.3740000017,2600863.761 1199640.3740000017)')).toEqual({
      east: 2600863.761,
      north: 1199640.374,
    });
    expect(parseBox2d('BOX(600863.7 199640.3,600863.7 199640.3)')).toBeNull(); // LV03
    expect(parseBox2d('BOX(7.45 46.9,7.45 46.9)')).toBeNull(); // degrees
    expect(parseBox2d('POINT(1 2)')).toBeNull();
    expect(parseBox2d(undefined)).toBeNull();
  });

  it('construction periods of the building register (GBAUP)', () => {
    expect(constructionPeriod(8011)).toEqual({ code: 8011, from: null, to: 1918 });
    expect(constructionPeriod(8017)).toEqual({ code: 8017, from: 1986, to: 1990 });
    expect(constructionPeriod(8023)).toEqual({ code: 8023, from: 2016, to: null });
    expect(constructionPeriod(8024)).toBeNull();
    expect(constructionPeriod('8011')).toBeNull();
  });
});

describe('addressMatch and addressCountry', () => {
  it('exact = street and house number typed; weight > 1000 = fuzzy', () => {
    expect(addressMatch('Kramgasse 49 Bern', 'Kramgasse', '49', 7)).toBe('exact');
    expect(addressMatch('kramgasse 49', 'Kramgasse', '49', 100)).toBe('exact');
    expect(addressMatch('Kramgasse 4', 'Kramgasse', '40', 5)).toBe('partial');
    expect(addressMatch('Staedtle 1', 'Städtle', '1', 7)).toBe('exact');
    expect(addressMatch('Dorfstrasse 12A Gals', 'Dorfstrasse', '12a', 7)).toBe('exact');
    expect(addressMatch('Seestrasse 5.1', 'Seestrasse', '5.1', 100)).toBe('exact');
    expect(addressMatch('Fösera', 'Fösera', '', 1)).toBe('partial'); // no number
    expect(addressMatch('Kramgasse 49 Bern', 'Kramgasse', '49', 1575)).toBe('fuzzy');
  });

  it('Liechtenstein from the municipality number or the missing canton, else the postcode', () => {
    expect(addressCountry('kramgasse 49 3011 bern 351 bern ch be', '3011')).toBe('CH');
    expect(addressCountry('staedtle 1 9490 vaduz 7001 vaduz ch', '9490')).toBe('LI');
    expect(addressCountry('platta 1 9488 schellenberg 7011 schellenberg ch', '9488')).toBe('LI');
    expect(addressCountry('foesera # 9470 buchs sg 3275 sevelen ch sg', '9470')).toBe('CH');
    expect(addressCountry('kirchstrasse 5.1 8638 goldingen 3342 eschenbach _sg_ ch sg', '8638')).toBe('CH');
    expect(addressCountry('irgendwo ch', '')).toBe('LI');
    expect(addressCountry('', '9494')).toBe('LI');
    expect(addressCountry('', '9470')).toBe('CH');
  });
});

describe('parseSearchResponse (recorded responses)', () => {
  it('Kramgasse 49 Bern: label, LV95 → WGS84 (1e-6), feature id, time zone', () => {
    const [a, ...rest] = parseSearchResponse(SEARCH['Kramgasse 49 Bern'], 'Kramgasse 49 Bern')!;
    expect(rest).toHaveLength(0);
    expect(a).toEqual({
      label: 'Kramgasse 49, 3011 Bern',
      street: 'Kramgasse',
      houseNumber: '49',
      postcode: '3011',
      locality: 'Bern',
      latitude: 46.947847,
      longitude: 7.449979,
      lv95: { east: 2600863.761, north: 1199640.374 },
      featureId: '1230393_0',
      egid: '1230393',
      country: 'CH',
      timezone: 'Europe/Zurich',
      match: 'exact',
    });
    // The stored degrees lead back to the entrance point (lv95.ts both ways; 1e-6° ≤ 0.07 m).
    const back = wgs84ToLv95(a.latitude, a.longitude);
    expect(Math.hypot(back.east - a.lv95.east, back.north - a.lv95.north)).toBeLessThan(0.07);
    const exact = lv95ToWgs84(a.lv95.east, a.lv95.north);
    expect(Math.abs(exact.latitude - a.latitude)).toBeLessThanOrEqual(5e-7);
    expect(Math.abs(exact.longitude - a.longitude)).toBeLessThanOrEqual(5e-7);
    // REFRAME (geodesy.geo.admin.ch, 2026-09-25): 46.94784751°, 7.44997834° → within 0.1 m.
    expect(Math.abs(a.latitude - 46.94784751) * 111_200).toBeLessThan(0.1);
    expect(Math.abs(a.longitude - 7.44997834) * 76_000).toBeLessThan(0.1);
  });

  it('exact hits first, partial ones after (weight 100 is not needed)', () => {
    const list = parseSearchResponse(SEARCH['Kramgasse 4'], 'Kramgasse 4')!;
    expect(list.map((a) => [a.label, a.match])).toEqual([
      ['Kramgasse 4, 3506 Grosshöchstetten', 'exact'],
      ['Kramgasse 4, 3011 Bern', 'exact'],
      ['Kramgasse 4a, 3506 Grosshöchstetten', 'partial'],
      ['Kramgasse 40, 3011 Bern', 'partial'],
      ['Kramgasse 41, 3011 Bern', 'partial'],
      ['Kramgasse 43, 3011 Bern', 'partial'],
    ]);
  });

  it('keeps fuzzy hits only with a typed house number and a street spelled like the typed words', () => {
    const typo = parseSearchResponse(SEARCH['Kramgase 49 Bern'], 'Kramgase 49 Bern')!;
    // Recorded: Kramgasse 49, Bernstrasse 49, Kramgasse 1, Kramgasse 2 (all fuzzy).
    expect(typo.map((a) => [a.label, a.match])).toEqual([['Kramgasse 49, 3011 Bern', 'fuzzy']]);
    // Without the locality, SearchServer adds number-49 streets of all Switzerland (Obergasse, Plaz Cadruvi …).
    const bare = parseSearchResponse(SEARCH['Kramgase 49'], 'Kramgase 49')!;
    expect((SEARCH['Kramgase 49'] as { results: unknown[] }).results).toHaveLength(8);
    expect(bare.map((a) => a.label)).toEqual(['Kramgasse 49, 3011 Bern']);
    // A typo in the street type: "Rte" ~ "Rue" (1 edit of 2); Avenue de Morges 10 and 10.1 are dropped.
    const rte = parseSearchResponse(SEARCH['Rte de Lausanne 10 Morges'], 'Rte de Lausanne 10 Morges')!;
    expect(rte.map((a) => [a.label, a.match])).toEqual([['Rue de Lausanne 10, 1110 Morges', 'fuzzy']]);
  });

  it('foreign or unknown street addresses: no Swiss look-alikes', () => {
    // Recorded: only fuzzy Swiss hits with the typed number (Wien-Strasse, Via Milano 1, Via Rime 1, Ruelle de
    // Paris 10, Rue du Jura 10, Aubruggweg 12a, Frankengasse 12a …).
    for (const q of [
      'Stephansplatz 1 Wien',
      'Via Roma 1 Milano',
      'Rue de Rivoli 10 Paris',
      'Bahnhofstrasse 12a Zürich',
    ]) {
      const results = (SEARCH[q] as { results: { weight: number }[] }).results;
      expect(results.length, q).toBeGreaterThan(0);
      expect(results.every((r) => r.weight > 1000)).toBe(true);
      expect(parseSearchResponse(SEARCH[q], q), q).toEqual([]);
    }
  });

  it('street similarity: edits per letters, word runs split by numbers', () => {
    expect(editDistance('kramgase', 'kramgasse')).toBe(1);
    expect(editDistance('kramgsase', 'kramgasse')).toBe(1); // swapped letters
    expect(editDistance('viarime', 'viaroma')).toBe(2);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('bern', 'bern')).toBe(0);
    expect(streetResemblesQuery('Kramgase 49 Bern', 'Kramgasse')).toBe(true);
    expect(streetResemblesQuery('Bern Kramgase 49', 'Kramgasse')).toBe(true);
    expect(streetResemblesQuery('Kramgase 49 Bern', 'Bernstrasse')).toBe(false);
    expect(streetResemblesQuery('Breitenrain strase 10', 'Breitenrainstrasse')).toBe(true);
    expect(streetResemblesQuery('Wienstrasse 2', 'Wien-Strasse')).toBe(true);
    expect(streetResemblesQuery('Stephansplatz 1 Wien', 'Wien-Strasse')).toBe(false);
    expect(streetResemblesQuery('Via Roma 1 Milano', 'Via Milano')).toBe(false); // "via" and "milano" not adjacent
    expect(streetResemblesQuery('Via Roma 1 Milano', 'Via Rime')).toBe(false); // 2 edits, 7 letters allow 1
    expect(streetResemblesQuery('Via Roma 1', 'Via Rom')).toBe(true);
    expect(streetResemblesQuery('Städtle 1 Vadus', 'Städtle')).toBe(true); // umlaut as "ae" on both sides
    expect(streetResemblesQuery('Kramgase 49', '')).toBe(false);
  });

  it('Liechtenstein: Europe/Vaduz', () => {
    const [vaduz] = parseSearchResponse(SEARCH['Städtle 1 Vaduz'], 'Städtle 1 Vaduz')!;
    expect(vaduz).toMatchObject({
      label: 'Städtle 1, 9490 Vaduz',
      country: 'LI',
      timezone: 'Europe/Vaduz',
      featureId: '299001764_1',
      match: 'exact',
    });
  });

  it('house numbers with a dot or none ("#"), exact for both Breitenrainstrasse 10', () => {
    const see = parseSearchResponse(SEARCH['Seestrasse 5.1'], 'Seestrasse 5.1')!;
    expect(see[0]).toMatchObject({
      label: 'Seestrasse 5.1, 9403 Goldach',
      houseNumber: '5.1',
      match: 'exact',
    });
    const [none] = parseSearchResponse(SEARCH['Fösera 9470'], 'Fösera 9470')!;
    expect(none).toMatchObject({ label: 'Fösera, 9470 Buchs SG', street: 'Fösera', houseNumber: '' });
    const breitenrain = parseSearchResponse(SEARCH['Breitenrainstrasse 10'], 'Breitenrainstrasse 10')!;
    expect(breitenrain.filter((a) => a.match === 'exact').map((a) => a.locality)).toEqual([
      'Bern',
      'Kreuzlingen',
    ]);
  });

  it('skips malformed results and duplicates; null without a results array', () => {
    const good = (SEARCH['Kramgasse 49 Bern'] as { results: unknown[] }).results[0];
    const results = [
      good,
      good,
      null,
      {
        attrs: {
          label: 'X 1 <b>3000 Bern</b>',
          featureId: 'nope',
          geom_st_box2d: 'BOX(2600000 1200000,2600000 1200000)',
        },
      },
      { attrs: { label: 'X 1 <b>3000 Bern</b>', featureId: '1_0', geom_st_box2d: 'garbage' } },
    ];
    expect(parseSearchResponse({ results }, 'Kramgasse 49')).toHaveLength(1);
    expect(parseSearchResponse({ error: {} }, 'x')).toBeNull();
    expect(parseSearchResponse('nope', 'x')).toBeNull();
  });
});

describe('searchSwissAddresses', () => {
  it('asks SearchServer for addresses in LV95 and caches per query', async () => {
    const fetchImpl = stubFetch(() => json(SEARCH['Kramgasse 49 Bern']));
    const res = await searchSwissAddresses(' Kramgasse 49 Bern ', { ...FAST, fetchImpl });
    expect(res.ok && res.value.map((a) => a.label)).toEqual(['Kramgasse 49, 3011 Bern']);
    const url = new URL(fetchImpl.urls[0]);
    expect(`${url.origin}${url.pathname}`).toBe(SEARCH_SERVER_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      searchText: 'Kramgasse 49 Bern',
      type: 'locations',
      origins: 'address',
      sr: '2056',
      limit: String(ADDRESS_SEARCH_LIMIT),
    });
    // Same text again (other spacing / case): from the cache, no request.
    const again = await searchSwissAddresses('kramgasse   49 bern', { ...FAST, fetchImpl });
    expect(again.ok && again.value[0].featureId).toBe('1230393_0');
    expect(fetchImpl.urls).toHaveLength(1);
  });

  it('sends nothing for short queries', async () => {
    const fetchImpl = stubFetch(() => json({ results: [] }));
    expect(await searchSwissAddresses(' K ', { ...FAST, fetchImpl })).toEqual({ ok: true, value: [] });
    expect(fetchImpl.urls).toHaveLength(0);
  });

  it('typed errors: HTTP, network (after retries), invalid body, abort', async () => {
    const http = await searchSwissAddresses('Kramgasse', {
      ...FAST,
      fetchImpl: stubFetch(() => json({ error: { code: 400 } }, 400)),
    });
    expect(http).toMatchObject({ ok: false, error: { kind: 'http', status: 400 } });

    const flaky = stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const network = await searchSwissAddresses('Kramgasse', { ...FAST, fetchImpl: flaky });
    expect(network).toMatchObject({ ok: false, error: { kind: 'network' } });
    expect(flaky.urls).toHaveLength(3); // 1 + 2 retries

    const bad = await searchSwissAddresses('Kramgasse', {
      ...FAST,
      fetchImpl: stubFetch(() => new Response('<html>', { status: 200 })),
    });
    expect(bad).toMatchObject({ ok: false, error: { kind: 'invalid' } });
    const noArray = await searchSwissAddresses('Kramgasse 2', {
      ...FAST,
      fetchImpl: stubFetch(() => json({ nothing: true })),
    });
    expect(noArray).toMatchObject({ ok: false, error: { kind: 'invalid' } });

    const ctrl = new AbortController();
    ctrl.abort();
    const aborted = await searchSwissAddresses('Kramgasse', {
      ...FAST,
      signal: ctrl.signal,
      fetchImpl: stubFetch(() => json(SEARCH['Kramgasse 4'])),
    });
    expect(aborted).toMatchObject({ ok: false, error: { kind: 'aborted' } });
  });

  it('retries a server error, then succeeds; errors are not cached', async () => {
    let n = 0;
    const fetchImpl = stubFetch(() => (n++ === 0 ? json({}, 503) : json(SEARCH['Kramgasse 4'])));
    const res = await searchSwissAddresses('Kramgasse 4', { ...FAST, fetchImpl });
    expect(res.ok && res.value).toHaveLength(6);
    expect(fetchImpl.urls).toHaveLength(2);
  });
});

describe('fetchBuildingInfo', () => {
  it('storeys, year or period, area and category from the register', async () => {
    const fetchImpl = stubFetch((url) => json(GWR[url.slice(GWR_URL.length + 1)].body));
    const kramgasse = await fetchBuildingInfo('1230393_0', { ...FAST, fetchImpl });
    expect(kramgasse).toEqual({
      ok: true,
      value: {
        egid: '1230393',
        storeys: 5,
        year: null,
        period: { code: 8011, from: null, to: 1918 },
        area: 147,
        category: 1030,
      },
    });
    expect(fetchImpl.urls[0]).toBe(`${GWR_URL}/1230393_0`);
    const lugano = await fetchBuildingInfo('11203391_0', { ...FAST, fetchImpl });
    expect(lugano.ok && lugano.value).toMatchObject({ storeys: 7, year: 1991, area: 762, category: 1040 });
    const garage = await fetchBuildingInfo('504052250_0', { ...FAST, fetchImpl });
    expect(garage.ok && garage.value).toMatchObject({ storeys: null, year: 2005, area: 37, category: 1060 });
    // Cached.
    await fetchBuildingInfo('1230393_0', { ...FAST, fetchImpl });
    expect(fetchImpl.urls).toHaveLength(3);
  });

  it('no record (404, e.g. Liechtenstein) → null, cached', async () => {
    const fl = GWR['299001764_1'];
    const fetchImpl = stubFetch(() => json(fl.body, fl.status));
    expect(await fetchBuildingInfo('299001764_1', { ...FAST, fetchImpl })).toEqual({ ok: true, value: null });
    expect(await fetchBuildingInfo('299001764_1', { ...FAST, fetchImpl })).toEqual({ ok: true, value: null });
    expect(fetchImpl.urls).toHaveLength(1);
  });

  it('rejects malformed ids and values', async () => {
    const fetchImpl = stubFetch(() => json({}));
    expect(await fetchBuildingInfo('../x', { ...FAST, fetchImpl })).toMatchObject({
      error: { kind: 'invalid' },
    });
    expect(fetchImpl.urls).toHaveLength(0);
    expect(await fetchBuildingInfo('1_0', { ...FAST, fetchImpl })).toMatchObject({
      error: { kind: 'invalid' },
    });
    const odd = parseBuildingInfo(
      { feature: { attributes: { egid: 5, gastw: 0, gbauj: 3000, gbaup: 1, garea: -3, gkat: 1050 } } },
      new Date('2026-09-25'),
    );
    expect(odd).toEqual({ egid: '5', storeys: null, year: null, period: null, area: null, category: null });
    expect(
      await fetchBuildingInfo('2_0', { ...FAST, fetchImpl: stubFetch(() => json({}, 500)) }),
    ).toMatchObject({
      ok: false,
      error: { kind: 'http', status: 500 },
    });
  });
});

describe('fetchGroundHeight', () => {
  it('height at an LV95 point (string in the response), cached', async () => {
    const h = fixtures.height.kramgasse49;
    const fetchImpl = stubFetch(() => json(h.body));
    const res = await fetchGroundHeight({ east: h.easting, north: h.northing }, { ...FAST, fetchImpl });
    expect(res).toEqual({ ok: true, value: 537.7 });
    expect(fetchImpl.urls[0]).toBe(`${HEIGHT_URL}?easting=2600863.76&northing=1199640.37&sr=2056`);
    await fetchGroundHeight({ east: h.easting, north: h.northing }, { ...FAST, fetchImpl });
    expect(fetchImpl.urls).toHaveLength(1);
  });

  it('outside the model: HTTP 400; malformed input or body: invalid', async () => {
    const out = fixtures.height.outside;
    expect(
      await fetchGroundHeight(
        { east: out.easting, north: out.northing },
        { ...FAST, fetchImpl: stubFetch(() => json(out.body, out.status)) },
      ),
    ).toMatchObject({ ok: false, error: { kind: 'http', status: 400 } });
    expect(await fetchGroundHeight({ east: NaN, north: 1 }, FAST)).toMatchObject({
      error: { kind: 'invalid' },
    });
    expect(
      await fetchGroundHeight(
        { east: 2600000, north: 1200000 },
        { ...FAST, fetchImpl: stubFetch(() => json({})) },
      ),
    ).toMatchObject({ error: { kind: 'invalid' } });
  });
});

describe('findNearestAddress', () => {
  const at = (name: keyof typeof fixtures.identify) => {
    const f = fixtures.identify[name];
    const { latitude, longitude } = lv95ToWgs84(f.easting, f.northing);
    return { f, latitude, longitude, fetchImpl: stubFetch(() => json(f.body, f.status)) };
  };

  it('identify on the address layer with a tolerance circle of `radius` m; the nearest wins', async () => {
    const { f, latitude, longitude, fetchImpl } = at('breitenrain');
    const res = await findNearestAddress(latitude, longitude, { ...FAST, fetchImpl, radius: f.radius });
    expect(res.ok && res.value?.address).toMatchObject({
      label: 'Breitenrainplatz 42, 3014 Bern', // 7.0 m; Breitenrainstrasse 10 is 11.8 m away
      featureId: '1240703_0',
      country: 'CH',
      timezone: 'Europe/Zurich',
    });
    expect(res.ok && res.value?.distance).toBeCloseTo(
      Math.hypot(2601157.0 - 2601150, 1200829.4 - 1200830),
      1,
    );
    const url = new URL(fetchImpl.urls[0]);
    expect(`${url.origin}${url.pathname}`).toBe(IDENTIFY_URL);
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({
      geometryType: 'esriGeometryPoint',
      layers: 'all:ch.swisstopo.amtliches-gebaeudeadressverzeichnis',
      tolerance: '15',
      imageDisplay: '30,30,96',
      sr: '2056',
      geometryFormat: 'geojson',
    });
    const [e, n] = q.geometry.split(',').map(Number);
    expect(e).toBeCloseTo(2601150, 0);
    expect(n).toBeCloseTo(1200830, 0);
  });

  it('Liechtenstein, and none nearby', async () => {
    const vaduz = at('vaduz');
    const res = await findNearestAddress(vaduz.latitude, vaduz.longitude, {
      ...FAST,
      fetchImpl: vaduz.fetchImpl,
    });
    expect(res.ok && res.value?.address).toMatchObject({
      label: 'Städtle 1, 9490 Vaduz',
      timezone: 'Europe/Vaduz',
    });
    const none = at('none');
    expect(
      await findNearestAddress(none.latitude, none.longitude, { ...FAST, fetchImpl: none.fetchImpl }),
    ).toEqual({
      ok: true,
      value: null,
    });
    expect(await findNearestAddress(NaN, 7, FAST)).toMatchObject({ error: { kind: 'invalid' } });
  });
});

describe('createRateLimiter', () => {
  it(`lets ${API3_BUDGET.requests} requests per minute through and waits for the next slot`, async () => {
    let t = 0;
    const waits: number[] = [];
    const limiter = createRateLimiter(
      2,
      60_000,
      () => t,
      async (ms) => {
        waits.push(ms);
        t += ms;
      },
    );
    await limiter.acquire();
    t = 10_000;
    await limiter.acquire();
    t = 20_000;
    await limiter.acquire(); // the first slot frees at 60 s
    expect(waits).toEqual([40_000]);
    expect(t).toBe(60_000);
  });

  it('rejects when aborted while waiting', async () => {
    const limiter = createRateLimiter(
      1,
      60_000,
      () => 0,
      (_ms, signal) => {
        return new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(new Error('x'))),
        );
      },
    );
    await limiter.acquire();
    const ctrl = new AbortController();
    const waiting = limiter.acquire(ctrl.signal);
    ctrl.abort();
    await expect(waiting).rejects.toThrow();
  });

  it('every attempt takes a slot: a retry waits for the budget after its backoff', async () => {
    const log: string[] = [];
    const limiter: RateLimiter = {
      acquire: async () => {
        log.push('slot');
      },
    };
    let n = 0;
    const fetchImpl = stubFetch(() => {
      log.push('fetch');
      return n++ < 2 ? json({}, 503) : json(fixtures.height.kramgasse49.body);
    });
    const sleep = async (ms: number) => {
      log.push(`backoff ${ms}`);
    };
    const res = await fetchGroundHeight(
      { east: 2600000, north: 1200000 },
      { limiter, fetchImpl, retry: { sleep, random: () => 0 } },
    );
    expect(res).toEqual({ ok: true, value: 537.7 });
    expect(log).toEqual(['slot', 'fetch', 'backoff 1000', 'slot', 'fetch', 'backoff 2000', 'slot', 'fetch']);
  });

  it(`a budget of ${API3_BUDGET.requests} per minute also holds for retries`, async () => {
    // Budget 2/min on a fake clock: the third attempt starts only when the first slot frees at 60 s.
    let t = 0;
    const clock = () => t;
    const wait = async (ms: number) => {
      t += ms;
    };
    const limiter = createRateLimiter(2, 60_000, clock, wait);
    const started: number[] = [];
    const fetchImpl = stubFetch(() => {
      started.push(t);
      return started.length < 3 ? json({}, 503) : json(fixtures.height.kramgasse49.body);
    });
    const res = await fetchGroundHeight(
      { east: 2600000, north: 1200000 },
      { limiter, fetchImpl, retry: { sleep: wait, random: () => 0, now: clock, deadlineMs: 120_000 } },
    );
    expect(res).toEqual({ ok: true, value: 537.7 });
    // Backoff 1 s, then 2 s (→ 3 s), then the budget wait until the first slot is 60 s old.
    expect(started).toEqual([0, 1000, 60_000]);
  });

  it('a retry waiting for the budget reports an abort as a typed error', async () => {
    const ctrl = new AbortController();
    const limiter = createRateLimiter(1, 60_000);
    const fetchImpl = stubFetch(() => {
      setTimeout(() => ctrl.abort(), 0);
      return json({}, 503);
    });
    const res = await fetchGroundHeight(
      { east: 2600000, north: 1200000 },
      { limiter, fetchImpl, signal: ctrl.signal, retry: { sleep: () => Promise.resolve(), random: () => 0 } },
    );
    expect(res).toMatchObject({ ok: false, error: { kind: 'aborted' } });
    expect(fetchImpl.urls).toHaveLength(1);
  });

  it('a search waiting for the budget reports the abort as a typed error', async () => {
    const limiter = createRateLimiter(1, 60_000);
    await limiter.acquire();
    const ctrl = new AbortController();
    const fetchImpl = stubFetch(() => json({ results: [] }));
    const pending = searchSwissAddresses('Kramgasse', { limiter, signal: ctrl.signal, fetchImpl });
    ctrl.abort();
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } });
    expect(fetchImpl.urls).toHaveLength(0);
  });
});
