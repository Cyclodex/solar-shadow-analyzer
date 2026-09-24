import { useEffect } from 'react';
import { useLang } from '../i18n';
import { useCommon } from '../i18n/common';
import { useUiStore } from '../state/uiStore';

/**
 * Mirrors UI state onto the document: <html data-theme> (CSS tokens), <html lang>, the document title
 * and <meta name="theme-color"> (browser chrome follows the in-app theme, not only the OS setting).
 */
export function useDocumentSettings(): void {
  const theme = useUiStore((s) => s.theme);
  const lang = useLang();
  const { appTitle, appSubtitle } = useCommon();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (bg) {
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${appTitle} · ${appSubtitle}`;
  }, [lang, appTitle, appSubtitle]);
}
