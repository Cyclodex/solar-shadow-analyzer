import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '../components/Button';
import { useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { RELOAD_FALLBACK_MS, reloadPage, scheduleUpdateChecks } from './updates';
import styles from './PwaToast.module.css';

const de = {
  update: 'Neue Version verfügbar.',
  reload: 'Neu laden',
  later: 'Später',
  offline: 'Offline verfügbar: Die App startet jetzt auch ohne Internet.',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    update: 'New version available.',
    reload: 'Reload',
    later: 'Later',
    offline: 'Available offline: the app now starts without internet, too.',
  },
};

/** How long the "Offline verfügbar" notice stays (longer while it has focus). */
export const OFFLINE_NOTICE_MS = 8000;

/**
 * Registers the service worker (vite-plugin-pwa, registerType 'prompt'; production builds only) and
 * shows its notices bottom right, in a live region:
 * - "Neue Version verfügbar" once an update is installed: "Neu laden" activates it and reloads the page,
 *   "Später" keeps the running version (the update takes over when all app windows are closed; until
 *   then every start asks again).
 * - "Offline verfügbar" once the first visit has cached the app; hides itself after OFFLINE_NOTICE_MS.
 * Looks for updates hourly and when the app returns to the foreground (scheduleUpdateChecks).
 */
export function PwaToast() {
  const t = useMessages(messages);
  const c = useCommon();
  const toastRef = useRef<HTMLDivElement>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, registration) => {
      if (registration) scheduleUpdateChecks(registration);
    },
    onRegisterError: (error: unknown) => console.warn('Service worker registration failed:', error),
  });
  const showOffline = offlineReady && !needRefresh;

  const reload = (): void => {
    void updateServiceWorker(true);
    // The page reloads as soon as the new version controls it. A page the previous version did not
    // control yet (first visit, no reload since) gets no such signal: reload after a moment in any case.
    setTimeout(reloadPage, RELOAD_FALLBACK_MS);
  };

  useEffect(() => {
    if (!showOffline) return;
    const hide = (): void => {
      if (toastRef.current?.contains(document.activeElement)) timer = setTimeout(hide, OFFLINE_NOTICE_MS);
      else setOfflineReady(false);
    };
    let timer = setTimeout(hide, OFFLINE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [showOffline, setOfflineReady]);

  return (
    <div className={styles.region} role="status" data-print="hide">
      {needRefresh && (
        <div ref={toastRef} className={styles.toast}>
          <p className={styles.text}>{t.update}</p>
          <div className={styles.actions}>
            <Button size="sm" variant="primary" onClick={reload}>
              {t.reload}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
              {t.later}
            </Button>
          </div>
        </div>
      )}
      {showOffline && (
        <div ref={toastRef} className={styles.toast}>
          <p className={styles.text}>{t.offline}</p>
          <div className={styles.actions}>
            <Button size="sm" variant="ghost" onClick={() => setOfflineReady(false)}>
              {c.close}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
