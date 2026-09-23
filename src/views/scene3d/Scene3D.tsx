import { ViewCard } from '../../components/ViewCard';
import { Placeholder } from '../../components/Placeholder';
import { useFormat, useMessages, type Messages } from '../../i18n';
import { useCommon } from '../../i18n/common';
import { useInstant } from '../../hooks/useModel';

const de = {
  title: '3D-Ansicht',
  subtitle: 'Gebäude, Panels und Schattenwurf – mit der Maus drehen',
  detail: (alt: string, az: string) => `Sonne ${alt} hoch, Azimut ${az}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: '3D view',
    subtitle: 'Building, panels and shadows – drag to rotate',
    detail: (alt, az) => `Sun ${alt} high, azimuth ${az}`,
  },
};

/** Interactive three.js scene (lazy loaded via ./index.ts) (STUB). */
export default function Scene3D() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const { sun } = useInstant();
  return (
    <ViewCard title={t.title} subtitle={t.subtitle} exportName="3d-ansicht" minHeight={420}>
      <Placeholder detail={t.detail(f.deg(sun.altitude, 1), f.deg(sun.azimuth, 1))}>
        {c.inProgress}
      </Placeholder>
    </ViewCard>
  );
}
