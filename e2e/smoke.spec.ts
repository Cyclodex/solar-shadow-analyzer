import { devices, expect, test, type Page } from '@playwright/test';

// External data (Open-Meteo, terrain tiles) is blocked: the app must fall back to the clear-sky year.
test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|amazonaws\.com/, (route) => route.abort());
});

test('app loads, shows the main heading and annual results', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./');

  await expect(page).toHaveTitle(/Verschattungsanalyse/i);
  await expect(page.getByRole('heading', { name: /Verschattungsanalyse/i }).first()).toBeVisible();
  const annual = page.locator('dt', { hasText: 'Jahresertrag' }).locator('..');
  await expect(annual).toContainText(/\d\s?kWh/, { timeout: 15_000 });
  expect(errors).toEqual([]);
});

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const [scrollWidth, clientWidth] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test('no horizontal scrolling on a 360 px phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /Verschattungsanalyse/i }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test.describe('iPhone at 360 px', () => {
  // Safari's user agent (in Chromium): the header also shows the install button with the home screen steps.
  const { userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone SE'];
  test.use({ userAgent, deviceScaleFactor, isMobile, hasTouch, viewport: { width: 360, height: 640 } });

  test('no horizontal scrolling, the install steps stay on screen', async ({ page }) => {
    await page.goto('./');
    const install = page.getByRole('button', { name: 'Installieren' });
    await expect(install).toBeVisible();
    await expectNoHorizontalScroll(page);

    await install.click();
    const steps = page.getByRole('group', { name: 'Als App auf den Home-Bildschirm' });
    await expect(steps).toBeVisible();
    const box = await steps.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(360);
    await expectNoHorizontalScroll(page);
  });
});
