import { decode } from 'fast-png';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { basePath } from '../scripts/basePath.ts';

// Installable app and offline use (vite-plugin-pwa, docs/ARCHITECTURE.md). Unlike the other specs, the
// service worker runs here. External data stays blocked: results come from the clear-sky fallback.
test.use({ serviceWorkers: 'allow' });

const EXTERNAL = /open-meteo\.com|amazonaws\.com|geo\.admin\.ch/;

test.beforeEach(async ({ context }) => {
  await context.route(EXTERNAL, (route) => route.abort());
});

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

/** Console errors and uncaught exceptions, except the failed requests to the blocked external services. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().startsWith('Failed to load resource') && EXTERNAL.test(msg.location().url)) return;
    errors.push(`${msg.text()} (${msg.location().url})`);
  });
  return errors;
}

/** Loads a PNG; checks type and size and returns the decoded image. */
async function png(request: APIRequestContext, url: string, size: number) {
  const res = await request.get(url);
  expect(res.ok(), url).toBe(true);
  expect(res.headers()['content-type'], url).toBe('image/png');
  const image = decode(await res.body());
  expect([image.width, image.height], url).toEqual([size, size]);
  return image;
}

/** Alpha of the top left pixel (255 = opaque). */
function cornerAlpha(image: ReturnType<typeof decode>): number {
  return image.channels === 4 ? Number(image.data[3]) : 255;
}

test('web app manifest is served and valid, the icons load', async ({ page, request }) => {
  await page.goto('./');
  const appUrl = new URL('./', page.url()).href;
  // Served under the base path of the build (BASE_PATH, e.g. /solar-shadow-analyzer/ as on GitHub Pages).
  expect(new URL(appUrl).pathname).toBe(basePath());

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifestUrl = new URL(href ?? '', page.url());
  const res = await request.get(manifestUrl.href);
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('application/manifest+json');
  const manifest = (await res.json()) as {
    id: string;
    name: string;
    start_url: string;
    scope: string;
    icons: ManifestIcon[];
  };
  expect(manifest).toMatchObject({
    name: 'Solar Shadow Analyzer – Verschattungsanalyse',
    short_name: 'Verschattung',
    lang: 'de',
    display: 'standalone',
    theme_color: '#0b1120',
    background_color: '#0b1120',
  });
  // Start URL, scope and id point to the app under its base path. The id resolves against the start URL's
  // origin (W3C manifest), not against the start URL itself.
  const startUrl = new URL(manifest.start_url, manifestUrl).href;
  expect(startUrl).toBe(appUrl);
  expect(new URL(manifest.scope, manifestUrl).href).toBe(appUrl);
  expect(new URL(manifest.id, new URL(startUrl).origin).href).toBe(appUrl);
  // The same identity as Chromium computes it.
  const cdp = await page.context().newCDPSession(page);
  expect(await cdp.send('Page.getAppId')).toMatchObject({ appId: appUrl });

  expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
    '192x192 any',
    '512x512 any',
    '512x512 maskable',
  ]);
  for (const icon of manifest.icons) {
    expect(icon.type).toBe('image/png');
    const image = await png(request, new URL(icon.src, manifestUrl).href, Number(icon.sizes.split('x')[0]));
    // Maskable icons are cropped by the launcher: opaque up to the edges.
    if (icon.purpose === 'maskable') expect(cornerAlpha(image)).toBe(255);
  }

  // iOS home screen icon (opaque: iOS would fill transparency with black) and favicon.
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(cornerAlpha(await png(request, new URL(apple ?? '', page.url()).href, 180))).toBe(255);
  const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
  expect((await request.get(new URL(favicon ?? '', page.url()).href)).ok()).toBe(true);
});

test('service worker caches the app: it reloads offline with results and the 3D view', async ({
  page,
  context,
}) => {
  test.slow(); // three loads of the app incl. the 3D view
  const errors = trackErrors(page);
  await page.goto('./');
  const appUrl = new URL('./', page.url()).href;

  // First visit: the worker installs, precaches the whole build and says so.
  await expect(page.getByRole('status').filter({ hasText: 'Offline verfügbar' })).toBeVisible({
    timeout: 30_000,
  });
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(appUrl);

  // From the next load on, it controls the page.
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${appUrl}sw.js`);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
    }
    return urls;
  });
  // Including the lazily loaded 3D chunk (three.js).
  expect(cached.some((url) => /\/assets\/SceneView-[\w-]+\.js$/.test(url))).toBe(true);
  expect(cached.some((url) => url.startsWith(`${appUrl}index.html`))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Verschattungsanalyse/i }).first()).toBeVisible();
  const annual = page.locator('dt', { hasText: 'Jahresertrag' }).locator('..');
  await expect(annual).toContainText(/\d\s?kWh/, { timeout: 15_000 });
  await expect(annual).toContainText('Theoretisches Maximum bei klarem Himmel');
  const view = page.getByRole('region', { name: '3D-Ansicht', exact: true });
  await expect(view.locator('canvas')).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('a new version waits for "Neu laden", then takes over', async ({ page }) => {
  test.slow(); // installs the worker twice
  const errors = trackErrors(page);
  await page.goto('./');
  const appUrl = new URL('./', page.url()).href;
  const controller = () => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
  await expect(page.getByRole('status').filter({ hasText: 'Offline verfügbar' })).toBeVisible({
    timeout: 30_000,
  });
  await page.reload();
  expect(await controller()).toBe(`${appUrl}sw.js`);

  // A new deploy: the same worker under another URL. (Routing sw.js does not work for this: Playwright
  // sees only the first request for it, not the update check.)
  await page.evaluate(async () => {
    const { scope } = await navigator.serviceWorker.ready;
    await navigator.serviceWorker.register(new URL('sw.js?next', scope).href, { scope });
  });
  const notice = page.getByRole('status').filter({ hasText: 'Neue Version verfügbar' });
  await expect(notice).toBeVisible({ timeout: 30_000 });
  // It waits: the page keeps running on its version.
  expect(await controller()).toBe(`${appUrl}sw.js`);

  await Promise.all([
    page.waitForEvent('framenavigated'),
    notice.getByRole('button', { name: 'Neu laden' }).click(),
  ]);
  await expect.poll(controller).toBe(`${appUrl}sw.js?next`);
  await expect(page.getByRole('heading', { name: /Verschattungsanalyse/i }).first()).toBeVisible();
  await expect(notice).toBeHidden();
  expect(errors).toEqual([]);
});
