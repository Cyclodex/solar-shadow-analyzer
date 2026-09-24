import { afterEach, describe, expect, it } from 'vitest';
import html from '../../index.html?raw';

// The inline script in index.html applies the stored theme before the first paint, including the browser
// chrome colour (<meta name="theme-color">), which useDocumentSettings later keeps in sync from --bg.

const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
/** --bg of the themes in src/styles/global.css (Vitest does not load CSS, so they are repeated here). */
const BG = { dark: '#0b1120', light: '#f3f5f9' };

const removeThemeColor = (): void =>
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());

/** Runs the pre-paint script with the given stored UI state; returns the theme-color meta content. */
function prepaint(stored: unknown): string | null {
  localStorage.setItem('ssa.ui', JSON.stringify(stored));
  removeThemeColor();
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = '#000000';
  document.head.append(meta);
  new Function(script)();
  return meta.getAttribute('content');
}

describe('index.html', () => {
  afterEach(() => {
    removeThemeColor();
    localStorage.clear();
  });

  it('pre-paint script: sets the theme and the browser chrome to that theme’s page background', () => {
    expect(prepaint({ state: { theme: 'light', lang: 'en' } })).toBe(BG.light);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(prepaint({ state: { theme: 'dark' } })).toBe(BG.dark);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    // The static default matches the default (dark) theme.
    expect(html).toContain(`<meta name="theme-color" content="${BG.dark}" />`);
  });

  it('has Open Graph title and description equal to the document’s', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const og = (p: string): string | null | undefined =>
      doc.querySelector(`meta[property="og:${p}"]`)?.getAttribute('content');
    expect(og('type')).toBe('website');
    expect(og('title')).toBe(doc.title);
    expect(og('description')).toBe(doc.querySelector('meta[name="description"]')?.getAttribute('content'));
  });
});
