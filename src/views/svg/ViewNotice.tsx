import type { ReactNode } from 'react';
import { AlertIcon, InfoIcon } from '../../components/icons';
import { useFloorPlacements, useLayout } from '../../hooks/useModel';
import { floorLabel, useFormat, useLang } from '../../i18n';
import { panelDepthBelowGround, panelsOverlap } from '../../model/geometry';
import { useViewText } from './messages';
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

/** Notices for physically impossible geometry the views still draw: overlapping rows, panels in the ground. */
export function GeometryNotices() {
  const vt = useViewText();
  const f = useFormat();
  const lang = useLang();
  const layout = useLayout();
  const placements = useFloorPlacements();
  const cm = (m: number): string => f.unit(m * 100, 'cm');
  const overlap = placements.length > 1 && panelsOverlap(layout);
  const depth = panelDepthBelowGround(layout, placements);
  return (
    <>
      {overlap && <ViewNotice>{vt.overlap(cm(layout.drop - layout.floorHeight))}</ViewNotice>}
      {depth >= 0.005 && (
        <ViewNotice>{vt.belowGround(cm(depth), floorLabel(placements[0].storey, lang))}</ViewNotice>
      )}
    </>
  );
}
