import { ViewCard } from '../components/ViewCard';
import { Placeholder } from '../components/Placeholder';
import { useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useSimulation } from '../hooks/useModel';

const de = {
  title: 'Monatstabelle',
  subtitle: 'kWh je Stockwerk, Verschattungsverlust und verschattete Stunden – mit CSV-Export',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Monthly table',
    subtitle: 'kWh per floor, shading loss and shaded hours – with CSV export',
  },
};

/** Monthly numbers per floor as a table with CSV export (STUB). */
export function MonthlyTable() {
  const t = useMessages(messages);
  const c = useCommon();
  const simulation = useSimulation();
  return (
    <ViewCard title={t.title} subtitle={t.subtitle} minHeight={160} busy={!simulation}>
      <Placeholder>{c.inProgress}</Placeholder>
    </ViewCard>
  );
}
