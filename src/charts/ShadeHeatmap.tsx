import { ViewCard } from '../components/ViewCard';
import { Placeholder } from '../components/Placeholder';
import { floorLabel, useFormat, useLang, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useFloorPlacements, useFocusFloor, useHeatmapStats } from '../hooks/useModel';
import { useConfig } from '../state/configStore';

const de = {
  title: 'Jahres-Heatmap Verschattung',
  subtitle: (floor: string, year: number) =>
    `Verschattung von ${floor} durch das obere Stockwerk, ${year}, Tag × Uhrzeit`,
  detail: (hours: string, pct: string) => `${hours} h verschattet (${pct} der besonnten Stunden)`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Annual shading heatmap',
    subtitle: (floor, year) => `Shading of ${floor} by the floor above, ${year}, day × time`,
    detail: (hours, pct) => `${hours} h shaded (${pct} of sunlit hours)`,
  },
};

/** Day × local time heatmap of the focus floor's shade (canvas), floor selectable (STUB). */
export function ShadeHeatmap() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const year = useConfig().weather.year;
  const focus = useFocusFloor();
  const placements = useFloorPlacements();
  const stats = useHeatmapStats();
  return (
    <ViewCard
      title={t.title}
      subtitle={t.subtitle(floorLabel(placements[focus]?.storey ?? focus, lang), year)}
      exportName="heatmap"
    >
      <Placeholder detail={t.detail(f.num(stats.shadedHours), f.pct(stats.shadedPct, 1))}>
        {c.inProgress}
      </Placeholder>
    </ViewCard>
  );
}
