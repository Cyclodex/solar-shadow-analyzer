/**
 * Generates the app icons (web app manifest, iOS home screen) from public/favicon.svg:
 *
 *   npm run icons
 *
 * Renders the SVG in headless Chromium (Playwright, like the e2e tests; no image library needed) and
 * writes the PNGs to public/, where Vite copies them into the build. Commit the PNGs after a logo change.
 *
 * - pwa-192x192.png, pwa-512x512.png (purpose "any"): the favicon as it is, rounded tile, transparent
 *   corners (desktop app windows, Android splash screen).
 * - pwa-maskable-512x512.png (purpose "maskable"): opaque full-bleed tile colour, the logo scaled to 60 %
 *   so all of it stays inside the safe zone (circle with 40 % of the icon size as radius; the farthest
 *   logo point, the lower left panel corner, lies ~0.63 of half the favicon size from the centre).
 * - apple-touch-icon.png (180 × 180): opaque full-bleed tile colour (iOS turns transparency black and
 *   rounds the corners itself), the logo at 80 %.
 *
 * Browser: PLAYWRIGHT_CHROMIUM_PATH if set, else the sandbox Chromium at /opt/pw-browsers/chromium if it
 * exists, else Playwright's own (`npx playwright install chromium`), as in playwright.config.ts.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
/** Fill of the favicon's rounded tile (<rect fill> in public/favicon.svg). */
const TILE = '#131b2e';

interface IconSpec {
  file: string;
  size: number;
  /** Logo size relative to the icon. */
  scale: number;
  /** Opaque background behind the logo, or null for transparent corners. */
  background: string | null;
}

const ICONS: IconSpec[] = [
  { file: 'pwa-192x192.png', size: 192, scale: 1, background: null },
  { file: 'pwa-512x512.png', size: 512, scale: 1, background: null },
  { file: 'pwa-maskable-512x512.png', size: 512, scale: 0.6, background: TILE },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.8, background: TILE },
];

const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';

function page(svg: string, { size, scale, background }: IconSpec): string {
  const inner = Math.round(size * scale);
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return `<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; background: transparent; }
      div { display: grid; place-items: center; width: ${size}px; height: ${size}px; background: ${background ?? 'transparent'}; }
      img { display: block; width: ${inner}px; height: ${inner}px; }
    </style>
  </head>
  <body><div><img src="${src}" alt="" /></div></body>
</html>`;
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(png: Buffer): [number, number] {
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

async function main(): Promise<void> {
  const svg = readFileSync(`${PUBLIC_DIR}favicon.svg`, 'utf8');
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);
  const browser = await chromium.launch({ executablePath });
  try {
    for (const icon of ICONS) {
      const tab = await browser.newPage({
        viewport: { width: icon.size, height: icon.size },
        deviceScaleFactor: 1,
      });
      await tab.setContent(page(svg, icon));
      await tab.locator('img').evaluate((img: HTMLImageElement) => img.decode());
      const png = await tab.screenshot({ type: 'png', omitBackground: true });
      await tab.close();
      const [w, h] = pngSize(png);
      if (w !== icon.size || h !== icon.size) {
        throw new Error(`${icon.file}: rendered ${w} × ${h} px instead of ${icon.size} × ${icon.size} px`);
      }
      writeFileSync(`${PUBLIC_DIR}${icon.file}`, png);
      console.log(`public/${icon.file}  ${w} × ${h} px  ${png.length} bytes`);
    }
  } finally {
    await browser.close();
  }
}

await main();
