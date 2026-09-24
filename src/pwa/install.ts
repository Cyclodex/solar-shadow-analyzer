import { create } from 'zustand';

// ─────────────────────────────────────────────
// APP INSTALLATION
// Chromium browsers (Chrome, Edge, Samsung Internet; desktop and Android) fire `beforeinstallprompt` once
// the app is installable: initInstallPrompt() keeps the event, so the header button can open the
// browser's install dialog later (promptInstall). `appinstalled` hides the button. iOS/iPadOS has no such
// event: there the button explains "Teilen → Zu Home-Bildschirm hinzufügen" (InstallButton). Other browsers
// (Firefox, Safari on macOS) get no button.
// ─────────────────────────────────────────────

/** Chromium's install event (not in lib.dom). */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

interface InstallState {
  /**
   * The kept install event; null until the browser offers installation, and after it was used (kept while
   * its dialog is open, so that the button that opened it stays in place).
   */
  deferred: BeforeInstallPromptEvent | null;
  /** The browser's install dialog is open. */
  prompting: boolean;
  /**
   * The app was installed from this page (`appinstalled`, or the install dialog was accepted): no button,
   * even if the browser fires `beforeinstallprompt` again.
   */
  installed: boolean;
}

export const INITIAL_INSTALL: InstallState = { deferred: null, prompting: false, installed: false };

export const useInstallStore = create<InstallState>(() => INITIAL_INSTALL);

/**
 * Call once at start-up (before the first render: the event may come early). Returns a cleanup
 * function (tests).
 */
export function initInstallPrompt(target: Window = window): () => void {
  const onBeforeInstallPrompt = (e: Event): void => {
    // No mini-infobar on Android: the header button offers installation instead.
    e.preventDefault();
    useInstallStore.setState({ deferred: e as BeforeInstallPromptEvent });
  };
  const onAppInstalled = (): void => useInstallStore.setState({ deferred: null, installed: true });
  target.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  target.addEventListener('appinstalled', onAppInstalled);
  return () => {
    target.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    target.removeEventListener('appinstalled', onAppInstalled);
  };
}

/**
 * Opens the browser's install dialog (once at a time). An event can prompt only once, so it is dropped
 * when the dialog closes, whatever the outcome; the browser fires a new one if installation is offered
 * again later (possibly while the dialog is still closing: that one is kept).
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const { deferred: event, prompting } = useInstallStore.getState();
  if (!event || prompting) return 'unavailable';
  useInstallStore.setState({ prompting: true });
  let outcome: 'accepted' | 'dismissed' | 'unavailable' = 'unavailable';
  try {
    await event.prompt();
    outcome = (await event.userChoice).outcome;
  } catch {
    // The event was used already, or the browser refused to show the dialog.
  }
  useInstallStore.setState((s) => ({
    deferred: s.deferred === event ? null : s.deferred,
    prompting: false,
    installed: s.installed || outcome === 'accepted',
  }));
  return outcome;
}

/** iPhone, iPod or iPad, including iPadOS, whose Safari reports a Mac (touch points tell them apart). */
export function isIos(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): boolean {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  return /Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1;
}

/** Media query of a page that runs as an installed app. */
export const STANDALONE_QUERY = '(display-mode: standalone)';

/** Whether the page runs as an installed app (iOS home screen apps set navigator.standalone). */
export function isStandaloneNavigator(nav: Navigator = navigator): boolean {
  return (nav as Navigator & { standalone?: boolean }).standalone === true;
}
