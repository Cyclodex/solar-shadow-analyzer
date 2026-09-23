/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
          setupFiles: './src/setupTests.ts',
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['src/model/**', 'node_modules', 'dist', 'e2e'],
        },
      },
    ],
  },
});
