import { NumberField } from '../components/NumberField';
import { Section } from '../components/Section';
import { TextField } from '../components/TextField';
import { useFormat, useMessages, type Messages } from '../i18n';
import { LIMITS } from '../model/defaults';
import { MAX_CURRENCY_LENGTH } from '../model/share';
import { useConfigSection, usePatch } from '../state/configStore';

const de = {
  title: 'Wirtschaftlichkeit',
  currency: 'Währung',
  price: 'Strompreis (Bezug)',
  feedIn: 'Einspeisevergütung',
  selfConsumption: 'Eigenverbrauchsanteil',
  selfConsumptionHint: 'Anteil der Produktion, der selbst verbraucht wird',
  investment: 'Investition je Stockwerk',
  investmentHint: 'Module, Wechselrichter, Montage',
  degradation: 'Degradation',
  lifetime: 'Betrachtungsdauer',
  years: 'Jahre',
  perYear: '%/Jahr',
  empty: 'Bitte eine Währung angeben',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Economics',
    currency: 'Currency',
    price: 'Electricity price (purchase)',
    feedIn: 'Feed-in tariff',
    selfConsumption: 'Self-consumption share',
    selfConsumptionHint: 'Share of the production that is consumed on site',
    investment: 'Investment per floor',
    investmentHint: 'Modules, inverter, mounting',
    degradation: 'Degradation',
    lifetime: 'Evaluation period',
    years: 'years',
    perYear: '%/year',
    empty: 'Please enter a currency',
  },
};

/** Prices, self-consumption, investment. (Basic version.) */
export function EconomicsSection() {
  const t = useMessages(messages);
  const f = useFormat();
  const e = useConfigSection('economics');
  const patch = usePatch();
  const L = LIMITS.economics;
  const perKwh = `${e.currency}/kWh`;

  return (
    <Section id="economics" title={t.title} summary={`${f.currency(e.electricityPrice, e.currency)}/kWh`}>
      <TextField
        label={t.currency}
        value={e.currency}
        maxLength={MAX_CURRENCY_LENGTH}
        validate={(v) => (v ? null : t.empty)}
        onCommit={(currency) => patch('economics', { currency })}
      />
      <NumberField
        label={t.price}
        value={e.electricityPrice}
        onChange={(v) => patch('economics', { electricityPrice: v })}
        limit={L.electricityPrice}
        unit={perKwh}
        digits={4}
      />
      <NumberField
        label={t.feedIn}
        value={e.feedInTariff}
        onChange={(v) => patch('economics', { feedInTariff: v })}
        limit={L.feedInTariff}
        unit={perKwh}
        digits={4}
      />
      <NumberField
        label={t.selfConsumption}
        value={e.selfConsumptionPct}
        onChange={(v) => patch('economics', { selfConsumptionPct: v })}
        limit={L.selfConsumptionPct}
        unit="%"
        hint={t.selfConsumptionHint}
      />
      <NumberField
        label={t.investment}
        value={e.investmentPerFloor}
        onChange={(v) => patch('economics', { investmentPerFloor: v })}
        limit={L.investmentPerFloor}
        unit={e.currency}
        hint={t.investmentHint}
      />
      <NumberField
        label={t.degradation}
        value={e.degradationPct}
        onChange={(v) => patch('economics', { degradationPct: v })}
        limit={L.degradationPct}
        unit={t.perYear}
      />
      <NumberField
        label={t.lifetime}
        value={e.lifetimeYears}
        onChange={(v) => patch('economics', { lifetimeYears: v })}
        limit={L.lifetimeYears}
        unit={t.years}
      />
    </Section>
  );
}
