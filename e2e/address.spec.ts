import { readFileSync } from 'node:fs';
import { devices, expect, test, type Page, type Route } from '@playwright/test';

// Address search (swisstopo, CH/FL): geo.admin.ch answers from the responses recorded for the model tests
// (src/model/geocode.fixtures.json); everything else external is blocked (weather falls back to clear sky).

interface Recorded {
  status: number;
  body: unknown;
}
interface Fixtures {
  search: Record<string, unknown>;
  gwr: Record<string, Recorded>;
  height: Record<string, Recorded>;
  identify: Record<string, Recorded & { easting: number; northing: number }>;
}
const FIXTURES = JSON.parse(
  readFileSync(new URL('../src/model/geocode.fixtures.json', import.meta.url), 'utf8'),
) as Fixtures;

/** geo.admin.ch requests of the page (path + query). */
async function mockGeoAdmin(page: Page): Promise<string[]> {
  const requests: string[] = [];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  await page.route(/open-meteo\.com|amazonaws\.com/, (route) => route.abort());
  await page.route(/geo\.admin\.ch/, (route) => {
    const url = new URL(route.request().url());
    requests.push(`${url.hostname}${url.pathname}${url.search}`);
    if (url.hostname !== 'api3.geo.admin.ch') return route.abort(); // tiles and laser scan: not part of this spec
    if (url.pathname.endsWith('/SearchServer')) {
      // Any Kramgasse prefix answers like the full address (the debounce sends only the last text).
      const text = url.searchParams.get('searchText') ?? '';
      const key = /^kramgasse/i.test(text) ? 'Kramgasse 49 Bern' : text;
      return json(route, FIXTURES.search[key] ?? { results: [] });
    }
    const gwr = /\/ch\.bfs\.gebaeude_wohnungs_register\/(\w+)$/.exec(url.pathname);
    if (gwr) {
      const f = FIXTURES.gwr[gwr[1]] ?? { status: 404, body: { status: 'error', code: 404 } };
      return json(route, f.body, f.status);
    }
    if (url.pathname.endsWith('/height')) return json(route, FIXTURES.height.kramgasse49.body);
    if (url.pathname.endsWith('/identify')) return json(route, FIXTURES.identify.breitenrain.body);
    return route.abort();
  });
  return requests;
}

/** The config in the #c= share hash (base64url JSON with short keys, see share.ts). */
async function hashConfig(
  page: Page,
): Promise<{ l?: Record<string, unknown>; h?: { s?: Record<string, unknown> } }> {
  const hash = new URL(page.url()).hash;
  if (!hash.startsWith('#c=')) return {};
  return JSON.parse(Buffer.from(hash.slice(3), 'base64url').toString('utf8')) as never;
}

async function expectAddressApplied(page: Page): Promise<void> {
  const section = page.locator('section', { has: page.getByRole('button', { name: /^Standort/ }) });
  await expect(page.getByRole('textbox', { name: 'Bezeichnung' })).toHaveValue('Kramgasse 49, 3011 Bern');
  await expect(page.getByRole('textbox', { name: 'Breitengrad' })).toHaveValue('46.947847');
  await expect(page.getByRole('textbox', { name: 'Längengrad' })).toHaveValue('7.449979');
  await expect(page.getByRole('combobox', { name: 'Zeitzone' })).toHaveValue('Europe/Zurich');
  // Height service: 537.7 m.
  await expect(page.getByRole('textbox', { name: 'Höhe über Meer' })).toHaveValue('538');
  await expect(section.getByRole('button', { name: /^Standort/ })).toContainText('Kramgasse 49, 3011 Bern');
  const block = page.getByRole('region', { name: 'Gebäude an der Adresse' });
  await expect(block).toContainText('EGID 1230393');
  await expect(block).toContainText('Geschosse');
  await expect(block).toContainText('vor 1919 (Bauperiode)');
  await expect(block).toContainText('147 m²');
  // Share link: exact location (1e-6°) and the laser scan switched on for the surroundings import.
  await expect
    .poll(async () => {
      const c = await hashConfig(page);
      return [c.l?.n, c.l?.a, c.l?.o, c.l?.e, c.h?.s?.e];
    })
    .toEqual(['Kramgasse 49, 3011 Bern', 46.947847, 7.449979, 538, true]);
}

test('keyboard only: search an address, pick it, see the building data', async ({ page }) => {
  const requests = await mockGeoAdmin(page);
  // The page's timers run on Playwright's clock: while the text is typed the clock stands still, so the 300 ms
  // debounce does not depend on the typing speed of a loaded machine.
  await page.clock.install();
  await page.goto('./');
  const toggle = page.getByRole('button', { name: /^Standort/ });
  await toggle.focus();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  const input = page.getByRole('combobox', { name: 'Adresse oder Ort suchen' });
  await expect(input).toBeFocused();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.keyboard.type('Kramgasse 49 Bern', { delay: 40 });
  await expect(input).toHaveValue('Kramgasse 49 Bern');
  const searches = () => requests.filter((r) => r.includes('/SearchServer'));
  await page.clock.runFor(299);
  // Nothing before the debounce (the real-time wait lets a request that went out reach the route handler).
  await page.waitForTimeout(250);
  expect(searches()).toHaveLength(0);
  await page.clock.runFor(1);
  await expect.poll(searches).toHaveLength(1);
  await page.clock.resume();

  const list = page.getByRole('listbox', { name: 'Suchergebnisse' });
  const group = list.getByRole('group', { name: /^Adressen/ });
  await expect(group.getByRole('option')).toHaveText(['Kramgasse 49, 3011 BernGebäudeadresse · Schweiz']);
  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', /.+/);
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.getByText('Übernommen: Kramgasse 49, 3011 Bern')).toBeVisible();
  await expectAddressApplied(page);

  // One search request for the whole text (300 ms after the last key), then register and height.
  const search = searches();
  expect(search).toHaveLength(1);
  expect(search[0]).toContain('searchText=Kramgasse+49+Bern');
  expect(search[0]).toContain('origins=address');
  expect(search[0]).toContain('sr=2056');
  expect(requests.filter((r) => r.includes('gebaeude_wohnungs_register/1230393_0'))).toHaveLength(1);
  expect(requests.filter((r) => r.includes('/height?'))).toHaveLength(1);
});

test.describe('phone', () => {
  const { userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 14'];
  test.use({ userAgent, deviceScaleFactor, isMobile, hasTouch, viewport: { width: 390, height: 844 } });

  test('tap an address; 16 px input, 44 px options, no horizontal scrolling', async ({ page }) => {
    await mockGeoAdmin(page);
    await page.goto('./');
    const toggle = page.getByRole('button', { name: /^Standort/ });
    await toggle.scrollIntoViewIfNeeded();
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
    const input = page.getByRole('combobox', { name: 'Adresse oder Ort suchen' });
    await input.tap();
    expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
    await input.pressSequentially('Kramgasse 49', { delay: 40 });
    const option = page.getByRole('listbox', { name: 'Suchergebnisse' }).getByRole('option').first();
    await expect(option).toContainText('Kramgasse 49, 3011 Bern');
    expect((await option.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    await option.tap();
    await expectAddressApplied(page);
  });

  test('a foreign street address offers no Swiss look-alikes', async ({ page }) => {
    // Recorded SearchServer answer: only fuzzy hits with the number 1 (Via Milano 1 Chiasso, Via Rime 1 Mendrisio …).
    const requests = await mockGeoAdmin(page);
    await page.goto('./');
    const toggle = page.getByRole('button', { name: /^Standort/ });
    await toggle.scrollIntoViewIfNeeded();
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
    const input = page.getByRole('combobox', { name: 'Adresse oder Ort suchen' });
    await input.tap();
    await input.fill('Via Roma 1 Milano');
    await expect(
      page.getByText('Keine Treffer für «Via Roma 1 Milano» – oder die Suche ist nicht erreichbar.'),
    ).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Suchergebnisse' }).getByRole('option')).toHaveCount(0);
    const search = requests.filter((r) => r.includes('/SearchServer'));
    expect(search.at(-1)).toContain('searchText=Via+Roma+1+Milano');
  });

  test('"Nächste Adresse übernehmen" after the device position', async ({ page, context }) => {
    const requests = await mockGeoAdmin(page);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 46.95853, longitude: 7.45374, accuracy: 15 });
    await page.goto('./');
    const toggle = page.getByRole('button', { name: /^Standort/ });
    await toggle.scrollIntoViewIfNeeded();
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
    await page.getByRole('button', { name: 'Mein Standort' }).tap();
    const nearest = page.getByRole('button', { name: 'Nächste Adresse übernehmen' });
    await expect(nearest).toBeVisible();
    expect(requests.filter((r) => r.includes('/identify'))).toHaveLength(0); // only on that tap
    await nearest.tap();
    await expect(
      page.getByText(/^Übernommen: Breitenrainplatz 42, 3014 Bern \(\d+\s?m von der Position\)\.$/),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Bezeichnung' })).toHaveValue(
      'Breitenrainplatz 42, 3014 Bern',
    );
    await expect(nearest).toBeHidden();
    await expect.poll(async () => (await hashConfig(page)).h?.s?.e).toBe(true);
    expect(requests.filter((r) => r.includes('/identify'))).toHaveLength(1);
  });
});
