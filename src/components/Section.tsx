import { useId, type ReactNode } from 'react';
import { useUiStore, type SectionId } from '../state/uiStore';
import styles from './Section.module.css';

export interface SectionProps {
  /** Key in uiStore.openSections (persisted open state). */
  id: SectionId;
  title: string;
  /** Short summary of the current values, shown next to the title (e.g. "47.1° N · 202°"). */
  summary?: ReactNode;
  /** Decorative icon before the title. */
  icon?: ReactNode;
  /** Open state when nothing is stored yet. Default false. */
  defaultOpen?: boolean;
  /** Heading level of the title. Default 2. */
  level?: 2 | 3;
  children: ReactNode;
  className?: string;
}

/**
 * Collapsible sidebar section: heading containing a button (aria-expanded, aria-controls). The content is
 * only rendered while open (keeps closed sections cheap).
 */
export function Section({
  id,
  title,
  summary,
  icon,
  defaultOpen = false,
  level = 2,
  children,
  className,
}: SectionProps) {
  const open = useUiStore((s) => s.openSections[id] ?? defaultOpen);
  const setSectionOpen = useUiStore((s) => s.setSectionOpen);
  const contentId = useId();
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section className={[styles.section, className].filter(Boolean).join(' ')} data-open={open || undefined}>
      <Heading className={styles.heading}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setSectionOpen(id, !open)}
        >
          {icon && (
            <span className={styles.icon} aria-hidden="true">
              {icon}
            </span>
          )}
          <span className={styles.title}>{title}</span>
          {summary && <span className={styles.summary}>{summary}</span>}
          <span className={styles.chevron} aria-hidden="true" />
        </button>
      </Heading>
      <div id={contentId} className={styles.content} hidden={!open}>
        {open && children}
      </div>
    </section>
  );
}
