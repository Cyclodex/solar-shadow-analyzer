import { ViewCard } from '../components/ViewCard';
import { Placeholder } from '../components/Placeholder';
import { useFormat, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useSolarPath, useSunTimes } from '../hooks/useModel';

const de = {
  title: 'Sonnenbahn',
  subtitle: 'Sonnenstand im Tagesverlauf relativ zur Fassade',
  detail: (max: string) => `Höchster Sonnenstand ${max}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Sun path',
    subtitle: 'Sun position over the day relative to the facade',
    detail: (max) => `Maximum sun altitude ${max}`,
  },
};

/** Sun path of the selected day (and horizon) relative to the facade (STUB). */
export function SunPathView() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const path = useSolarPath();
  const times = useSunTimes();
  const maxAlt = path.reduce((m, p) => Math.max(m, p.sun.altitude), -90);
  return (
    <ViewCard title={t.title} subtitle={t.subtitle} exportName="sonnenbahn" minHeight={320}>
      <Placeholder detail={`${t.detail(f.deg(maxAlt, 1))} · ${c.solarNoon} ${f.time(times.solarNoon)}`}>
        {c.inProgress}
      </Placeholder>
    </ViewCard>
  );
}
