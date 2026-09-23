import { expect, test } from '@playwright/test';

test('app loads and shows the main heading', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  await expect(page).toHaveTitle(/Verschattungsanalyse/i);
  await expect(page.getByRole('heading', { name: /Verschattungsanalyse/i }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
