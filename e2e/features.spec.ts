import { expect, test, type Locator } from '@playwright/test';

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

/** The WebGL canvas scaled down to 48 × 32 px, RGB values (the scene preserves its drawing buffer). */
function sample(canvas: Locator): Promise<number[]> {
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const probe = document.createElement('canvas');
    probe.width = 48;
    probe.height = 32;
    const ctx = probe.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(el, 0, 0, 48, 32);
    return Array.from(ctx.getImageData(0, 0, 48, 32).data).filter((_, i) => i % 4 !== 3);
  });
}

/** Mean absolute difference of two samples per colour channel (0…255). */
function difference(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + Math.abs(v - (b[i] ?? 0)), 0) / Math.max(1, a.length);
}

/** Waits until the scene has stopped changing (camera moves are animated) and returns it. */
async function settled(canvas: Locator): Promise<number[]> {
  let last = await sample(canvas);
  let still = 0;
  await expect
    .poll(
      async () => {
        const next = await sample(canvas);
        still = difference(last, next) === 0 ? still + 1 : 0;
        last = next;
        return still;
      },
      { intervals: [250], timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(2);
  return last;
}

test('"Aus Sonnenrichtung" survives a click, follows the time, gives way at night', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('Juni-Sonnenwende').click();
  const time = page.getByRole('slider', { name: 'Uhrzeit (Ortszeit)' });
  await time.fill('780'); // 13:00
  const view = page.getByRole('region', { name: '3D-Ansicht', exact: true });
  const canvas = view.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const sun = view.getByRole('button', { name: 'Aus Sonnenrichtung', exact: true });
  await expect(sun).toBeEnabled({ timeout: 20_000 });
  await sun.click();
  await expect(sun).toHaveAttribute('aria-pressed', 'true');
  const at13 = await settled(canvas);

  // A click without moving is no camera move: the preset stays.
  await canvas.click();
  await expect(sun).toHaveAttribute('aria-pressed', 'true');
  expect(difference(await settled(canvas), at13)).toBeLessThan(1);

  // The view follows the sun to 15:00, to the same pose as choosing the preset anew at 15:00.
  await time.fill('900');
  await expect(sun).toHaveAttribute('aria-pressed', 'true');
  const followed = await settled(canvas);
  expect(difference(followed, at13)).toBeGreaterThan(5);
  await view.getByRole('button', { name: 'Front', exact: true }).click();
  await settled(canvas);
  await sun.click();
  expect(difference(await settled(canvas), followed)).toBeLessThan(1);

  // Sun below the horizon: the overview (the same view as "reset"), not the narrow view from the sun.
  await time.fill('1380'); // 23:00
  await expect(sun).toBeDisabled();
  await expect(sun).toHaveAttribute('aria-pressed', 'false');
  const night = await settled(canvas);
  await view.getByRole('button', { name: 'Ansicht zurücksetzen', exact: true }).click();
  expect(difference(await settled(canvas), night)).toBeLessThan(1);
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
  await page.getByRole('radio', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Shading analysis/i);
});
