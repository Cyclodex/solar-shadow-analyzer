import { useId, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { InstallIcon, ShareIosIcon } from '../components/icons';
import { useDismissOnOutsidePointer, useKeepInViewport } from '../components/usePopover';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { STANDALONE_QUERY, isIos, isStandaloneNavigator, promptInstall, useInstallStore } from './install';
import styles from './InstallButton.module.css';

const de = {
  install: 'Installieren',
  installTitle: 'Als App auf diesem Gerät installieren',
  iosTitle: 'Als App auf den Home-Bildschirm',
  iosButtonTitle: 'Anleitung: als App auf den Home-Bildschirm',
  // Labels as in Apple's iPhone guide (de-de, iOS 26 and 27): «Zu Home-Bildschirm hinzufügen», «Als Web-App
  // öffnen», «Hinzufügen».
  steps: [
    '«Teilen» antippen (bei neueren iOS-Versionen zuerst «…» neben der Adresszeile, dann «Teilen»).',
    '«Zu Home-Bildschirm hinzufügen» wählen, falls nötig weiter unten in der Liste.',
    '«Als Web-App öffnen» einschalten, falls angezeigt, und mit «Hinzufügen» bestätigen.',
  ],
  note: 'Die App startet dann vom Home-Bildschirm, nach dem ersten Besuch auch ohne Internet.',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    install: 'Install',
    installTitle: 'Install as an app on this device',
    iosTitle: 'Add the app to the Home Screen',
    iosButtonTitle: 'How to add the app to the Home Screen',
    steps: [
      'Tap “Share” (on newer iOS versions first “…” next to the address bar, then “Share”).',
      'Choose “Add to Home Screen”, further down the list if needed.',
      'Turn on “Open as Web App” if shown, then confirm with “Add”.',
    ],
    note: 'The app then starts from the Home Screen, after the first visit also without internet.',
  },
};

type InstallMode = 'hidden' | 'prompt' | 'ios';

/** Controls that take keyboard focus (not hidden, disabled or skipped by Tab). */
const FOCUSABLE = ['button', '[href]', 'input', 'select', 'textarea', '[tabindex]']
  .map((s) => `${s}:not([disabled]):not([hidden]):not([tabindex="-1"]):not([type="hidden"])`)
  .join(', ');

/**
 * Ref callback of the install button: if it disappears while it has focus (the app was installed, or the
 * used install event was dropped), focus moves to the nearest control before it in the header (else
 * after it) instead of falling back to <body>. React runs the ref cleanup before it removes the element.
 */
function keepFocusNearby(button: HTMLButtonElement | null): (() => void) | undefined {
  if (!button) return undefined;
  return () => {
    const container = button.parentElement;
    if (document.activeElement !== button || !container) return;
    const others = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el !== button && !el.closest('[hidden], [inert]'),
    );
    const before = others.filter(
      (el) => el.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const after = others.filter((el) => !before.includes(el));
    // The first one that actually takes focus (not e.g. invisible).
    for (const el of [...before.reverse(), ...after]) {
      el.focus();
      if (document.activeElement === el) return;
    }
  };
}

/**
 * What the device offers: the browser's install dialog (Chromium, after `beforeinstallprompt`), the
 * manual way on iOS/iPadOS, or nothing (already installed, running as the app, or a browser that
 * cannot install).
 */
function useInstallMode(): InstallMode {
  const deferred = useInstallStore((s) => s.deferred);
  const installed = useInstallStore((s) => s.installed);
  const standalone = useMediaQuery(STANDALONE_QUERY);
  if (installed || standalone || isStandaloneNavigator()) return 'hidden';
  if (deferred) return 'prompt';
  return isIos() ? 'ios' : 'hidden';
}

/**
 * Header button "Installieren": opens the browser's install dialog, or on iOS/iPadOS (no install API)
 * a popover with the steps "Teilen → Zu Home-Bildschirm hinzufügen". Hidden when the app cannot be installed or
 * already runs installed.
 */
export function InstallButton() {
  const t = useMessages(messages);
  const c = useCommon();
  const mode = useInstallMode();
  const prompting = useInstallStore((s) => s.prompting);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const showSteps = mode === 'ios' && open;

  useKeepInViewport(popoverRef, showSteps);
  useDismissOnOutsidePointer(rootRef, showSteps, () => setOpen(false));

  if (mode === 'hidden') return null;

  const close = (focusButton: boolean): void => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  if (mode === 'prompt') {
    return (
      <Button
        ref={keepFocusNearby}
        icon={<InstallIcon />}
        title={t.installTitle}
        // Stays in place (with focus) while the browser's dialog is open; a second press does nothing.
        aria-disabled={prompting || undefined}
        onClick={() => void promptInstall()}
      >
        <span className="sr-only-narrow">{t.install}</span>
      </Button>
    );
  }

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close(true);
        }
      }}
    >
      <Button
        ref={buttonRef}
        icon={<InstallIcon />}
        title={t.iosButtonTitle}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sr-only-narrow">{t.install}</span>
      </Button>
      {showSteps && (
        <div
          ref={popoverRef}
          id={popoverId}
          className={styles.popover}
          role="group"
          aria-labelledby={`${popoverId}-title`}
        >
          <p id={`${popoverId}-title`} className={styles.title}>
            {t.iosTitle}
          </p>
          <ol className={styles.steps}>
            {t.steps.map((step, i) => (
              <li key={i}>
                {i === 0 && <ShareIosIcon className={styles.shareIcon} />}
                {step}
              </li>
            ))}
          </ol>
          <p className={styles.note}>{t.note}</p>
          <Button size="sm" className={styles.close} onClick={() => close(true)}>
            {c.close}
          </Button>
        </div>
      )}
    </div>
  );
}
