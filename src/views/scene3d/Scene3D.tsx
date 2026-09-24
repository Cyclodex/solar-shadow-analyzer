import { lazy, Suspense, useState } from 'react';
import { Placeholder } from '../../components/Placeholder';
import { Spinner } from '../../components/Spinner';
import { ViewCard } from '../../components/ViewCard';
import { useFormat, useMessages } from '../../i18n';
import { useCommon } from '../../i18n/common';
import { instantParts } from '../../export/filenames';
import { useSelectedUtc } from '../../hooks/useModel';
import { useConfigSection } from '../../state/configStore';
import { useTimeStore } from '../../state/timeStore';
import { sceneMessages } from './messages';
import { isWebGL2Available } from './webgl';
import styles from './Scene3D.module.css';

/** three.js + R3F, loaded only when the browser can render them. */
const SceneView = lazy(() => import('./SceneView'));

/**
 * Interactive 3D view (lazy loaded via ./index.ts): building, balconies, panel rows, neighbour obstacles,
 * horizon silhouette, sun and sun path, with rendered shadows and the model's exact shade overlay.
 * Without WebGL 2 (e.g. jsdom) an accessible notice replaces the canvas and three.js is never loaded.
 */
export default function Scene3D() {
  const t = useMessages(sceneMessages);
  const c = useCommon();
  const f = useFormat();
  const [webgl] = useState(isWebGL2Available);
  const location = useConfigSection('location');
  const date = useTimeStore((s) => s.date);
  const minutes = useTimeStore((s) => s.minutes);
  const utc = useSelectedUtc();
  const when = `${f.date(date)}, ${f.time(Math.round(minutes))} ${f.tzName(location.timezone, utc)}`;

  return (
    <ViewCard
      title={t.title}
      // The drag hint only where there is something to drag.
      subtitle={webgl ? t.subtitle(when) : when}
      // PNG file name: site and instant, e.g. "shading-3d-view-Bern-2025-06-21-1230.png".
      exportKind={webgl ? 'scene3d' : undefined}
      exportParts={[location.name, ...instantParts(date, minutes)]}
      minHeight={320}
    >
      {webgl ? (
        <Suspense
          fallback={
            <div className={styles.loading}>
              <Spinner label={c.loading} showLabel />
            </div>
          }
        >
          <SceneView />
        </Suspense>
      ) : (
        <Placeholder detail={t.unavailableDetail}>{t.unavailable}</Placeholder>
      )}
    </ViewCard>
  );
}
