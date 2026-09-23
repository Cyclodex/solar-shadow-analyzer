import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useMessages, type Messages } from '../i18n';
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

/** Viewport margin kept free by the bubble, px. */
const EDGE = 8;

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

  // Keep the bubble inside the viewport horizontally.
  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!open || !el) return;
    el.style.setProperty('--shift', '0px');
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    let shift = 0;
    if (r.left < EDGE) shift = EDGE - r.left;
    else if (r.right > vw - EDGE) shift = vw - EDGE - r.right;
    el.style.setProperty('--shift', `${Math.round(shift)}px`);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

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
