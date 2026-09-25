import { useMemo } from 'react';
import { Button } from '../components/Button';
import { ResetIcon } from '../components/icons';
import { NumberField } from '../components/NumberField';
import { Section } from '../components/Section';
import { SelectField, type SelectOption } from '../components/SelectField';
import { useFormat, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { DEFAULT_CONFIG, LIMITS } from '../model/defaults';
import { batteryInvestments, economics } from '../model/economics';
import { useConfigSection, usePatch } from '../state/configStore';
import sections from './sections.module.css';

/** Currencies offered in the select (a config may still carry another label, e.g. from an import). */
const CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP'] as const;

const de = {
  title: 'Wirtschaftlichkeit',
  examples: 'Beispielwerte – bitte an den eigenen Stromtarif und die Offerte anpassen.',
  currency: 'Währung',
  otherCurrency: (label: string) => `${label} (eigene Angabe)`,
  price: 'Strompreis (Bezug)',
  priceHint: 'Was eine selbst verbrauchte kWh einspart',
  feedIn: 'Einspeisevergütung',
  feedInHint: 'Vergütung für ins Netz eingespeiste kWh',
  selfConsumption: 'Eigenverbrauchsanteil',
  selfConsumptionHint: (value: string) =>
    `Anteil der Produktion, der selbst verbraucht wird. Wert einer erzeugten kWh: ${value}`,
  investment: 'Investition je Stockwerk',
  investmentHint: (total: string, floors: string) =>
    `Module, Wechselrichter, Montage · total ${total} für ${floors}`,
  degradation: 'Degradation',
  degradationHint: 'Jährliche Abnahme der Modulleistung',
  lifetime: 'Betrachtungsdauer',
  years: 'Jahre',
  perYear: '%/Jahr',
  restore: 'Beispielwerte wiederherstellen',
  batteryInvestment: 'Investition Batteriespeicher',
  batteryInvestmentHint:
    'Beispielwert: 2 × EcoFlow STREAM Ultra X à CHF 1’499 (Händler ch.ecoflow.com, 24.09.2026).',
  replaced: 'Davon ersetzt der Speicher',
  replacedHint:
    'Teil der Investition je Stockwerk, der mit dem Speicher wegfällt, z. B. die Mikro-Wechselrichter (der Speicher hat einen eigenen). Total für alle Stockwerke.',
  investmentHintBattery: (total: string, floors: string) =>
    `Module, Wechselrichter, Montage · total ${total} für ${floors} (Variante ohne Batterie)`,
  comparison: (without: string, replaced: string, storage: string, withBattery: string) =>
    `Ohne Batterie ${without} · mit Batterie ${without} − ${replaced} + ${storage} = ${withBattery}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Economics',
    examples: 'Example values – please adjust them to your electricity tariff and quote.',
    currency: 'Currency',
    otherCurrency: (label) => `${label} (custom)`,
    price: 'Electricity price (purchase)',
    priceHint: 'What a self-consumed kWh saves',
    feedIn: 'Feed-in tariff',
    feedInHint: 'Paid for each kWh fed into the grid',
    selfConsumption: 'Self-consumption share',
    selfConsumptionHint: (value) =>
      `Share of the production consumed on site. Value of a generated kWh: ${value}`,
    investment: 'Investment per floor',
    investmentHint: (total, floors) => `Modules, inverter, mounting · total ${total} for ${floors}`,
    degradation: 'Degradation',
    degradationHint: 'Annual decrease of the module output',
    lifetime: 'Evaluation period',
    years: 'years',
    perYear: '%/year',
    restore: 'Restore example values',
    batteryInvestment: 'Battery storage investment',
    batteryInvestmentHint:
      'Example value: 2 × EcoFlow STREAM Ultra X at CHF 1,499 (retailer ch.ecoflow.com, 24 Sep 2026).',
    replaced: 'Of which the storage replaces',
    replacedHint:
      'Part of the investment per floor that is no longer needed with the storage, e.g. the micro-inverters (the storage has its own). Total for all floors.',
    investmentHintBattery: (total, floors) =>
      `Modules, inverter, mounting · total ${total} for ${floors} (variant without battery)`,
    comparison: (without, replaced, storage, withBattery) =>
      `Without battery ${without} · with battery ${without} − ${replaced} + ${storage} = ${withBattery}`,
  },
};

/** Localised currency name ("CHF – Schweizer Franken"); the code alone if Intl does not know it. */
function currencyLabel(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'currency' }).of(code);
    return name && name !== code ? `${code} – ${name}` : code;
  } catch {
    return code;
  }
}

/** Prices, self-consumption, investment, degradation and evaluation period (all example values). */
export function EconomicsSection() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const e = useConfigSection('economics');
  const numFloors = useConfigSection('building').numFloors;
  const battery = useConfigSection('battery');
  const LB = LIMITS.battery;
  const split = batteryInvestments(e, battery, numFloors);
  const money = (v: number): string => f.currency(v, e.currency, 0);
  const patch = usePatch();
  const L = LIMITS.economics;
  const perKwh = `${e.currency}/kWh`;

  const currencyOptions = useMemo((): SelectOption<string>[] => {
    const options: SelectOption<string>[] = CURRENCIES.map((code) => ({
      value: code,
      label: currencyLabel(code, f.locale),
    }));
    if (!(CURRENCIES as readonly string[]).includes(e.currency)) {
      options.push({ value: e.currency, label: t.otherCurrency(e.currency) });
    }
    return options;
  }, [f.locale, e.currency, t]);

  // Derived values from the model: value of one generated kWh and the total investment.
  const kwhValue = economics(1, 0, e).annualSavings;
  const totalInvestment = economics(0, numFloors, e).investment;
  const isDefault = JSON.stringify(e) === JSON.stringify(DEFAULT_CONFIG.economics);

  return (
    <Section
      level={3}
      id="economics"
      title={t.title}
      summary={`${f.currency(e.electricityPrice, e.currency)}/kWh`}
    >
      <p className={sections.hint}>{t.examples}</p>
      <SelectField
        label={t.currency}
        value={e.currency}
        options={currencyOptions}
        onChange={(currency) => patch('economics', { currency })}
      />
      <NumberField
        label={t.price}
        value={e.electricityPrice}
        onChange={(v) => patch('economics', { electricityPrice: v })}
        limit={L.electricityPrice}
        sliderMax={1}
        unit={perKwh}
        digits={4}
        hint={t.priceHint}
      />
      <NumberField
        label={t.feedIn}
        value={e.feedInTariff}
        onChange={(v) => patch('economics', { feedInTariff: v })}
        limit={L.feedInTariff}
        sliderMax={0.5}
        unit={perKwh}
        digits={4}
        hint={t.feedInHint}
      />
      <NumberField
        label={t.selfConsumption}
        value={e.selfConsumptionPct}
        onChange={(v) => patch('economics', { selfConsumptionPct: v })}
        limit={L.selfConsumptionPct}
        unit="%"
        hint={t.selfConsumptionHint(`${f.currency(kwhValue, e.currency, 3)}`)}
      />
      <NumberField
        label={t.investment}
        value={e.investmentPerFloor}
        onChange={(v) => patch('economics', { investmentPerFloor: v })}
        limit={L.investmentPerFloor}
        sliderMax={5000}
        unit={e.currency}
        hint={(battery.enabled ? t.investmentHintBattery : t.investmentHint)(
          f.currency(totalInvestment, e.currency, 0),
          c.floorsCount(numFloors),
        )}
      />
      {battery.enabled && (
        <>
          <NumberField
            label={t.batteryInvestment}
            value={battery.investment}
            onChange={(investment) => patch('battery', { investment })}
            limit={LB.investment}
            sliderMax={10000}
            unit={e.currency}
            hint={t.batteryInvestmentHint}
          />
          <NumberField
            label={t.replaced}
            value={battery.replacedInvestment}
            onChange={(replacedInvestment) => patch('battery', { replacedInvestment })}
            limit={LB.replacedInvestment}
            max={Math.max(LB.replacedInvestment.min, split.without)}
            sliderMax={Math.max(10, split.without)}
            unit={e.currency}
            hint={t.replacedHint}
          />
          <p className={sections.hint}>
            {t.comparison(
              money(split.without),
              money(split.replaced),
              money(battery.investment),
              money(split.with),
            )}
          </p>
        </>
      )}
      <NumberField
        label={t.degradation}
        value={e.degradationPct}
        onChange={(v) => patch('economics', { degradationPct: v })}
        limit={L.degradationPct}
        unit={t.perYear}
        hint={t.degradationHint}
      />
      <NumberField
        label={t.lifetime}
        value={e.lifetimeYears}
        onChange={(v) => patch('economics', { lifetimeYears: v })}
        limit={L.lifetimeYears}
        unit={t.years}
      />
      <div className={sections.actions}>
        <Button
          size="sm"
          variant="ghost"
          icon={<ResetIcon />}
          disabled={isDefault}
          onClick={() => patch('economics', DEFAULT_CONFIG.economics)}
        >
          {t.restore}
        </Button>
      </div>
    </Section>
  );
}
