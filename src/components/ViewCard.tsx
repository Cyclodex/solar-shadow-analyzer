import { useId, useRef, useState, type ReactNode } from 'react';
import { exportViewPng } from '../export/png';
import { safeFilename } from '../export/download';
import { useCommon } from '../i18n/common';
import { useMessages, type Messages } from '../i18n';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { cssVars } from './cssVars';
import styles from './ViewCard.module.css';

export interface ViewCardProps {
  title: string;
  subtitle?: ReactNode;
  /** Extra controls in the header, before the PNG button (e.g. a floor selector). */
  toolbar?: ReactNode;
  /**
   * File name of the PNG export incl. ".png" (build it with useExportFilename, app/useExportFilename.ts:
   * localised, with location and year); omit (and exportName) to hide the PNG button.
   */
  exportFilename?: string;
  /** @deprecated Base file name (sanitised, ".png" appended); use exportFilename. */
  exportName?: string;
  /** Minimum height of the body in px (reserves space, avoids layout shifts). Default 240. */
  minHeight?: number;
  /** Shows a spinner overlay and sets aria-busy on the body. */
  busy?: boolean;
  /** Content below the body (legend, notes, data table toggle). */
  footer?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
}

const messages: Messages<{ exportFailed: string }> = {
  de: { exportFailed: 'Export fehlgeschlagen.' },
  en: { exportFailed: 'Export failed.' },
};

/**
 * Card for a view or chart: <section> labelled by its h3 title, optional subtitle, toolbar and PNG export
 * of the body (exportViewPng: first <canvas>, else largest <svg>).
 */
export function ViewCard({
  title,
  subtitle,
  toolbar,
  exportFilename,
  exportName,
  minHeight = 240,
  busy = false,
  footer,
  id,
  className,
  children,
}: ViewCardProps) {
  const c = useCommon();
  const t = useMessages(messages);
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(false);

  const filename = exportFilename ?? (exportName ? `${safeFilename(exportName)}.png` : undefined);

  const onExport = async (): Promise<void> => {
    if (!bodyRef.current || !filename) return;
    setExporting(true);
    setError(false);
    try {
      await exportViewPng(bodyRef.current, filename);
    } catch {
      setError(true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section id={id} className={[styles.card, className].filter(Boolean).join(' ')} aria-labelledby={titleId}>
      <div className={styles.header}>
        <div className={styles.titles}>
          <h3 id={titleId} className={styles.title}>
            {title}
          </h3>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {(toolbar || filename) && (
          <div className={styles.toolbar}>
            {toolbar}
            {filename && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onExport}
                disabled={exporting}
                aria-label={c.exportPngLabel(title)}
              >
                {c.exportPng}
              </Button>
            )}
          </div>
        )}
      </div>
      {error && (
        <p className={styles.error} role="status">
          {t.exportFailed}
        </p>
      )}
      <div
        ref={bodyRef}
        className={styles.body}
        style={cssVars({ '--min-h': `${minHeight}px` })}
        aria-busy={busy || undefined}
      >
        {children}
        {busy && (
          <div className={styles.busy}>
            <Spinner label={c.computing} />
          </div>
        )}
      </div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </section>
  );
}
