import { devices, expect, test, type Page } from '@playwright/test';
import { enuToFacade } from '../src/model/enu';
import { lv95LocalFrame, wgs84ToLv95 } from '../src/model/lv95';
import { syntheticSwisstopo, type SyntheticWorld } from '../src/test/cogFixture';

// Laser-scan surroundings (swissSURFACE3D) against a synthetic swisstopo: STAC items, COGs answered with
// Range (206), the height service. The default site (47.1° N, 7.45° E, facade 202°) gets a 15 m block from
// 20 m to 30 m in front of the facade, 50 m wide, on flat ground at 480 m. Weather and terrain tiles are blocked.

const SITE = { latitude: 47.1, longitude: 7.45 };
const FACADE = 202;
const GROUND = 480;

function world(): SyntheticWorld {
  const frame = lv95LocalFrame(SITE);
  const c = wgs84ToLv95(SITE.latitude, SITE.longitude);
  const surface = (east: number, north: number): number => {
    const [u, n] = enuToFacade(frame.toEnu(east, north), FACADE);
    return GROUND + (n >= 20 && n < 30 && Math.abs(u) < 25 ? 15 : 0);
  };
  return {
    dsm: { 2023: surface },
    dtm: () => GROUND,
    ground: GROUND,
    // Only the COG tiles of the 300 m window (+ margin) carry data: small, fast fixtures.
    window: { x0: c.east - 320, y0: c.north - 320, x1: c.east + 320, y1: c.north + 320 },
  };
}

interface Recorded {
  url: string;
  range: string | null;
  bytes: number;
}

/** Serves the synthetic swisstopo for every page and worker request; blocks weather and terrain tiles. */
async function serve(page: Page): Promise<Recorded[]> {
  const answer = syntheticSwisstopo(world());
  const recorded: Recorded[] = [];
  const context = page.context();
  await context.route(/open-meteo\.com|amazonaws\.com/, (route) => route.abort());
  await context.route(/geo\.admin\.ch/, async (route) => {
    const request = route.request();
    const range = await request.headerValue('range');
    const res = answer(request.url(), range);
    if (!res) return route.abort();
    const body = typeof res.body === 'string' ? res.body : Buffer.from(res.body);
    recorded.push({ url: request.url(), range, bytes: body.length });
    return route.fulfill({
      status: res.status,
      body,
      headers: { ...res.headers, 'access-control-allow-origin': '*' },
    });
  });
  return recorded;
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

async function enableAndCheck(page: Page, recorded: Recorded[], tap: boolean): Promise<void> {
  await page.goto('./');
  await openHorizonSection(page);
  const toggle = page.getByRole('switch', { name: 'Laserscan-Umgebung (swisstopo)' });
  await toggle.scrollIntoViewIfNeeded();
  if (tap) await toggle.tap();
  else await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  const status = page.getByRole('status').filter({ hasText: 'Laserscan geladen' });
  await expect(status).toBeVisible({ timeout: 30_000 });
  await expect(status).toContainText('Datenstand 2023');
  // Lowest floor: panel centre 1.9 m out and 3.4 m up; block face 18.1 m away, 11.6 m higher: 32.6°.
  const max = await scanMaximum(page);
  expect(max).toBeGreaterThan(31);
  expect(max).toBeLessThan(34);
  // Range requests only (206), the header of each file first.
  const cogs = recorded.filter((r) => r.url.endsWith('.tif'));
  expect(cogs.length).toBeGreaterThan(1);
  expect(cogs.every((r) => r.range?.startsWith('bytes='))).toBe(true);
  expect(
    recorded.some((r) => r.url.includes('/api/stac/v1/collections/ch.swisstopo.swisssurface3d-raster')),
  ).toBe(true);
  expect(recorded.some((r) => r.url.includes('/rest/services/height'))).toBe(true);
}

test('laser scan: loads with range requests, shows data year and the horizon series', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const recorded = await serve(page);
  await enableAndCheck(page, recorded, false);
  // Buildings only: a flat world has no footprints → the tiles answer 404 (outside CH/FL) and nothing changes.
  await page.getByRole('switch', { name: 'Bäume berücksichtigen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Laserscan geladen' })).toBeVisible({
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
});

test('laser scan: outside Switzerland it says where it is available', async ({ page }) => {
  const recorded = await serve(page);
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
    const recorded = await serve(page);
    await enableAndCheck(page, recorded, true);
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
