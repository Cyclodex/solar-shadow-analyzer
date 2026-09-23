import { expect, test } from '@playwright/test';

// External data (Open-Meteo, terrain tiles) is blocked: the app must fall back to the clear-sky year.
test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|amazonaws\.com/, (route) => route.abort());
});

test('app loads, shows the main heading and annual results', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  await expect(page).toHaveTitle(/Verschattungsanalyse/i);
  await expect(page.getByRole('heading', { name: /Verschattungsanalyse/i }).first()).toBeVisible();
  const annual = page.locator('dt', { hasText: 'Jahresertrag' }).locator('..');
  await expect(annual).toContainText(/\d\s?kWh/, { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('no horizontal scrolling on a 360 px phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Verschattungsanalyse/i }).first()).toBeVisible();
  const [scrollWidth, clientWidth] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});
