import { ViewCard } from '../components/ViewCard';
import { Placeholder } from '../components/Placeholder';
import { useFormat, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useSimulation } from '../hooks/useModel';

const de = {
  title: 'Monatsertrag',
  subtitle: 'Ertrag je Stockwerk und Monat inkl. Verschattungsverlust',
  detail: (kwh: string) => `Jahr: ${kwh}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Monthly yield',
    subtitle: 'Yield per floor and month incl. shading loss',
    detail: (kwh) => `Year: ${kwh}`,
  },
};

/** Grouped monthly bars per floor with the shading loss (STUB). */
export function MonthlyYieldChart() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const simulation = useSimulation();
  return (
    <ViewCard title={t.title} subtitle={t.subtitle} exportName="monatsertrag" busy={!simulation}>
      <Placeholder detail={simulation ? t.detail(f.kwh(simulation.totalAnnualKwh)) : c.loading}>
        {c.inProgress}
      </Placeholder>
    </ViewCard>
  );
}
