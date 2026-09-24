import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { CheckIcon, ShareIcon } from '../components/icons';
import { useDismissOnOutsidePointer, useKeepInViewport } from '../components/usePopover';
import { displayLocationName, useFormat, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { copyText } from '../export/clipboard';
import { useConfigStore } from '../state/configStore';
import { shareUrl } from '../state/urlSync';
import styles from './ShareButton.module.css';

const de = {
  share: 'Teilen',
  copyLabel: 'Link zu dieser Konfiguration kopieren',
  shareLabel: 'Link zu dieser Konfiguration teilen',
  copied: 'Link kopiert',
  manual: 'Kopieren nicht möglich – bitte den Link manuell kopieren:',
  shareText: (name: string) => `Verschattungsanalyse für Balkon-Solarpanels – ${name}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    share: 'Share',
    copyLabel: 'Copy link to this configuration',
    shareLabel: 'Share link to this configuration',
    copied: 'Link copied',
    manual: 'Copying failed – please copy the link manually:',
    shareText: (name) => `Shading analysis for balcony solar panels – ${name}`,
  },
};

/** How long the "copied" confirmation stays visible. */
const COPIED_MS = 2500;

/**
 * Native share sheet on touch devices (phones, tablets); desktop browsers copy the link instead,
 * which is what a "share" button is expected to do there.
 */
function nativeShareAvailable(data: ShareData): boolean {
  if (typeof navigator.share !== 'function') return false;
  if (!globalThis.matchMedia?.('(pointer: coarse)').matches) return false;
  try {
    return navigator.canShare ? navigator.canShare(data) : true;
  } catch {
    return false;
  }
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

/**
 * Share link (#c=… of the current config, model/share buildShareUrl via state/urlSync). Touch devices
 * open the native share sheet; otherwise the link is copied (Clipboard API, legacy fallback) with a
 * "Link kopiert" confirmation. If copying is impossible, the link is shown in a field to copy by hand.
 */
export function ShareButton() {
  const t = useMessages(messages);
  const f = useFormat();
  const c = useCommon();
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const closeManual = (focusButton: boolean): void => {
    setManualUrl(null);
    if (focusButton) buttonRef.current?.focus();
  };

  // Manual-copy popover: select the link, keep the popover inside the viewport, close on outside clicks.
  useLayoutEffect(() => {
    if (manualUrl) inputRef.current?.select();
  }, [manualUrl]);
  useKeepInViewport(popoverRef, manualUrl !== null);
  useDismissOnOutsidePointer(rootRef, manualUrl !== null, () => closeManual(false));

  const onClick = async (): Promise<void> => {
    const url = shareUrl();
    const data: ShareData = {
      title: document.title,
      text: t.shareText(displayLocationName(useConfigStore.getState().config.location, f)),
      url,
    };
    if (nativeShareAvailable(data)) {
      try {
        await navigator.share(data);
        return;
      } catch (e) {
        if (isAbort(e)) return; // the user closed the share sheet
        // other failures: fall back to copying
      }
    }
    if (await copyText(url)) {
      setManualUrl(null);
      setCopied(true);
    } else {
      setCopied(false);
      setManualUrl(url);
    }
  };

  const touchShare =
    typeof navigator.share === 'function' && globalThis.matchMedia?.('(pointer: coarse)').matches;

  return (
    <div ref={rootRef} className={styles.root}>
      <Button
        ref={buttonRef}
        icon={copied ? <CheckIcon /> : <ShareIcon />}
        onClick={() => void onClick()}
        title={touchShare ? t.shareLabel : t.copyLabel}
        data-state={copied ? 'copied' : undefined}
        className={styles.button}
      >
        <span className="sr-only-narrow">{copied ? t.copied : t.share}</span>
      </Button>
      <span className="sr-only" role="status">
        {copied ? t.copied : ''}
      </span>
      {manualUrl && (
        <div
          ref={popoverRef}
          className={styles.popover}
          role="dialog"
          aria-labelledby={`${inputId}-label`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              closeManual(true);
            }
          }}
        >
          <label id={`${inputId}-label`} htmlFor={inputId} className={styles.label}>
            {t.manual}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            className={styles.input}
            readOnly
            value={manualUrl}
            aria-describedby={`${inputId}-label`}
            onFocus={(e) => e.target.select()}
          />
          <Button size="sm" onClick={() => closeManual(true)}>
            {c.close}
          </Button>
        </div>
      )}
    </div>
  );
}
