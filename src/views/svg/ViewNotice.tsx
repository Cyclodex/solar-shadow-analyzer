import type { ReactNode } from 'react';
import { AlertIcon, InfoIcon } from '../../components/icons';
import s from './svg.module.css';

/** Short notice above a view's drawing (e.g. physically overlapping panel rows). */
export function ViewNotice({ tone = 'bad', children }: { tone?: 'bad' | 'info'; children: ReactNode }) {
  return (
    <p className={`${s.notice} ${tone === 'bad' ? s.noticeBad : s.noticeInfo}`} role="note">
      <span className={s.noticeIcon} aria-hidden="true">
        {tone === 'bad' ? <AlertIcon /> : <InfoIcon />}
      </span>
      <span>{children}</span>
    </p>
  );
}
