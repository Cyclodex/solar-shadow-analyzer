import { ViewCard } from '../components/ViewCard';
import { Placeholder } from '../components/Placeholder';
import { floorLabel, useFormat, useLang, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useFloorPlacements, useFocusFloor, useInstant } from '../hooks/useModel';

const de = {
  title: 'Panel-Schatten',
  subtitle: (floor: string) => `Schatten der oberen Panelreihe auf ${floor}`,
  detail: (pct: string) => `Verschattet: ${pct}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Panel shadow',
    subtitle: (floor) => `Shadow of the upper panel row on ${floor}`,
    detail: (pct) => `Shaded: ${pct}`,
  },
};

/** Panel plane of the focus floor with the exact shadow of the row above (STUB). */
export function PanelShadowView() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const focus = useFocusFloor();
  const placements = useFloorPlacements();
  const instant = useInstant();
  const shade = instant.floors[focus]?.shade.fraction ?? 0;
  return (
    <ViewCard
      title={t.title}
      subtitle={t.subtitle(floorLabel(placements[focus]?.storey ?? focus, lang))}
      exportName="panel-schatten"
      minHeight={320}
    >
      <Placeholder detail={t.detail(f.pct(shade * 100))}>{c.inProgress}</Placeholder>
    </ViewCard>
  );
}
