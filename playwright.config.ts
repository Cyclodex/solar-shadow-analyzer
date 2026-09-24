import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { basePath } from './scripts/basePath.ts';

// Override with E2E_PORT to run several e2e sessions side by side.
const PORT = Number(process.env.E2E_PORT ?? 4173);
// BASE_PATH (e.g. /solar-shadow-analyzer/ as on GitHub Pages) is passed on to the build and `vite preview`;
// the specs navigate relative to it (page.goto('./')).
const BASE_URL = `http://127.0.0.1:${PORT}${basePath()}`;

// Browser: PLAYWRIGHT_CHROMIUM_PATH if set, else the Claude Code sandbox's pinned Chromium if it exists (its
// revision differs from @playwright/test's, so never run `playwright install` in the sandbox). Everywhere else
// (developer machines, CI) Playwright's own Chromium is used: install it once with `npx playwright install chromium`.
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const chromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: chromiumPath,
          // Software WebGL so the 3D view renders in headless Chromium.
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
