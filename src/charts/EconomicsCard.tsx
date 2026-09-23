import { ViewCard } from '../components/ViewCard';
import { Placeholder } from '../components/Placeholder';
import { useFormat, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useEconomics } from '../hooks/useModel';
import { useConfig } from '../state/configStore';

const de = {
  title: 'Wirtschaftlichkeit',
  subtitle: 'Ersparnis, Amortisation und Bilanz über die Betrachtungsdauer',
  detail: (net: string) => `Bilanz über die Betrachtungsdauer: ${net}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Economics',
    subtitle: 'Savings, payback and balance over the evaluation period',
    detail: (net) => `Balance over the evaluation period: ${net}`,
  },
};

/** Savings, payback and cumulative cash flow (STUB). */
export function EconomicsCard() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const econ = useEconomics();
  const currency = useConfig().economics.currency;
  return (
    <ViewCard title={t.title} subtitle={t.subtitle} minHeight={160} busy={!econ}>
      <Placeholder detail={econ ? t.detail(f.currency(econ.lifetimeNet, currency, 0)) : c.loading}>
        {c.inProgress}
      </Placeholder>
    </ViewCard>
  );
}
