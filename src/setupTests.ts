import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────
// UI test environment (jsdom)
// - Network is disabled: global fetch rejects unless a test stubs it (vi.stubGlobal('fetch', …)).
// - Browser APIs missing in jsdom are stubbed: matchMedia, ResizeObserver, IntersectionObserver,
//   canvas 2D/WebGL contexts (null), URL.createObjectURL.
// Reset stores between tests with resetStores() from src/test/utils.ts where state matters.
// ─────────────────────────────────────────────

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

function matchMediaStub(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('network disabled in tests'))),
  );
  if (!window.matchMedia) vi.stubGlobal('matchMedia', vi.fn(matchMediaStub));
  if (!('ResizeObserver' in window)) vi.stubGlobal('ResizeObserver', NoopObserver);
  if (!('IntersectionObserver' in window)) vi.stubGlobal('IntersectionObserver', NoopObserver);
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  }
});

// jsdom logs "Not implemented: HTMLCanvasElement.prototype.getContext" — return null silently instead.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  writable: true,
  value: () => null,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});
