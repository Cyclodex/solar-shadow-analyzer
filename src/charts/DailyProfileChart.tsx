import { ViewCard } from '../components/ViewCard';
import { Placeholder } from '../components/Placeholder';
import { useFormat, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useDailyProfile } from '../hooks/useModel';
import { useTimeStore } from '../state/timeStore';

const de = {
  title: 'Tagesverlauf',
  subtitle: (date: string) => `Leistung je Stockwerk am ${date} bei klarem Himmel`,
  detail: (peak: string) => `Höchste Leistung aller Stockwerke: ${peak}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Daily profile',
    subtitle: (date) => `Power per floor on ${date} under clear skies`,
    detail: (peak) => `Peak power of all floors: ${peak}`,
  },
};

/** Clear-sky AC power (and shade) per floor over the selected day (STUB). */
export function DailyProfileChart() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const date = useTimeStore((s) => s.date);
  const points = useDailyProfile();
  const peak = points.reduce(
    (m, p) =>
      Math.max(
        m,
        p.floorsW.reduce((a, b) => a + b, 0),
      ),
    0,
  );
  return (
    <ViewCard title={t.title} subtitle={t.subtitle(f.date(date))} exportName="tagesverlauf">
      <Placeholder detail={t.detail(f.unit(peak, 'W'))}>{c.inProgress}</Placeholder>
    </ViewCard>
  );
}
