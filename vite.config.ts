/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { basePath } from './scripts/basePath.ts';

/** Page background of the dark theme: --bg in src/styles/global.css (also in index.html). */
const DARK_BG = '#0b1120';

export default defineConfig({
  // '/' by default; the GitHub Pages build sets BASE_PATH=/solar-shadow-analyzer/ (.github/workflows/pages.yml).
  base: basePath(),
  plugins: [
    react(),
    // Installable app with a service worker that precaches the whole build (docs/ARCHITECTURE.md, PWA).
    VitePWA({
      // Never activate an update behind the page's back: the new worker waits until the user reloads
      // (src/pwa/PwaToast.tsx), so an open page keeps the lazy chunks of its own version.
      registerType: 'prompt',
      // Registered from the app (virtual:pwa-register/react), not by an injected script.
      injectRegister: false,
      manifest: {
        id: './',
        name: 'Solar Shadow Analyzer – Verschattungsanalyse',
        short_name: 'Verschattung',
        description:
          'Verschattungsanalyse für Balkon-Solarpanels: gegenseitige Verschattung übereinanderliegender Panels, Jahresertrag mit Wetterdaten, Geländehorizont und Wirtschaftlichkeit – im Browser berechnet.',
        lang: 'de',
        dir: 'ltr',
        // Relative to the manifest, i.e. to the base path.
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: DARK_BG,
        background_color: DARK_BG,
        // Generated from public/favicon.svg by scripts/generate-icons.ts.
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // The icons are in globPatterns already (the plugin adds the manifest itself).
      includeManifestIcons: false,
      workbox: {
        // The whole build, including the lazily loaded 3D chunk (three.js + R3F, ~960 kB). The build fails
        // if a file exceeds maximumFileSizeToCacheInBytes (default 2 MiB) instead of leaving it out.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // No runtime caching: weather and terrain results are cached in localStorage by the app itself.
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    // three.js + R3F form one ~960 kB chunk that is only loaded lazily with the 3D view.
    chunkSizeWarningLimit: 1000,
  },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          // Pure model code: no DOM needed, much faster than jsdom.
          name: 'model',
          environment: 'node',
          include: ['src/model/**/*.test.ts'],
        },
      },
      {
        extends: true,
        // Vitest resolves with `mainFields: []` (Node-like). @react-three/fiber has no "exports" map, only
        // main (CJS) and module (ESM), so it would load its CJS build, which require()s three and logs
        // THREE_CJS_DEPRECATED. Prefer the "module" entry instead.
        resolve: {
          mainFields: ['module', 'main'],
          // The service worker registration of vite-plugin-pwa: an inert stub that tests can vi.mock.
          alias: {
            'virtual:pwa-register/react': fileURLToPath(
              new URL('./src/test/pwaRegister.ts', import.meta.url),
            ),
          },
        },
        test: {
          name: 'ui',
          environment: 'jsdom',
          // Inline R3F so Vite (not Node) transforms and loads its ESM entry.
          server: { deps: { inline: ['@react-three/fiber'] } },
          setupFiles: './src/setupTests.ts',
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['src/model/**', 'node_modules', 'dist', 'e2e'],
        },
      },
    ],
  },
});
