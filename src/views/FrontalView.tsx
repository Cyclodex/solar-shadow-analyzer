import { ViewCard } from '../components/ViewCard';
import { Placeholder } from '../components/Placeholder';
import { compassPoint, useFormat, useLang, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useFloorPlacements, useInstant } from '../hooks/useModel';
import { useConfig } from '../state/configStore';

const de = {
  title: 'Frontalansicht',
  subtitle: (az: string) => `Blick von aussen auf die Fassade (${az})`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Front view',
    subtitle: (az) => `Looking at the facade from outside (${az})`,
  },
};

/** Facade seen from outside with panel rows, sun position and shade (STUB). */
export function FrontalView() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const { facadeAzimuth } = useConfig().building;
  const placements = useFloorPlacements();
  const instant = useInstant();
  return (
    <ViewCard
      title={t.title}
      subtitle={t.subtitle(`${f.deg(facadeAzimuth)} ${compassPoint(facadeAzimuth, lang)}`)}
      exportName="frontalansicht"
      minHeight={320}
    >
      <Placeholder
        detail={`${c.floorsCount(placements.length)} · ${c.sunStates[instant.floors[0]?.state ?? 'night']}`}
      >
        {c.inProgress}
      </Placeholder>
    </ViewCard>
  );
}
