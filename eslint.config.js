import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'test-results', 'playwright-report', '.claude']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite(),
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true, allowCompoundComponents: true },
      ],
      // `import type` for type-only imports; `typeof import('…')` in vi.mock factories stays allowed.
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
    },
  },
  {
    // App code: type-aware checks for promise handling, no stray console output.
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      // `attributes: false` allows async functions as JSX event handlers (they catch their own errors).
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The model layer stays UI-free (docs/ARCHITECTURE.md): no React, state, hooks, i18n or three.js.
    files: ['src/model/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-dom',
                'react-dom/*',
                'zustand',
                'zustand/*',
                'three',
                'three/*',
                '@react-three/*',
                '**/state/**',
                '**/hooks/**',
                '**/i18n/**',
                '**/components/**',
                '**/views/**',
                '**/controls/**',
                '**/charts/**',
                '**/app/**',
                '**/export/**',
              ],
              message: 'src/model must stay UI-free (see docs/ARCHITECTURE.md).',
            },
          ],
        },
      ],
    },
  },
  {
    // Build / tooling config files and e2e specs run in Node.
    files: ['*.config.{js,ts}', 'e2e/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
]);
