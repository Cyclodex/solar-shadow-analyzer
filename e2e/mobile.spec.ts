import { devices, expect, test, type Page } from '@playwright/test';

// External data is blocked: results come from the clear-sky fallback, terrain is skipped.
test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|amazonaws\.com/, (route) => route.abort());
});

const controlBar = (page: Page) => page.getByRole('region', { name: 'Schnellsteuerung' });

/** Rows of the 3D view's camera buttons (distinct tops). */
const cameraRows = (page: Page) =>
  page
    .getByRole('toolbar', { name: 'Kamera' })
    .evaluate(
      (bar) =>
        new Set([...bar.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top)))
          .size,
    );

test.describe('iPhone', () => {
  // iPhone 14 (touch, coarse pointer) in Chromium; the browser type of the descriptor is not switched.
  const { userAgent, deviceScaleFactor, isMobile, hasTouch, viewport } = devices['iPhone 14'];
  test.use({ userAgent, deviceScaleFactor, isMobile, hasTouch, viewport });

  test('control bar: at the bottom, −/+ change the time, "Springe zu" scrolls to the settings', async ({
    page,
  }) => {
    await page.goto('./');
    const bar = controlBar(page);
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(viewport.height);

    const clock = bar.getByRole('button', { name: /^Uhrzeit/ });
    await expect(clock).toContainText('12:00');
    await bar.getByRole('button', { name: '15 Minuten später' }).tap();
    await expect(clock).toContainText('12:15');
    // The time card follows (one time for the whole app).
    await expect(page.getByRole('slider', { name: 'Uhrzeit (Ortszeit)' })).toHaveAttribute(
      'aria-valuetext',
      /^12:15/,
    );
    await bar.getByRole('button', { name: '15 Minuten früher' }).tap();
    await bar.getByRole('button', { name: '15 Minuten früher' }).tap();
    await expect(clock).toContainText('11:45');

    const settings = page.getByRole('heading', { name: 'Einstellungen' });
    await expect(settings).not.toBeInViewport();
    await bar.getByRole('button', { name: 'Springe zu' }).tap();
    await bar.getByRole('link', { name: 'Einstellungen' }).tap();
    await expect(settings).toBeInViewport();
    // No '#settings' in the URL (it would replace a '#c=' share link) and the menu is closed again.
    expect(new URL(page.url()).hash).toBe('');
    await expect(bar.getByRole('navigation')).toBeHidden();
    // The focus moved to the settings (screen readers continue there).
    await expect(page.locator('#settings')).toBeFocused();

    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('"Springe zu › Ansichten (3D)" shows the 3D view with its camera buttons above the control bar', async ({
    page,
  }) => {
    await page.goto('./');
    const camera = page.getByRole('toolbar', { name: 'Kamera' });
    await expect(camera).toBeAttached();
    const bar = controlBar(page);
    await bar.getByRole('button', { name: 'Springe zu' }).tap();
    await bar.getByRole('link', { name: 'Ansichten (3D)' }).tap();
    await expect(page.locator('#views')).toBeFocused();
    // The page scrolls smoothly: wait until the camera buttons are above the bar.
    await expect
      .poll(async () => {
        const [cam, top] = await Promise.all([camera.boundingBox(), bar.boundingBox()]);
        return (cam?.y ?? 0) >= 0 && (cam?.y ?? 0) + (cam?.height ?? Infinity) <= (top?.y ?? 0);
      })
      .toBe(true);
    expect(await cameraRows(page)).toBe(1);
  });
});

test.describe('iPhone SE (320 px)', () => {
  const { userAgent, deviceScaleFactor, isMobile, hasTouch, viewport } = devices['iPhone SE'];
  test.use({ userAgent, deviceScaleFactor, isMobile, hasTouch, viewport });

  test('the camera buttons of the 3D view stay in one row', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('toolbar', { name: 'Kamera' })).toBeAttached();
    expect(await cameraRows(page)).toBe(1);
  });
});

test('desktop: no control bar, time and tilt in the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Zeitpunkt' })).toBeInViewport();
  await expect(controlBar(page)).toHaveCount(0);
});
