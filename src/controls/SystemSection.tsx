import { NumberField } from '../components/NumberField';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { useFormat, useMessages, type Messages } from '../i18n';
import { LIMITS } from '../model/defaults';
import type { ShadingModel } from '../model/types';
import { useConfigSection, usePatch } from '../state/configStore';
import sections from './sections.module.css';

const de = {
  title: 'System',
  inverter: 'Wechselrichter-Grenze je Stockwerk',
  inverterInfo:
    'Maximale AC-Leistung des Wechselrichters eines Stockwerks. Leistung darüber wird abgeregelt (die abgeregelte Energie geht verloren).',
  losses: 'Systemverluste',
  lossesInfo:
    'Verkabelung, Wechselrichter-Wirkungsgrad, Verschmutzung und Modulstreuung. Temperatur und Verschattung werden separat berechnet.',
  tempCoeff: 'Temperaturkoeffizient',
  tempCoeffInfo: 'Leistungsänderung pro Kelvin Zelltemperatur über 25 °C, laut Datenblatt (negativ).',
  noct: 'NOCT',
  noctInfo:
    'Nennbetriebstemperatur der Zelle laut Datenblatt. Bestimmt, wie stark sich die Module bei Einstrahlung erwärmen.',
  albedo: 'Albedo (Bodenreflexion)',
  albedoInfo: 'Anteil des Sonnenlichts, den der Boden vor dem Gebäude reflektiert (0 = nichts, 1 = alles).',
  shadingModel: 'Teilverschattung',
  substring: 'Bypass-Teilstränge',
  linear: 'Flächenanteil',
  substringHint:
    'Jedes Modul hat 3 Teilstränge mit Bypass-Diode parallel zur langen Seite. Ein Teilstrang verliert seinen Direktstrahlungs-Anteil gemäss seiner am stärksten verschatteten Zelle – realistischer für Standardmodule.',
  linearHint:
    'Der Direktstrahlungs-Verlust ist proportional zur verschatteten Fläche – optimistische Näherung.',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'System',
    inverter: 'Inverter limit per floor',
    inverterInfo:
      'Maximum AC power of one floor’s inverter. Power above it is curtailed (the curtailed energy is lost).',
    losses: 'System losses',
    lossesInfo:
      'Cabling, inverter efficiency, soiling and module mismatch. Temperature and shading are modelled separately.',
    tempCoeff: 'Temperature coefficient',
    tempCoeffInfo: 'Power change per kelvin of cell temperature above 25 °C, from the datasheet (negative).',
    noct: 'NOCT',
    noctInfo:
      'Nominal operating cell temperature from the datasheet. Determines how much the modules heat up in the sun.',
    albedo: 'Albedo (ground reflection)',
    albedoInfo: 'Share of sunlight reflected by the ground in front of the building (0 = none, 1 = all).',
    shadingModel: 'Partial shading',
    substring: 'Bypass substrings',
    linear: 'Area share',
    substringHint:
      'Each module has 3 substrings with a bypass diode, parallel to its long side. A substring loses its beam share according to its most shaded cell – more realistic for standard modules.',
    linearHint: 'The beam loss is proportional to the shaded area – an optimistic approximation.',
  },
};

/** Electrical system parameters (inverter, losses, temperature model, albedo, partial-shading model). */
export function SystemSection() {
  const t = useMessages(messages);
  const f = useFormat();
  const system = useConfigSection('system');
  const patch = usePatch();
  const L = LIMITS.system;
  const summary = `${f.unit(system.inverterLimitW, 'W')} · ${f.pct(system.lossesPct, 1)}`;

  return (
    <Section level={3} id="system" title={t.title} summary={summary}>
      <NumberField
        label={t.inverter}
        value={system.inverterLimitW}
        onChange={(v) => patch('system', { inverterLimitW: v })}
        limit={L.inverterLimitW}
        unit="W"
        info={t.inverterInfo}
      />
      <NumberField
        label={t.losses}
        value={system.lossesPct}
        onChange={(v) => patch('system', { lossesPct: v })}
        limit={L.lossesPct}
        unit="%"
        info={t.lossesInfo}
      />
      <NumberField
        label={t.tempCoeff}
        value={system.tempCoeffPct}
        onChange={(v) => patch('system', { tempCoeffPct: v })}
        limit={L.tempCoeffPct}
        unit="%/K"
        info={t.tempCoeffInfo}
      />
      <NumberField
        label={t.noct}
        value={system.noct}
        onChange={(v) => patch('system', { noct: v })}
        limit={L.noct}
        unit="°C"
        info={t.noctInfo}
      />
      <NumberField
        label={t.albedo}
        value={system.albedo}
        onChange={(v) => patch('system', { albedo: v })}
        limit={L.albedo}
        info={t.albedoInfo}
      />
      <div className={sections.group}>
        <Segmented<ShadingModel>
          label={t.shadingModel}
          showLabel
          fullWidth
          value={system.shadingModel}
          onChange={(v) => patch('system', { shadingModel: v })}
          options={[
            { value: 'substring', label: t.substring },
            { value: 'linear', label: t.linear },
          ]}
        />
        <p className={sections.hint}>
          {system.shadingModel === 'substring' ? t.substringHint : t.linearHint}
        </p>
      </div>
    </Section>
  );
}
