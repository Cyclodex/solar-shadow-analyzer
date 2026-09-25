import { devices, expect, test, type Page } from '@playwright/test';
import { enuToFacade, enuToLonLat, facadeToEnu } from '../src/model/enu';
import { lv95LocalFrame, wgs84ToLv95 } from '../src/model/lv95';
import { syntheticSwisstopo, type SyntheticWorld } from '../src/test/cogFixture';

// Laser-scan surroundings (swissSURFACE3D) against a synthetic swisstopo: STAC items, COGs answered with
// Range (206), the height service and the building vector tiles. The default site (47.1° N, 7.45° E, facade
// 202°) gets a 15 m block from 20 m to 30 m in front of the facade, 50 m wide, on flat ground at 480 m; the
// block is a building of the vector tiles. Some worlds add a 25 m tree crown 6–9 m out, outside every
// footprint. Weather and terrain tiles are blocked.

const SITE = { latitude: 47.1, longitude: 7.45 };
const FACADE = 202;
const GROUND = 480;

/** A box in the facade frame (u along the facade, n out of it), m, and its height above the ground. */
interface Box {
  u0: number;
  u1: number;
  n0: number;
  n1: number;
  height: number;
}
const BLOCK: Box = { u0: -25, u1: 25, n0: 20, n1: 30, height: 15 };
const TREE: Box = { u0: 6, u1: 9, n0: 6, n1: 9, height: 25 };
/** Lowest floor: panel centre 1.9 m out and 3.4 m up; block face 18.1 m away, 11.6 m higher: 32.6°. */
const BLOCK_DEG: [number, number] = [31, 34];
/** Nearest crown corner (6 m, 6 m): 7.27 m away, 21.6 m higher: 71.4°. */
const TREE_DEG: [number, number] = [68, 75];

const inBox = (b: Box, u: number, n: number): boolean => u >= b.u0 && u < b.u1 && n >= b.n0 && n < b.n1;

/** A box's footprint as a lon/lat ring (clockwise on the map, as MVT outer rings). */
function footprint(b: Box): [number, number][] {
  const corners: [number, number][] = [
    [b.u0, b.n0],
    [b.u1, b.n0],
    [b.u1, b.n1],
    [b.u0, b.n1],
  ];
  const enu = corners.map((c) => facadeToEnu(c, FACADE));
  let area = 0;
  for (let i = 0, j = enu.length - 1; i < enu.length; j = i++)
    area += (enu[j][0] - enu[i][0]) * (enu[j][1] + enu[i][1]);
  const ring = area > 0 ? enu.reverse() : enu; // this sum is positive for a counter-clockwise ring
  return ring.map(([e, n]) => {
    const g = enuToLonLat(SITE, e, n);
    return [g.longitude, g.latitude];
  });
}

function world(opts: { tree?: boolean } = {}): SyntheticWorld {
  const frame = lv95LocalFrame(SITE);
  const c = wgs84ToLv95(SITE.latitude, SITE.longitude);
  const surface = (east: number, north: number): number => {
    const [u, n] = enuToFacade(frame.toEnu(east, north), FACADE);
    if (opts.tree && inBox(TREE, u, n)) return GROUND + TREE.height;
    return GROUND + (inBox(BLOCK, u, n) ? BLOCK.height : 0);
  };
  return {
    dsm: { 2023: surface },
    dtm: () => GROUND,
    ground: GROUND,
    buildings: [{ rings: [footprint(BLOCK)], props: { class: 'building', render_height: BLOCK.height } }],
    // Only the COG tiles of the 300 m window (+ margin) carry data: small, fast fixtures.
    window: { x0: c.east - 320, y0: c.north - 320, x1: c.east + 320, y1: c.north + 320 },
  };
}

interface Recorded {
  url: string;
  range: string | null;
  at: number;
}

/** How the synthetic swisstopo answers (changeable during a test). */
interface Control {
  /** Data ranges of the COGs (not the headers) answer 503. */
  failRanges: boolean;
  /** Delay of every data range, ms (a slow link). */
  rangeDelayMs: number;
}

const isDataRange = (r: { url: string; range: string | null }): boolean =>
  r.url.endsWith('.tif') && r.range !== null && r.range !== 'bytes=0-16383';

/** Serves the synthetic swisstopo for every page and worker request; blocks weather and terrain tiles. */
async function serve(
  page: Page,
  w: SyntheticWorld = world(),
): Promise<{ recorded: Recorded[]; control: Control }> {
  const answer = syntheticSwisstopo(w);
  const recorded: Recorded[] = [];
  const control: Control = { failRanges: false, rangeDelayMs: 0 };
  const context = page.context();
  await context.route(/open-meteo\.com|amazonaws\.com/, (route) => route.abort());
  await context.route(/geo\.admin\.ch/, async (route) => {
    const request = route.request();
    const range = await request.headerValue('range');
    const entry = { url: request.url(), range, at: Date.now() };
    recorded.push(entry);
    const cors = { 'access-control-allow-origin': '*' };
    if (isDataRange(entry)) {
      if (control.rangeDelayMs > 0) await new Promise((r) => setTimeout(r, control.rangeDelayMs));
      if (control.failRanges) {
        await route.fulfill({ status: 503, body: 'unavailable', headers: cors }).catch(() => undefined);
        return;
      }
    }
    const res = answer(request.url(), range);
    if (!res) return route.abort();
    const body = typeof res.body === 'string' ? res.body : Buffer.from(res.body);
    // A request the page gave up meanwhile (aborted) can no longer be answered.
    await route
      .fulfill({ status: res.status, body, headers: { ...res.headers, ...cors } })
      .catch(() => undefined);
  });
  return { recorded, control };
}

async function openHorizonSection(page: Page): Promise<void> {
  const header = page.getByRole('button', { name: /Horizont & Umgebung/ });
  await header.scrollIntoViewIfNeeded();
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
}

/** Laser-scan series of the horizon chart: its legend value (the maximum in front of the facade), degrees. */
async function scanMaximum(page: Page): Promise<number> {
  const figure = page.locator('figure', { hasText: 'Horizont vor der Fassade' });
  const item = figure.locator('li', { hasText: 'Laserscan' });
  await expect(item).toBeVisible();
  const text = (await item.locator('strong').textContent()) ?? '';
  return Number(text.replace('°', '').trim());
}

const loadedStatus = (page: Page) => page.getByRole('status').filter({ hasText: 'Laserscan geladen' });

async function enableAndCheck(
  page: Page,
  recorded: Recorded[],
  opts: { tap?: boolean; expected?: [number, number] } = {},
): Promise<void> {
  const [lo, hi] = opts.expected ?? BLOCK_DEG;
  await page.goto('./');
  await openHorizonSection(page);
  const toggle = page.getByRole('switch', { name: 'Laserscan-Umgebung (swisstopo)' });
  await toggle.scrollIntoViewIfNeeded();
  if (opts.tap) await toggle.tap();
  else await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(loadedStatus(page)).toBeVisible({ timeout: 30_000 });
  await expect(loadedStatus(page)).toContainText('Datenstand 2023');
  const max = await scanMaximum(page);
  expect(max).toBeGreaterThan(lo);
  expect(max).toBeLessThan(hi);
  // Range requests only (206), the header of each file first.
  const cogs = recorded.filter((r) => r.url.endsWith('.tif'));
  expect(cogs.length).toBeGreaterThan(1);
  expect(cogs.every((r) => r.range?.startsWith('bytes='))).toBe(true);
  expect(
    recorded.some((r) => r.url.includes('/api/stac/v1/collections/ch.swisstopo.swisssurface3d-raster')),
  ).toBe(true);
  expect(recorded.some((r) => r.url.includes('/rest/services/height'))).toBe(true);
}

async function nudgeTilt(page: Page): Promise<void> {
  const tilt = page.getByRole('slider', { name: /Neigung θ ab Senkrechte/ });
  await tilt.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tilt).toHaveValue('44');
}

test('laser scan: range requests, data year and the horizon; buildings only keeps the block, drops the tree', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const { recorded } = await serve(page, world({ tree: true }));
  await enableAndCheck(page, recorded, { expected: TREE_DEG });
  expect(recorded.some((r) => r.url.includes('vectortiles.geo.admin.ch'))).toBe(false);
  // Buildings only: the tree outside every footprint becomes ground, the block (a building) stays.
  const before = recorded.length;
  await page.getByRole('switch', { name: 'Bäume berücksichtigen' }).click();
  await expect.poll(() => scanMaximum(page), { timeout: 30_000 }).toBeLessThan(BLOCK_DEG[1]);
  expect(await scanMaximum(page)).toBeGreaterThan(BLOCK_DEG[0]);
  await expect(loadedStatus(page)).toBeVisible();
  const reloaded = recorded.slice(before);
  expect(reloaded.some((r) => r.url.includes('vectortiles.geo.admin.ch'))).toBe(true);
  expect(reloaded.some((r) => r.url.includes('swissalti3d'))).toBe(true);
  expect(errors).toEqual([]);
});

test('laser scan: a failed load explains the fallback, «Erneut versuchen» loads it', async ({ page }) => {
  const { recorded, control } = await serve(page);
  control.failRanges = true;
  await page.goto('./');
  await openHorizonSection(page);
  await page.getByRole('switch', { name: 'Laserscan-Umgebung (swisstopo)' }).click();
  // Retried with backoff (fetchRetry.ts), then reported.
  const alert = page.getByRole('alert').filter({ hasText: 'Der Laserscan konnte nicht geladen werden.' });
  await expect(alert).toBeVisible({ timeout: 40_000 });
  await expect(alert).toContainText('Es wird ohne Laserscan gerechnet.');
  await expect(alert).toContainText('Der Server hat mit Fehler 503 geantwortet.');
  expect(recorded.filter(isDataRange).length).toBeGreaterThan(1); // retried
  control.failRanges = false;
  await alert.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(loadedStatus(page)).toBeVisible({ timeout: 30_000 });
  const max = await scanMaximum(page);
  expect(max).toBeGreaterThan(BLOCK_DEG[0]);
  expect(max).toBeLessThan(BLOCK_DEG[1]);
});

test('laser scan: a tilt change during the download neither aborts nor repeats a range', async ({ page }) => {
  const { recorded, control } = await serve(page);
  control.rangeDelayMs = 1500; // a slow link
  await page.goto('./');
  await openHorizonSection(page);
  await page.getByRole('switch', { name: 'Laserscan-Umgebung (swisstopo)' }).click();
  await expect(page.getByRole('progressbar', { name: 'Fortschritt Laserscan' })).toBeVisible();
  await expect.poll(() => recorded.filter(isDataRange).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await nudgeTilt(page);
  await expect(loadedStatus(page)).toBeVisible({ timeout: 30_000 });
  const ranges = recorded.filter(isDataRange).map((r) => `${r.url} ${r.range}`);
  expect(ranges.length).toBeGreaterThan(0);
  expect(new Set(ranges).size).toBe(ranges.length);
});

test('laser scan after a reload: from the result cache; a new tilt reloads the data visibly', async ({
  page,
}) => {
  const { recorded, control } = await serve(page);
  await enableAndCheck(page, recorded);
  // The sweep tilts (19 tilts × 2 floors) follow from memory and are cached with the site.
  const cachedObservers = (): Promise<number> =>
    page.evaluate(() =>
      Math.max(
        0,
        ...Object.keys(localStorage)
          .filter((k) => k.startsWith('ssa.surface.v1:'))
          .map(
            (k) =>
              Object.keys((JSON.parse(localStorage.getItem(k) ?? '{}') as { h?: object }).h ?? {}).length,
          ),
      ),
    );
  await expect.poll(cachedObservers, { timeout: 15_000 }).toBeGreaterThanOrEqual(38);
  const before = recorded.length;
  await page.reload();
  await openHorizonSection(page);
  await expect(loadedStatus(page)).toBeVisible({ timeout: 15_000 });
  expect(recorded.slice(before).filter((r) => r.url.includes('data.geo.admin.ch'))).toEqual([]);
  // 44° is not a sweep tilt: the worker's memory is empty after the reload, the data loads again, visibly.
  control.rangeDelayMs = 1500;
  await nudgeTilt(page);
  await expect(page.getByText(/Laserscan wird nachgeladen/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('progressbar', { name: 'Fortschritt Laserscan' })).toBeVisible();
  await expect(loadedStatus(page)).toBeVisible({ timeout: 30_000 });
  expect(recorded.slice(before).filter(isDataRange).length).toBeGreaterThan(0);
  const max = await scanMaximum(page);
  expect(max).toBeGreaterThan(BLOCK_DEG[0]);
  expect(max).toBeLessThan(BLOCK_DEG[1]);
});

test('laser scan: outside Switzerland it says where it is available', async ({ page }) => {
  const { recorded } = await serve(page);
  // A stored config in Paris (missing fields get their defaults when the app loads it).
  await page.addInitScript(() => {
    const location = {
      name: 'Paris',
      latitude: 48.8566,
      longitude: 2.3522,
      timezone: 'Europe/Paris',
      elevation: 35,
    };
    localStorage.setItem(
      'ssa.config',
      JSON.stringify({ state: { config: { version: 2, location } }, version: 2 }),
    );
  });
  await page.goto('./');
  await openHorizonSection(page);
  await page.getByRole('switch', { name: 'Laserscan-Umgebung (swisstopo)' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'nur in der Schweiz und Liechtenstein' }),
  ).toBeVisible();
  // Outside the scan's extent nothing is requested.
  expect(recorded.filter((r) => r.url.includes('data.geo.admin.ch'))).toEqual([]);
});

test.describe('phone', () => {
  const { userAgent, deviceScaleFactor, isMobile, hasTouch, viewport } = devices['iPhone 14'];
  test.use({ userAgent, deviceScaleFactor, isMobile, hasTouch, viewport });

  test('laser scan on a phone: tap to enable, 44 px targets, 16 px select, no horizontal scroll', async ({
    page,
  }) => {
    const { recorded } = await serve(page);
    await enableAndCheck(page, recorded, { tap: true });
    // The switch row is a 44 px target on touch screens (the switch's hit area spans it).
    const row = page.getByRole('switch', { name: 'Bäume berücksichtigen' }).locator('..');
    expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const radius = page.getByRole('combobox', { name: 'Umkreis' });
    const [height, fontSize] = await radius.evaluate((el) => [
      el.getBoundingClientRect().height,
      parseFloat(getComputedStyle(el).fontSize),
    ]);
    expect(height).toBeGreaterThanOrEqual(44);
    expect(fontSize).toBeGreaterThanOrEqual(16);
    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
