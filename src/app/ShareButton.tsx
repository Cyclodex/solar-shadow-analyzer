import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { ShareIcon, CheckIcon } from '../components/icons';
import { useMessages, type Messages } from '../i18n';
import { shareUrl } from '../state/urlSync';
import styles from './ShareButton.module.css';

const de = {
  share: 'Teilen',
  shareLabel: 'Link zu dieser Konfiguration kopieren',
  copied: 'Link kopiert',
  manual: 'Kopieren nicht möglich – Link bitte manuell kopieren:',
  linkLabel: 'Link zu dieser Konfiguration',
  close: 'Schliessen',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    share: 'Share',
    shareLabel: 'Copy link to this configuration',
    copied: 'Link copied',
    manual: 'Copying failed – please copy the link manually:',
    linkLabel: 'Link to this configuration',
    close: 'Close',
  },
};

/** How long the "copied" confirmation stays visible. */
const COPIED_MS = 2500;

/** Copies the share link (#c=…) of the current config; shows the link for manual copying if the clipboard fails. */
export function ShareButton() {
  const t = useMessages(messages);
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (manualUrl) inputRef.current?.select();
  }, [manualUrl]);

  const onClick = async (): Promise<void> => {
    const url = shareUrl();
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(url);
      setManualUrl(null);
      setCopied(true);
    } catch {
      setManualUrl(url);
    }
  };

  return (
    <div className={styles.root}>
      <Button icon={copied ? <CheckIcon /> : <ShareIcon />} onClick={onClick} title={t.shareLabel}>
        <span className={styles.text}>{copied ? t.copied : t.share}</span>
      </Button>
      <span className="sr-only" role="status">
        {copied ? t.copied : ''}
      </span>
      {manualUrl && (
        <div className={styles.popover} role="dialog" aria-labelledby={`${inputId}-label`}>
          <label id={`${inputId}-label`} htmlFor={inputId} className={styles.label}>
            {t.manual}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            className={styles.input}
            readOnly
            value={manualUrl}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setManualUrl(null);
            }}
          />
          <Button size="sm" onClick={() => setManualUrl(null)}>
            {t.close}
          </Button>
        </div>
      )}
    </div>
  );
}
