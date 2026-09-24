import { expect, test } from '@playwright/test';

// External data is blocked: results come from the clear-sky fallback, terrain is skipped.
test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|amazonaws\.com/, (route) => route.abort());
});

test('3D view renders a WebGL canvas with content', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  // Wait until the scene has drawn something other than a single flat colour.
  await expect
    .poll(
      () =>
        canvas.evaluate((el: HTMLCanvasElement) => {
          const probe = document.createElement('canvas');
          probe.width = 64;
          probe.height = 64;
          const ctx = probe.getContext('2d');
          if (!ctx) return 0;
          ctx.drawImage(el, 0, 0, 64, 64);
          const data = ctx.getImageData(0, 0, 64, 64).data;
          const colours = new Set<number>();
          for (let i = 0; i < data.length; i += 4) {
            colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
          }
          return colours.size;
        }),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(20);
});

test('share link restores the configuration', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: /Teilen/ }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/#c=/);

  // Change the tilt, then open the copied link: the original tilt (45°) must come back.
  const tilt = page.getByRole('slider', { name: /Neigung θ ab Senkrechte/ });
  await tilt.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tilt).toHaveValue('46');

  const fresh = await context.newPage();
  await fresh.route(/open-meteo\.com|amazonaws\.com/, (route) => route.abort());
  await fresh.goto(link);
  await expect(fresh.getByRole('slider', { name: /Neigung θ ab Senkrechte/ })).toHaveValue('45');
});

test('language toggle switches to English', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'EN' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Shading analysis/i);
});
