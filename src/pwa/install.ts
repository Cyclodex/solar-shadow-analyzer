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
  /** The kept install event; null until the browser offers installation, and after it was used. */
  deferred: BeforeInstallPromptEvent | null;
  /** The app was installed from this page (`appinstalled`, or the install dialog was accepted). */
  installed: boolean;
}

export const INITIAL_INSTALL: InstallState = { deferred: null, installed: false };

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
 * Opens the browser's install dialog. An event can prompt only once, so it is dropped either way; the
 * browser fires a new one if installation is offered again later.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = useInstallStore.getState().deferred;
  if (!event) return 'unavailable';
  useInstallStore.setState({ deferred: null });
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') useInstallStore.setState({ installed: true });
    return outcome;
  } catch {
    return 'unavailable';
  }
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
