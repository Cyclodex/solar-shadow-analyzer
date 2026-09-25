import { useMemo } from 'react';
import { Button } from '../components/Button';
import { ResetIcon } from '../components/icons';
import { NumberField } from '../components/NumberField';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { SelectField, type SelectOption } from '../components/SelectField';
import { Toggle } from '../components/Toggle';
import { useFormat, useMessages, type Messages } from '../i18n';
import {
  BATTERY_PRESETS,
  CUSTOM_BATTERY_PRESET,
  applyBatteryPreset,
  batteryPreset,
  matchesBatteryPreset,
  type BatteryPresetValues,
} from '../model/batteryPresets';
import { DEFAULT_CONFIG, LIMITS } from '../model/defaults';
import type { BatteryConfig, BatteryLayout, BatteryStrategy, LoadProfileKind } from '../model/types';
import { useConfigSection, usePatch } from '../state/configStore';
import sections from './sections.module.css';

const de = {
  title: 'Batterie',
  enabled: 'Batteriespeicher berechnen',
  enabledHint:
    'Balkonspeicher mit eigenem Solareingang (MPPT) und Wechselrichter, z. B. EcoFlow STREAM: Die Panels laden die Batterie mit voller Leistung, abgegeben wird höchstens die AC-Grenze.',
  off: 'aus',
  device: 'Gerät',
  custom: 'Eigene Werte',
  source: 'Herstellerangaben',
  edited: 'Werte angepasst – gilt als «Eigene Werte».',
  assumed: (fields: string) => `Ohne Herstellerangabe, angenommen: ${fields}.`,
  units: 'Anzahl Einheiten',
  unitsHint: (total: string, max: number | null) =>
    `Speicher total ${total}${max ? ` · höchstens ${max} laut Hersteller` : ''}`,
  layout: 'Aufbau',
  shared: 'Ein System',
  perFloor: 'Je Stockwerk',
  sharedHint: 'Alle Stockwerke laden einen gemeinsamen Speicher; die AC-Grenze gilt für alle zusammen.',
  perFloorHint: 'Jedes Stockwerk hat ein eigenes System mit Speicher und AC-Grenze.',
  capacity: 'Nutzbare Kapazität je Einheit',
  pvInput: 'Max. PV-Eingang je System',
  pvInputInfo: 'Summe der MPPT-Eingänge. Solarleistung darüber geht verloren.',
  charge: 'Max. Ladeleistung je System',
  discharge: 'Max. Entladeleistung je System',
  acLimit: 'AC-Ausgangsgrenze je System',
  acLimitShared: 'AC-Ausgangsgrenze (gesamt)',
  acLimitHint:
    'Schweiz: Steckersolar höchstens 600 W pro Haushalt (ESTI, EnergieSchweiz); EU: 800 VA. Gilt für die Batterie-Ergebnisse; der Jahresertrag rechnet weiter mit der Wechselrichter-Grenze unter «System».',
  strategy: 'Betriebsart',
  surplus: 'Nur Überschuss speichern',
  baseLoad: 'Konstante Grundlast',
  selfConsumption: 'Eigenverbrauch (Smart Meter)',
  surplusHint:
    'Solarstrom geht direkt bis zur AC-Grenze ins Haus; nur was darüber liegt, lädt die Batterie. Sie gibt die Grundlast ab, sobald die Sonne sie nicht mehr deckt.',
  baseLoadHint:
    'Das System gibt ständig die Grundlast ab; Solarstrom darüber lädt die Batterie. Ist sie voll, geht der Überschuss bis zur AC-Grenze hinaus.',
  selfConsumptionHint:
    'Die Abgabe folgt dem Verbrauch (Messung am Zähler): Überschuss lädt die Batterie, sie deckt später den Bedarf bis zur AC-Grenze.',
  baseLoadW: 'Grundlast (Abgabe) je System',
  baseLoadWHint: 'Beispielwert – den eigenen Grundverbrauch einsetzen.',
  household: 'Haushalt',
  consumption: 'Jahresverbrauch des Haushalts',
  consumptionHint:
    'Beispielwert 2500 kWh: ElCom-Verbrauchsprofil H2 (4-Zimmerwohnung mit Elektroherd). H4 (5 Zimmer, Tumbler): 4500 kWh.',
  loadProfile: 'Verbrauchsverlauf',
  h0: 'Standardlastprofil',
  flat: 'Konstant',
  h0Hint:
    'BDEW-Standardlastprofil H0 für Haushalte (Deutschland, mit Jahreszeiten und Wochentagen; für die Schweiz gibt es kein veröffentlichtes Profil). Feiertage nicht berücksichtigt.',
  flatHint: 'Gleichmässiger Verbrauch rund um die Uhr (Näherung).',
  advanced: 'Wirkungsgrade und Reserve',
  etaCharge: 'Wirkungsgrad Laden',
  etaDischarge: 'Wirkungsgrad Entladen',
  etaHint:
    'Annahme 95 %: Die Hersteller der Presets geben keinen Wert an. Zusätzlich zu den Systemverlusten, die den Wechselrichter schon enthalten.',
  minSoc: 'Reserve (Mindest-Ladestand)',
  minSocHint: 'Annahme 10 %, in der App des Herstellers einstellbar.',
  standby: 'Eigenverbrauch je System',
  standbyHint:
    'Kein Herstellerwert bekannt, darum 0 W. Mit eigener Messung ergänzen: gedeckt aus Solarstrom, sonst aus der Batterie, sonst aus dem Netz.',
  costsHint: (investment: string) =>
    `Kosten des Speichers (${investment}) und was er ersetzt: unter Einstellungen › Wirtschaftlichkeit.`,
  restore: 'Standardwerte wiederherstellen',
  fieldNames: {
    unitCapacityWh: 'Kapazität',
    pvInputW: 'PV-Eingang',
    chargeW: 'Ladeleistung',
    dischargeW: 'Entladeleistung (= AC-Ausgang)',
    minSocPct: 'Reserve',
  } as Record<keyof BatteryPresetValues, string>,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Battery',
    enabled: 'Model battery storage',
    enabledHint:
      'Balcony storage with its own solar input (MPPT) and inverter, e.g. EcoFlow STREAM: the panels charge the battery at full power, the output is at most the AC limit.',
    off: 'off',
    device: 'Device',
    custom: 'Custom values',
    source: 'Manufacturer data',
    edited: 'Values edited – treated as “custom values”.',
    assumed: (fields) => `No manufacturer value, assumed: ${fields}.`,
    units: 'Number of units',
    unitsHint: (total, max) => `Storage total ${total}${max ? ` · at most ${max} per the manufacturer` : ''}`,
    layout: 'Layout',
    shared: 'One system',
    perFloor: 'Per floor',
    sharedHint: 'All floors charge one shared storage; the AC limit applies to all of them together.',
    perFloorHint: 'Every floor has its own system with storage and AC limit.',
    capacity: 'Usable capacity per unit',
    pvInput: 'Max. PV input per system',
    pvInputInfo: 'Sum of the MPPT inputs. Solar power above it is lost.',
    charge: 'Max. charging power per system',
    discharge: 'Max. discharging power per system',
    acLimit: 'AC output limit per system',
    acLimitShared: 'AC output limit (total)',
    acLimitHint:
      'Switzerland: plug-in solar at most 600 W per household (ESTI, SwissEnergy); EU: 800 VA. Applies to the battery results; the annual yield still uses the inverter limit under “System”.',
    strategy: 'Operating mode',
    surplus: 'Store surplus only',
    baseLoad: 'Constant base load',
    selfConsumption: 'Self-consumption (smart meter)',
    surplusHint:
      'Solar power goes straight into the house up to the AC limit; only what is above it charges the battery. It delivers the base load once the sun no longer covers it.',
    baseLoadHint:
      'The system always delivers the base load; solar power above it charges the battery. When it is full, the surplus goes out up to the AC limit.',
    selfConsumptionHint:
      'The output follows the consumption (measured at the meter): surplus charges the battery, which covers the demand later up to the AC limit.',
    baseLoadW: 'Base load (output) per system',
    baseLoadWHint: 'Example value – enter your own base consumption.',
    household: 'Household',
    consumption: 'Annual household consumption',
    consumptionHint:
      'Example value 2500 kWh: ElCom consumption profile H2 (4-room flat with electric cooker). H4 (5 rooms, tumble dryer): 4500 kWh.',
    loadProfile: 'Consumption pattern',
    h0: 'Standard load profile',
    flat: 'Constant',
    h0Hint:
      'BDEW standard load profile H0 for households (Germany, with seasons and weekdays; no profile is published for Switzerland). Public holidays not included.',
    flatHint: 'Even consumption around the clock (approximation).',
    advanced: 'Efficiencies and reserve',
    etaCharge: 'Charging efficiency',
    etaDischarge: 'Discharging efficiency',
    etaHint:
      'Assumed 95 %: the manufacturers of the presets state no value. On top of the system losses, which already contain the inverter.',
    minSoc: 'Reserve (minimum state of charge)',
    minSocHint: 'Assumed 10 %, adjustable in the manufacturer’s app.',
    standby: 'Own consumption per system',
    standbyHint:
      'No manufacturer value known, hence 0 W. Add your own measurement: covered by solar power, else the battery, else the grid.',
    costsHint: (investment) =>
      `Storage cost (${investment}) and what it replaces: under Settings › Economics.`,
    restore: 'Restore defaults',
    fieldNames: {
      unitCapacityWh: 'capacity',
      pvInputW: 'PV input',
      chargeW: 'charging power',
      dischargeW: 'discharging power (= AC output)',
      minSocPct: 'reserve',
    },
  },
};

/** Device fields: editing one leaves the preset (→ custom values). */
const DEVICE_FIELDS = new Set<keyof BatteryConfig>(['unitCapacityWh', 'pvInputW', 'chargeW', 'dischargeW']);

/** Battery storage: device preset, units, layout, AC limit, operating mode, household load, investment. */
export function BatterySection() {
  const t = useMessages(messages);
  const f = useFormat();
  const b = useConfigSection('battery');
  const numFloors = useConfigSection('building').numFloors;
  const currency = useConfigSection('economics').currency;
  const patch = usePatch();
  const L = LIMITS.battery;
  const preset = batteryPreset(b.preset);
  const matches = matchesBatteryPreset(b);

  const set = (partial: Partial<BatteryConfig>): void => {
    const device = (Object.keys(partial) as (keyof BatteryConfig)[]).some((k) => DEVICE_FIELDS.has(k));
    patch('battery', device ? { ...partial, preset: CUSTOM_BATTERY_PRESET } : partial);
  };

  const presetOptions = useMemo(
    (): SelectOption<string>[] => [
      ...BATTERY_PRESETS.map((p) => ({ value: p.id, label: p.label })),
      { value: CUSTOM_BATTERY_PRESET, label: t.custom },
    ],
    [t],
  );

  const totalKwh = (b.units * b.unitCapacityWh * (b.layout === 'per-floor' ? numFloors : 1)) / 1000;
  const shared = b.layout === 'shared' || numFloors < 2;
  const summary = b.enabled ? f.unit(totalKwh, 'kWh', 2) : t.off;
  const strategyHint = {
    surplus: t.surplusHint,
    'base-load': t.baseLoadHint,
    'self-consumption': t.selfConsumptionHint,
  };
  const isDefault = JSON.stringify(b) === JSON.stringify({ ...DEFAULT_CONFIG.battery, enabled: b.enabled });

  return (
    <Section level={3} id="battery" title={t.title} summary={summary}>
      <Toggle
        label={t.enabled}
        checked={b.enabled}
        onChange={(enabled) => patch('battery', { enabled })}
        hint={t.enabledHint}
      />
      {b.enabled && (
        <>
          <div className={sections.group}>
            <SelectField
              label={t.device}
              value={preset ? b.preset : CUSTOM_BATTERY_PRESET}
              options={presetOptions}
              onChange={(id) => patch('battery', applyBatteryPreset(b, id))}
            />
            {preset && (
              <p className={sections.hint}>
                {matches ? (
                  <>
                    <a href={preset.url} target="_blank" rel="noreferrer">
                      {t.source}
                    </a>
                    {preset.assumed.length > 0 &&
                      ` · ${t.assumed(preset.assumed.map((k) => t.fieldNames[k]).join(', '))}`}
                  </>
                ) : (
                  t.edited
                )}
              </p>
            )}
          </div>
          <NumberField
            label={t.units}
            value={b.units}
            onChange={(units) =>
              patch('battery', preset && matches ? applyBatteryPreset({ ...b, units }, b.preset) : { units })
            }
            limit={L.units}
            max={preset && matches ? preset.maxUnits : undefined}
            hint={t.unitsHint(f.unit(totalKwh, 'kWh', 2), preset && matches ? preset.maxUnits : null)}
          />
          {numFloors > 1 && (
            <div className={sections.group}>
              <Segmented<BatteryLayout>
                label={t.layout}
                showLabel
                fullWidth
                value={b.layout}
                onChange={(layout) => patch('battery', { layout })}
                options={[
                  { value: 'shared', label: t.shared },
                  { value: 'per-floor', label: t.perFloor },
                ]}
              />
              <p className={sections.hint}>{b.layout === 'shared' ? t.sharedHint : t.perFloorHint}</p>
            </div>
          )}
          <NumberField
            label={shared ? t.acLimitShared : t.acLimit}
            value={b.acLimitW}
            onChange={(acLimitW) => patch('battery', { acLimitW })}
            limit={L.acLimitW}
            sliderMax={2000}
            unit="W"
            hint={t.acLimitHint}
          />
          <NumberField
            label={t.capacity}
            value={b.unitCapacityWh}
            onChange={(unitCapacityWh) => set({ unitCapacityWh })}
            limit={L.unitCapacityWh}
            sliderMax={6000}
            unit="Wh"
          />
          <NumberField
            label={t.pvInput}
            value={b.pvInputW}
            onChange={(pvInputW) => set({ pvInputW })}
            limit={L.pvInputW}
            sliderMax={8000}
            unit="W"
            info={t.pvInputInfo}
          />
          <NumberField
            label={t.charge}
            value={b.chargeW}
            onChange={(chargeW) => set({ chargeW })}
            limit={L.chargeW}
            sliderMax={8000}
            unit="W"
          />
          <NumberField
            label={t.discharge}
            value={b.dischargeW}
            onChange={(dischargeW) => set({ dischargeW })}
            limit={L.dischargeW}
            sliderMax={8000}
            unit="W"
          />
          <div className={sections.group}>
            <SelectField<BatteryStrategy>
              label={t.strategy}
              value={b.strategy}
              options={[
                { value: 'surplus', label: t.surplus },
                { value: 'base-load', label: t.baseLoad },
                { value: 'self-consumption', label: t.selfConsumption },
              ]}
              onChange={(strategy) => patch('battery', { strategy })}
              hint={strategyHint[b.strategy]}
            />
          </div>
          {b.strategy !== 'self-consumption' && (
            <NumberField
              label={t.baseLoadW}
              value={b.baseLoadW}
              onChange={(baseLoadW) => patch('battery', { baseLoadW })}
              limit={L.baseLoadW}
              sliderMax={800}
              unit="W"
              hint={t.baseLoadWHint}
            />
          )}

          <h4 className={sections.subheading}>{t.household}</h4>
          <NumberField
            label={t.consumption}
            value={b.consumptionKwh}
            onChange={(consumptionKwh) => patch('battery', { consumptionKwh })}
            limit={L.consumptionKwh}
            sliderMax={10000}
            unit="kWh"
            hint={t.consumptionHint}
          />
          <div className={sections.group}>
            <Segmented<LoadProfileKind>
              label={t.loadProfile}
              showLabel
              fullWidth
              value={b.loadProfile}
              onChange={(loadProfile) => patch('battery', { loadProfile })}
              options={[
                { value: 'h0', label: t.h0 },
                { value: 'flat', label: t.flat },
              ]}
            />
            <p className={sections.hint}>{b.loadProfile === 'h0' ? t.h0Hint : t.flatHint}</p>
          </div>

          <h4 className={sections.subheading}>{t.advanced}</h4>
          <NumberField
            label={t.etaCharge}
            value={b.chargeEfficiencyPct}
            onChange={(chargeEfficiencyPct) => patch('battery', { chargeEfficiencyPct })}
            limit={L.chargeEfficiencyPct}
            unit="%"
          />
          <NumberField
            label={t.etaDischarge}
            value={b.dischargeEfficiencyPct}
            onChange={(dischargeEfficiencyPct) => patch('battery', { dischargeEfficiencyPct })}
            limit={L.dischargeEfficiencyPct}
            unit="%"
            hint={t.etaHint}
          />
          <NumberField
            label={t.minSoc}
            value={b.minSocPct}
            onChange={(minSocPct) => patch('battery', { minSocPct })}
            limit={L.minSocPct}
            unit="%"
            hint={t.minSocHint}
          />
          <NumberField
            label={t.standby}
            value={b.standbyW}
            onChange={(standbyW) => patch('battery', { standbyW })}
            limit={L.standbyW}
            sliderMax={40}
            unit="W"
            hint={t.standbyHint}
          />
          <p className={sections.hint}>{t.costsHint(f.currency(b.investment, currency, 0))}</p>
          <div className={sections.actions}>
            <Button
              size="sm"
              variant="ghost"
              icon={<ResetIcon />}
              disabled={isDefault}
              onClick={() => patch('battery', { ...DEFAULT_CONFIG.battery, enabled: true })}
            >
              {t.restore}
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}
