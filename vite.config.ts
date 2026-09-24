/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { basePath } from './scripts/basePath.ts';

export default defineConfig({
  // '/' by default; the GitHub Pages build sets BASE_PATH=/solar-shadow-analyzer/ (.github/workflows/pages.yml).
  base: basePath(),
  plugins: [react()],
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
        resolve: { mainFields: ['module', 'main'] },
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
