import { NumberField } from '../components/NumberField';
import { Section } from '../components/Section';
import { SelectField } from '../components/SelectField';
import { useFormat, useMessages, type Messages } from '../i18n';
import { LIMITS } from '../model/defaults';
import { MODULE_PRESETS, findModulePreset } from '../model/presets';
import { useConfigSection, usePatch } from '../state/configStore';

const de = {
  title: 'Panels',
  preset: 'Modultyp',
  custom: 'Eigene Masse',
  length: 'Modullänge (entlang der Neigung)',
  lengthHint: 'Hängt vom Geländer nach unten bzw. aussen',
  width: 'Modulbreite (entlang des Geländers)',
  count: 'Module nebeneinander je Stockwerk',
  gap: 'Abstand zwischen Modulen',
  power: 'Nennleistung je Modul',
  presetLabel: (cells: number, dims: string, wp: string) => `Typ. ${cells} Zellen · ${dims} · ${wp}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Panels',
    preset: 'Module type',
    custom: 'Custom dimensions',
    length: 'Module length (along the slope)',
    lengthHint: 'Hangs down / outwards from the railing',
    width: 'Module width (along the railing)',
    count: 'Modules side by side per floor',
    gap: 'Gap between modules',
    power: 'Rated power per module',
    presetLabel: (cells, dims, wp) => `Typ. ${cells} cells · ${dims} · ${wp}`,
  },
};

/** Module format, count and power (tilt: TiltControl). (Basic version.) */
export function PanelSection() {
  const t = useMessages(messages);
  const f = useFormat();
  const panels = useConfigSection('panels');
  const patch = usePatch();
  const L = LIMITS.panels;
  const preset = findModulePreset(panels);

  return (
    <Section id="panels" title={t.title} summary={`${panels.count} × ${f.unit(panels.powerWp, 'Wp')}`}>
      <SelectField
        label={t.preset}
        value={preset?.id ?? ''}
        placeholder={t.custom}
        options={MODULE_PRESETS.map((m) => ({
          value: m.id,
          label: t.presetLabel(
            m.cells,
            `${Math.round(Math.max(m.length, m.width) * 10)}×${Math.round(Math.min(m.length, m.width) * 10)} mm`,
            f.unit(m.powerWp, 'Wp'),
          ),
        }))}
        onChange={(id) => {
          const m = MODULE_PRESETS.find((x) => x.id === id);
          if (m) patch('panels', { length: m.length, width: m.width, powerWp: m.powerWp });
        }}
      />
      <NumberField
        label={t.length}
        value={panels.length}
        onChange={(v) => patch('panels', { length: v })}
        limit={L.length}
        unit="cm"
        hint={t.lengthHint}
      />
      <NumberField
        label={t.width}
        value={panels.width}
        onChange={(v) => patch('panels', { width: v })}
        limit={L.width}
        unit="cm"
      />
      <NumberField
        label={t.count}
        value={panels.count}
        onChange={(v) => patch('panels', { count: v })}
        limit={L.count}
      />
      <NumberField
        label={t.gap}
        value={panels.gap}
        onChange={(v) => patch('panels', { gap: v })}
        limit={L.gap}
        unit="cm"
      />
      <NumberField
        label={t.power}
        value={panels.powerWp}
        onChange={(v) => patch('panels', { powerWp: v })}
        limit={L.powerWp}
        unit="Wp"
      />
    </Section>
  );
}
