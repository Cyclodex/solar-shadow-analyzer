/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
        test: {
          name: 'ui',
          environment: 'jsdom',
          // Load R3F as ESM (its CJS build logs a THREE_CJS_DEPRECATED warning in Node).
          server: { deps: { inline: ['@react-three/fiber'] } },
          setupFiles: './src/setupTests.ts',
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['src/model/**', 'node_modules', 'dist', 'e2e'],
        },
      },
    ],
  },
});
