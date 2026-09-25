import { devices, expect, test, type Page } from '@playwright/test';
import { PbfWriter } from 'pbf';

// Surrounding buildings (docs/ARCHITECTURE.md, "Umgebung"): «Gebäude laden» around the default location with
// the swisstopo vector tiles mocked by a synthetic tile, then the list (edit, remove, persisted). Every other
// external request is blocked, like in the other specs.

/** Default location of the app (DEFAULT_CONFIG): 47.1° N, 7.45° E. */
const SITE = { latitude: 47.1, longitude: 7.45 };
const Z = 14;
const EXTENT = 4096;

/** Fractional Web Mercator tile coordinates at zoom Z (as model/buildingSources.ts lonLatToTile). */
function tileXY(latitude: number, longitude: number): { x: number; y: number } {
  const n = 2 ** Z;
  const lat = (latitude * Math.PI) / 180;
  return {
    x: ((longitude + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
  };
}

const zigzag = (v: number): number => (v << 1) ^ (v >> 31);
const command = (id: number, count: number): number => (id & 7) | (count << 3);

/** A minimal Mapbox Vector Tile with a `building` layer (polygons with render_height). */
function buildingTile(buildings: { ring: [number, number][]; height: number }[]): Uint8Array {
  const pbf = new PbfWriter();
  pbf.writeMessage(
    3,
    (_: unknown, w: PbfWriter) => {
      w.writeVarintField(15, 2);
      w.writeStringField(1, 'building');
      const heights = [...new Set(buildings.map((b) => b.height))];
      for (const b of buildings) {
        w.writeMessage(
          2,
          (_f: unknown, fw: PbfWriter) => {
            fw.writePackedVarint(2, [0, heights.indexOf(b.height)]);
            fw.writeVarintField(3, 3);
            const geom: number[] = [];
            let x = 0;
            let y = 0;
            b.ring.forEach(([px, py], i) => {
              if (i === 0) geom.push(command(1, 1));
              if (i === 1) geom.push(command(2, b.ring.length - 1));
              geom.push(zigzag(px - x), zigzag(py - y));
              x = px;
              y = py;
            });
            geom.push(command(7, 1));
            fw.writePackedVarint(4, geom);
          },
          null,
        );
      }
      w.writeStringField(3, 'render_height');
      for (const h of heights)
        w.writeMessage(4, (_v: unknown, vw: PbfWriter) => vw.writeSVarintField(6, h), null);
      w.writeVarintField(5, EXTENT);
    },
    null,
  );
  // Real tiles in CH/FL always have more layers (roads, land cover …); layers without features are dropped
  // by the decoder, and a tile with nothing but administrative units counts as outside CH/FL.
  pbf.writeMessage(
    3,
    (_: unknown, w: PbfWriter) => {
      w.writeVarintField(15, 2);
      w.writeStringField(1, 'landcover');
      w.writeMessage(
        2,
        (_f: unknown, fw: PbfWriter) => {
          fw.writeVarintField(3, 1);
          fw.writePackedVarint(4, [command(1, 1), zigzag(10), zigzag(10)]);
        },
        null,
      );
      w.writeVarintField(5, EXTENT);
    },
    null,
  );
  return pbf.finish();
}

/**
 * Buildings around SITE in metres east/north, in global tile units (x · 4096 + px at Z, y down): the own
 * building behind the facade (facade azimuth 202°: behind = north-north-east), one across the street, one
 * south-west, and one far away, low and hidden behind the one across the street (not kept).
 */
function siteBuildings(): { ring: [number, number][]; height: number }[] {
  const t = tileXY(SITE.latitude, SITE.longitude);
  const metresPerUnit =
    (2 * Math.PI * 6378137 * Math.cos((SITE.latitude * Math.PI) / 180)) / (2 ** Z * EXTENT);
  const box = (e0: number, n0: number, e1: number, n1: number): [number, number][] =>
    (
      [
        [e0, n0],
        [e1, n0],
        [e1, n1],
        [e0, n1],
      ] as [number, number][]
    ).map(([e, n]) => [
      Math.round(t.x * EXTENT + e / metresPerUnit),
      Math.round(t.y * EXTENT - n / metresPerUnit),
    ]);
  return [
    // Own: its south wall on the facade line through the site (tile units are 0.41 m: the probe 0.5 m behind
    // the facade origin stays inside).
    { ring: box(-8, 0, 8, 12), height: 18 },
    { ring: box(-15, -35, 15, -20), height: 21 }, // across the street (south)
    { ring: box(-45, -40, -30, -25), height: 12 },
    { ring: box(-5, -120, 5, -110), height: 6 }, // far, low, hidden behind the one across: not kept
  ];
}

/**
 * Tile (x, y) as the tile server cuts it: every building reaching into the tile (plus the 16-unit buffer), in
 * the tile's own units (the import clips each piece to its tile and joins the pieces again). Every tile has
 * the `building` layer: a tile without it counts as outside Switzerland and Liechtenstein.
 */
function tileBytes(x: number, y: number): Uint8Array {
  const x0 = x * EXTENT;
  const y0 = y * EXTENT;
  const reaches = ([px, py]: [number, number]): boolean =>
    px >= x0 - 16 && px <= x0 + EXTENT + 16 && py >= y0 - 16 && py <= y0 + EXTENT + 16;
  return buildingTile(
    siteBuildings()
      .filter((b) => b.ring.some(reaches))
      .map((b) => ({ ...b, ring: b.ring.map(([px, py]): [number, number] => [px - x0, py - y0]) })),
  );
}

async function mockTiles(page: Page): Promise<void> {
  await page.route(/open-meteo\.com|amazonaws\.com|geo\.admin\.ch/, (route) => route.abort());
  // Registered later = matched first: the vector tiles are served, everything else stays blocked.
  await page.route(/vectortiles\.geo\.admin\.ch/, (route) => {
    const url = route.request().url();
    if (url.endsWith('/tiles.json')) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ attribution: '© swisstopo' }),
      });
    }
    const m = /\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url);
    if (!m) return route.fulfill({ status: 404 });
    return route.fulfill({
      contentType: 'application/x-protobuf',
      body: Buffer.from(tileBytes(Number(m[2]), Number(m[3]))),
    });
  });
}

async function openBuildings(page: Page) {
  await page.goto('./');
  const section = page.getByRole('button', { name: /^Horizont & Umgebung/ });
  await section.scrollIntoViewIfNeeded();
  // The open state is persisted (a reload keeps the section open).
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  const heading = page.getByRole('heading', { name: 'Umgebungsgebäude' });
  await heading.scrollIntoViewIfNeeded();
  return heading;
}

test.beforeEach(async ({ page }) => {
  await mockTiles(page);
});

test('«Gebäude laden» imports the surrounding buildings; edits persist across a reload', async ({ page }) => {
  await openBuildings(page);
  await expect(page.getByText(/Noch keine Gebäude/)).toBeVisible();
  await page.getByRole('button', { name: 'Gebäude laden' }).click();
  await expect(page.getByText(/4 Gebäudeteile im Umkreis von 300\sm gefunden, 3 übernommen/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/^3 Gebäude · Quelle swisstopo, Stand /)).toBeVisible();

  await page.getByRole('button', { name: 'Liste (3)' }).click();
  const items = page
    .getByRole('list')
    .filter({ has: page.getByText('Eigenes Gebäude') })
    .getByRole('listitem');
  await expect(items).toHaveCount(3);
  await expect(items.first()).toContainText('Eigenes Gebäude');
  await expect(items.nth(1)).toContainText(/21\sm hoch · 20\sm entfernt, S/);

  // Remove the building across the street: it stays listed (restorable) and no longer counts.
  const across = items.nth(1);
  await across.getByRole('button', { name: /entfernen$/ }).click();
  await expect(across.getByRole('button', { name: /wiederherstellen$/ })).toBeVisible();
  await expect(page.getByText(/^2 Gebäude · Quelle swisstopo, Stand .* · 1 entfernt$/)).toBeVisible();

  await page.reload();
  await openBuildings(page);
  await expect(page.getByText(/^2 Gebäude · Quelle swisstopo, Stand .* · 1 entfernt$/)).toBeVisible();
  // The import result itself is not persisted, the buildings are.
  await expect(page.getByRole('button', { name: 'Neu laden' })).toBeVisible();
});

test('re-import asks before discarding changes', async ({ page }) => {
  await openBuildings(page);
  await page.getByRole('button', { name: 'Gebäude laden' }).click();
  await page.getByRole('button', { name: 'Liste (3)' }).click({ timeout: 20_000 });
  await page
    .getByRole('button', { name: /entfernen$/ })
    .nth(1)
    .click();
  await page.getByRole('button', { name: 'Neu laden' }).click();
  const dialog = page.getByRole('group', { name: 'Gebäude neu laden?' });
  await expect(dialog).toContainText('Die Änderungen an 1 importierten Gebäude');
  await expect(dialog.getByRole('button', { name: 'Neu laden' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Neu laden' }).click();
  await expect(page.getByText(/^3 Gebäude · Quelle swisstopo/)).toBeVisible({ timeout: 20_000 });
});

test.describe('iPhone', () => {
  const { userAgent, deviceScaleFactor, isMobile, hasTouch, viewport } = devices['iPhone 14'];
  test.use({ userAgent, deviceScaleFactor, isMobile, hasTouch, viewport });

  test('list and manual entry fit the screen, touch targets ≥ 44 px', async ({ page }) => {
    await openBuildings(page);
    await page.getByRole('button', { name: 'Gebäude laden' }).tap();
    await page.getByRole('button', { name: 'Liste (3)' }).tap({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Gebäude hinzufügen' }).tap();
    const form = page.getByRole('group', { name: 'Gebäude von Hand erfassen' });
    await expect(form).toBeFocused();
    await form.getByRole('button', { name: 'Hinzufügen' }).tap();
    await expect(page.getByText(/^4 Gebäude, davon 1 von Hand/)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    const list = page.getByRole('list').filter({ has: page.getByText('Eigenes Gebäude') });
    for (const button of await list.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
