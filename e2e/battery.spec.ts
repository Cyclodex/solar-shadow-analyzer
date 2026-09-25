import { devices, expect, test } from '@playwright/test';

// External data is blocked: results come from the clear-sky fallback, terrain is skipped.
test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|amazonaws\.com/, (route) => route.abort());
});

/** Share hash of the default config with the storage switched on (format version 2). */
const HASH = '#c=' + Buffer.from(JSON.stringify({ v: 2, x: { e: true } })).toString('base64url');

test('battery: a share link switches the storage on; KPIs, charts and settings appear', async ({ page }) => {
  await page.goto('./' + HASH);
  const group = page.getByRole('heading', { name: 'Batterie 2025' }).locator('..');
  await expect(group.getByText('Mehrertrag durch Batterie')).toBeVisible({ timeout: 20_000 });
  await expect(group).toContainText(/\+\d/);
  await expect(page.getByRole('region', { name: 'Tagesverlauf mit Batterie' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Energiefluss mit Batterie' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Wirtschaftlichkeit mit und ohne Batterie' })).toBeVisible();
  // Switching it off in the settings removes the battery results and clears the hash (default config).
  await page.getByRole('button', { name: /^Batterie/ }).click();
  await page.getByRole('switch', { name: 'Batteriespeicher berechnen' }).click();
  await expect(page.getByRole('heading', { name: 'Batterie 2025' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Energiefluss mit Batterie' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
});

test.describe('battery on a phone', () => {
  const { userAgent, deviceScaleFactor, isMobile, hasTouch, viewport } = devices['iPhone 14'];
  test.use({ userAgent, deviceScaleFactor, isMobile, hasTouch, viewport });

  test('no horizontal scrolling with the battery results', async ({ page }) => {
    await page.goto('./' + HASH);
    await expect(page.getByRole('region', { name: 'Energiefluss mit Batterie' })).toBeVisible({
      timeout: 20_000,
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
