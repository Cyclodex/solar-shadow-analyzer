import { useId, useRef, useState, type ReactNode } from 'react';
import { useMessages, type Messages } from '../i18n';
import { useDismissOnOutsidePointer, useKeepInViewport } from './usePopover';
import styles from './InfoTip.module.css';

export interface InfoTipProps {
  /** What the tip explains; the button's accessible name becomes "Info: <label>". */
  label: string;
  /** Tip content (short text). */
  children: ReactNode;
  className?: string;
}

const messages: Messages<{ info: (label: string) => string }> = {
  de: { info: (label) => `Info: ${label}` },
  en: { info: (label) => `Info: ${label}` },
};

/**
 * Small "i" button that toggles an explanation bubble (click / Enter / Space; Escape, outside click
 * or moving focus away closes it). The bubble is linked with aria-controls/aria-expanded.
 */
export function InfoTip({ label, children, className }: InfoTipProps) {
  const t = useMessages(messages);
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  useKeepInViewport(bubbleRef, open);
  useDismissOnOutsidePointer(rootRef, open, () => setOpen(false));

  return (
    <span
      ref={rootRef}
      className={[styles.root, className].filter(Boolean).join(' ')}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">i</span>
        <span className="sr-only">{t.info(label)}</span>
      </button>
      <span ref={bubbleRef} id={id} className={styles.bubble} hidden={!open} role="note">
        {children}
      </span>
    </span>
  );
}
