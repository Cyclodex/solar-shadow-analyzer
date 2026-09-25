import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { decode } from 'fast-png';
import { PbfWriter } from 'pbf';
import { enuToLonLat } from '../src/model/enu.ts';
import { wgs84ToLv95 } from '../src/model/lv95.ts';

// Surrounding buildings (docs/ARCHITECTURE.md, "Umgebung"): «Gebäude laden» around the default location with
// the swisstopo vector tiles mocked by a synthetic tile, then the list (edit, remove, persisted), the site plan
// (facade and balcony → location) and the 3D view. The address search (SearchServer, building register,
// height service) answers with a synthetic address in the own building. Every other external request is
// blocked, like in the other specs.

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

/** The synthetic address: 6 m north of SITE, inside the own building. */
const ADDRESS = enuToLonLat(SITE, 0, 6);

/** SearchServer answer for the synthetic address (the shape of api3.geo.admin.ch, see geocode fixtures). */
function searchResult(): unknown {
  const { east, north } = wgs84ToLv95(ADDRESS.latitude, ADDRESS.longitude);
  return {
    results: [
      {
        attrs: {
          detail: 'teststrasse 1 3000 bern 351 bern ch be',
          featureId: '9999999_0',
          geom_st_box2d: `BOX(${east.toFixed(3)} ${north.toFixed(3)},${east.toFixed(3)} ${north.toFixed(3)})`,
          label: 'Teststrasse 1 <b>3000 Bern</b>',
          lat: ADDRESS.latitude,
          lon: ADDRESS.longitude,
          num: 1,
          objectclass: '',
          origin: 'address',
          rank: 7,
          x: north,
          y: east,
          zoomlevel: 10,
        },
        id: 1,
        weight: 7,
      },
    ],
  };
}

async function mockTiles(page: Page): Promise<void> {
  await page.route(/open-meteo\.com|amazonaws\.com|geo\.admin\.ch/, (route) => route.abort());
  // The address search (feature A): search, building register (none: 404) and height service.
  await page.route(/api3\.geo\.admin\.ch/, (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    if (url.pathname.endsWith('/SearchServer')) {
      const text = url.searchParams.get('searchText') ?? '';
      return json(/^teststrasse/i.test(text) ? searchResult() : { results: [] });
    }
    if (url.pathname.endsWith('/height')) return json({ height: '540.0' });
    return json({ status: 'error', code: 404 }, 404);
  });
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

  // The share hash follows the config at most every 400 ms, and a reload restores it from there.
  await expect.poll(async () => JSON.stringify(await hashConfig(page))).toContain('"r":1');
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

// ── Site plan and 3D view ─────────────────────

/** The config in the #c= share hash (base64url JSON with short keys, see share.ts). */
async function hashConfig(page: Page): Promise<{ l?: { a?: number; o?: number }; b?: { a?: number } }> {
  const hash = new URL(page.url()).hash;
  if (!hash.startsWith('#c=')) return {};
  return JSON.parse(Buffer.from(hash.slice(3), 'base64url').toString('utf8')) as never;
}

async function openSection(page: Page, name: RegExp, touch: boolean): Promise<void> {
  const toggle = page.getByRole('button', { name });
  await toggle.scrollIntoViewIfNeeded();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await (touch ? toggle.tap() : toggle.click());
}

/**
 * Imports the surroundings: with the address search (feature A) by picking the synthetic address (the site
 * plan then opens by itself), else with «Gebäude laden» and opening the «Gebäude» section.
 */
async function importSurroundings(page: Page, touch: boolean): Promise<void> {
  const press = (l: Locator): Promise<void> => (touch ? l.tap() : l.click());
  await openSection(page, /^Standort/, touch);
  const search = page.getByRole('combobox', { name: 'Adresse oder Ort suchen' });
  if ((await search.count()) > 0) {
    await press(search);
    await search.pressSequentially('Teststrasse 1', { delay: 30 });
    await press(page.getByRole('option', { name: /Teststrasse 1, 3000 Bern/ }));
    return;
  }
  await openSection(page, /^Horizont & Umgebung/, touch);
  await press(page.getByRole('button', { name: 'Gebäude laden' }));
  await expect(page.getByText(/^3 Gebäude · Quelle swisstopo/)).toBeVisible({ timeout: 20_000 });
  await openSection(page, /^Gebäude\s?\d+°/, touch);
}

/** Screen centre of the facade edge `index` of the own building on the plan (a line, 0 px wide if vertical). */
async function edgeCentre(plan: Locator, index: string | null): Promise<{ x: number; y: number }> {
  await plan.scrollIntoViewIfNeeded();
  return plan
    .locator(`[data-edge="${index}"] line`)
    .first()
    .evaluate((line) => {
      const r = line.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
}

/** Pixels (of equal-size PNG screenshots) that differ clearly in colour. */
function differingPixels(a: Buffer, b: Buffer): number {
  const pa = decode(a);
  const pb = decode(b);
  if (pa.width !== pb.width || pa.height !== pb.height) return Infinity;
  const ch = pa.channels;
  let n = 0;
  for (let i = 0; i < pa.data.length; i += ch) {
    const d =
      Math.abs(pa.data[i] - pb.data[i]) +
      Math.abs(pa.data[i + 1] - pb.data[i + 1]) +
      Math.abs(pa.data[i + 2] - pb.data[i + 2]);
    if (d > 40) n++;
  }
  return n;
}

test('site plan: facade and balcony set the location; the buildings show in the list and in 3D', async ({
  page,
}) => {
  await page.goto('./');
  await importSurroundings(page, false);
  const plan = page.getByRole('group', { name: 'Lageplan, Norden oben' });
  await expect(plan).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('note')).toContainText('Fassade und Balkon bestätigen');

  // The own building stands alone: all four walls are facades.
  const select = page.getByRole('combobox', { name: 'Fassade mit dem Balkon' });
  await expect(select.locator('option')).toHaveText([/^0° N/, /^90° O/, /^180° S/, /^270° W/]);
  // Keyboard alternative to tapping another building: «Eigenes Gebäude» (imported ones within 25 m).
  const own = page.getByRole('combobox', { name: 'Eigenes Gebäude' });
  await expect(own.locator('option')).toHaveText([/^Gebäude 1 · /, /^Gebäude 2 · 20\sm S$/]);
  await own.selectOption({ label: (await own.locator('option').nth(1).textContent()) ?? '' });
  await expect(select.locator('option')).toHaveText([/^0° N · 30/, /^90° O/, /^180° S/, /^270° W/]);
  await page.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(own).toHaveValue('b1');
  // Clicking the east wall on the plan chooses it …
  const east = await select.locator('option', { hasText: '90° O' }).getAttribute('value');
  const eastCentre = await edgeCentre(plan, east);
  await page.mouse.click(eastCentre.x, eastCentre.y);
  await expect(select).toHaveValue(east ?? '');
  // … the keyboard alternative: the south wall, 4 m from its west corner.
  const south = await select.locator('option', { hasText: '180° S' }).getAttribute('value');
  await select.selectOption(south ?? '');
  const along = page.getByRole('textbox', { name: /Position entlang der Fassade/ });
  await along.fill('4');
  await along.press('Enter');
  await expect(page.getByText(/Noch nicht übernommen/)).toBeVisible();
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.getByText('Balkon an der Fassade 180° S des eigenen Gebäudes.')).toBeVisible();

  // Location = the balcony on the south wall (≈ 4 m east of its west corner at −8 m), 1e-6°.
  await expect.poll(async () => (await hashConfig(page)).b?.a).toBe(180);
  const { l } = await hashConfig(page);
  const metresPerDegLon = (Math.PI / 180) * 6378137 * Math.cos((SITE.latitude * Math.PI) / 180);
  expect(Math.abs((l?.a ?? 0) - SITE.latitude) * 111_200).toBeLessThan(0.6);
  expect(Math.abs((l?.o ?? 0) - (SITE.longitude - 4 / metresPerDegLon)) * metresPerDegLon).toBeLessThan(0.6);
  for (const v of [l?.a ?? 0, l?.o ?? 0]) expect(Math.round(v * 1e6) / 1e6).toBe(v);

  // Listed in «Horizont & Umgebung».
  await openSection(page, /^Horizont & Umgebung/, false);
  await page.getByRole('button', { name: 'Liste (3)' }).click();
  await expect(page.locator('li[data-building]')).toHaveCount(3);

  // 3D: the buildings layer changes the picture.
  const canvas = page.locator('canvas').first();
  await canvas.scrollIntoViewIfNeeded();
  const layer = page.getByRole('button', { name: 'Umgebungsgebäude' });
  await expect(layer).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(500);
  const withBuildings = await canvas.screenshot();
  await layer.click();
  await expect(layer).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(async () => differingPixels(withBuildings, await canvas.screenshot()), { timeout: 10_000 })
    .toBeGreaterThan(2000);
});

test('another site: after moving the location far away the buildings are said to belong elsewhere', async ({
  page,
}) => {
  await page.goto('./');
  await importSurroundings(page, false);
  await expect(page.getByRole('group', { name: 'Lageplan, Norden oben' })).toBeVisible({ timeout: 20_000 });
  const layer = page.getByRole('button', { name: 'Umgebungsgebäude' });
  await expect(layer).toBeVisible();
  // Zürich by the coordinate fields: no new import.
  await openSection(page, /^Standort/, false);
  for (const [name, value] of [
    [/^Breitengrad/, '47.3769'],
    [/^Längengrad/, '8.5417'],
  ] as const) {
    const field = page.getByRole('textbox', { name });
    await field.fill(value);
    await field.press('Enter');
  }
  await expect(
    page.getByText(/gehören zu einem anderen Ort: Sie liegen \d+\.\d\skm vom Standort entfernt\.$/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gebäude um den Standort laden' })).toBeVisible();
  // 3D: none of them is drawn (as far-away shadow casters they took every shadow away).
  await expect(layer).toHaveCount(0);
  // The list says so too, and adding a building by hand explains why it cannot.
  await openSection(page, /^Horizont & Umgebung/, false);
  await expect(page.getByTestId('other-site')).toContainText('Für diesen Standort «Neu laden» wählen.');
  await page.getByRole('button', { name: 'Gebäude hinzufügen' }).click();
  const form = page.getByRole('group', { name: 'Gebäude von Hand erfassen' });
  await form.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(form.getByRole('alert')).toContainText('lässt sich hier nicht hinzufügen');
  await expect(page.getByText(/^3 Gebäude · Quelle swisstopo/)).toBeVisible();
});

test.describe('site plan on an iPhone', () => {
  const { userAgent, deviceScaleFactor, isMobile, hasTouch, viewport } = devices['iPhone 14'];
  test.use({ userAgent, deviceScaleFactor, isMobile, hasTouch, viewport });

  test('tap a facade, apply; fits the screen with 44 px buttons', async ({ page }) => {
    await page.goto('./');
    await importSurroundings(page, true);
    const plan = page.getByRole('group', { name: 'Lageplan, Norden oben' });
    await expect(plan).toBeVisible({ timeout: 20_000 });
    const select = page.getByRole('combobox', { name: 'Fassade mit dem Balkon' });
    expect(await select.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
    const north = await select.locator('option', { hasText: '0° N' }).getAttribute('value');
    const edge = await edgeCentre(plan, north);
    await page.touchscreen.tap(edge.x, edge.y);
    await expect(select).toHaveValue(north ?? '');
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).tap();
    await expect(page.getByText('Balkon an der Fassade 0° N des eigenen Gebäudes.')).toBeVisible();
    for (const name of ['Vergrössern', 'Verkleinern', 'Plan zentrieren', 'Übernehmen']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    const planBox = await plan.boundingBox();
    expect((planBox?.x ?? 0) + (planBox?.width ?? 999)).toBeLessThanOrEqual(viewport.width);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
