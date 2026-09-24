import { InfoTip } from '../components/InfoTip';
import { NumberField } from '../components/NumberField';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { SelectField } from '../components/SelectField';
import { useLayout } from '../hooks/useModel';
import { useFormat, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { LIMITS } from '../model/defaults';
import { panelsOverlap } from '../model/geometry';
import { MODULE_PRESETS, findModulePreset, type ModulePreset } from '../model/presets';
import type { PanelConfig } from '../model/types';
import { useConfigSection, usePatch } from '../state/configStore';
import sections from './sections.module.css';
import styles from './PanelSection.module.css';

type Orientation = 'landscape' | 'portrait';

const de = {
  title: 'Panels',
  module: 'Modul',
  preset: 'Modultyp',
  custom: 'Benutzerdefiniert',
  presetLabel: (cells: number, dims: string, wp: string) => `Typ. ${cells} Zellen · ${dims} · ${wp}`,
  orientation: 'Einbaulage',
  landscape: 'Quer',
  landscapeTitle: 'Querformat: lange Seite entlang des Geländers',
  portrait: 'Hoch',
  portraitTitle: 'Hochformat: lange Seite entlang der Neigung',
  orientationHint: 'Wechseln tauscht Länge und Breite.',
  length: 'Länge entlang der Neigung',
  lengthHint: 'Hängt vom Geländer nach unten bzw. aussen',
  width: 'Breite entlang des Geländers',
  row: 'Reihe je Stockwerk',
  count: 'Module nebeneinander',
  gap: 'Abstand zwischen Modulen',
  power: 'Nennleistung je Modul',
  derived: (theta: string) => `Abgeleitete Werte bei θ = ${theta}`,
  rowWidth: 'Reihenbreite',
  powerFloor: 'Leistung je Stockwerk',
  powerTotal: (floors: number) =>
    floors === 1 ? 'Leistung gesamt' : `Leistung gesamt (${floors} Stockwerke)`,
  drop: 'Vertikale Ausdehnung',
  dropInfo: 'Höhe, um die ein Panel unter die Geländeroberkante reicht: Länge · cos θ.',
  reach: 'Ausladung',
  reachInfo: 'Wie weit ein Panel waagrecht vor das Geländer ragt: Länge · sin θ.',
  clearance: 'Freiraum zur Reihe darunter',
  clearanceInfo:
    'Vertikaler Abstand zwischen der Unterkante eines Panels und der Oberkante des Panels im Stockwerk darunter.',
  overlap: 'Überlappung',
  overlapText: (cm: string) => `Die Reihen überlappen um ${cm}. Neigung erhöhen oder kürzere Module wählen.`,
  critical: 'Kritischer Profilwinkel',
  criticalInfo:
    'Ab diesem Profilwinkel der Sonne (Sonnenhöhe in der Ebene senkrecht zur Fassade) beginnt die obere Reihe, die untere zu verschatten. Nur eine Erklärhilfe: Die Berechnung selbst ist dreidimensional.',
  criticalNone: 'keine Reihe darüber',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Panels',
    module: 'Module',
    preset: 'Module type',
    custom: 'Custom',
    presetLabel: (cells, dims, wp) => `Typ. ${cells} cells · ${dims} · ${wp}`,
    orientation: 'Mounting',
    landscape: 'Landscape',
    landscapeTitle: 'Landscape: long side along the railing',
    portrait: 'Portrait',
    portraitTitle: 'Portrait: long side along the slope',
    orientationHint: 'Switching swaps length and width.',
    length: 'Length along the slope',
    lengthHint: 'Hangs down / outwards from the railing',
    width: 'Width along the railing',
    row: 'Row per floor',
    count: 'Modules side by side',
    gap: 'Gap between modules',
    power: 'Rated power per module',
    derived: (theta) => `Derived values at θ = ${theta}`,
    rowWidth: 'Row width',
    powerFloor: 'Power per floor',
    powerTotal: (floors) => (floors === 1 ? 'Total power' : `Total power (${floors} floors)`),
    drop: 'Vertical extent',
    dropInfo: 'How far a panel reaches below the top of the railing: length · cos θ.',
    reach: 'Reach',
    reachInfo: 'How far a panel sticks out horizontally in front of the railing: length · sin θ.',
    clearance: 'Clearance to the row below',
    clearanceInfo:
      'Vertical distance between the lower edge of a panel and the upper edge of the panel on the floor below.',
    overlap: 'Overlap',
    overlapText: (cm) => `The rows overlap by ${cm}. Increase the tilt or choose shorter modules.`,
    critical: 'Critical profile angle',
    criticalInfo:
      'Above this profile angle of the sun (sun altitude in the plane perpendicular to the facade) the upper row starts to shade the lower one. An explanation only: the calculation itself is three-dimensional.',
    criticalNone: 'no row above',
  },
};

/** Landscape = long side along the railing (PanelConfig.width ≥ length). */
function orientationOf(p: Pick<PanelConfig, 'length' | 'width'>): Orientation {
  return p.length > p.width ? 'portrait' : 'landscape';
}

/** Preset dimensions in the given orientation. */
function presetPanels(m: ModulePreset, o: Orientation): Pick<PanelConfig, 'length' | 'width' | 'powerWp'> {
  const long = Math.max(m.length, m.width);
  const short = Math.min(m.length, m.width);
  return o === 'portrait'
    ? { length: long, width: short, powerWp: m.powerWp }
    : { length: short, width: long, powerWp: m.powerWp };
}

/** Module format (preset or custom, landscape/portrait), row and power, plus derived geometry. */
export function PanelSection() {
  const t = useMessages(messages);
  const f = useFormat();
  const panels = useConfigSection('panels');
  const numFloors = useConfigSection('building').numFloors;
  const patch = usePatch();
  const L = LIMITS.panels;
  const preset = findModulePreset(panels);
  const orientation = orientationOf(panels);

  const setOrientation = (o: Orientation): void => {
    if (o !== orientation) patch('panels', { length: panels.width, width: panels.length });
  };

  return (
    <Section id="panels" title={t.title} summary={`${panels.count} × ${f.unit(panels.powerWp, 'Wp')}`}>
      <div className={sections.group}>
        <h3 className={sections.subheading}>{t.module}</h3>
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
            if (m) patch('panels', presetPanels(m, orientation));
          }}
        />
        <div className={styles.orientation}>
          <Segmented<Orientation>
            label={t.orientation}
            showLabel
            fullWidth
            value={orientation}
            onChange={setOrientation}
            options={[
              {
                value: 'landscape',
                title: t.landscapeTitle,
                label: (
                  <span className={styles.orientationOption}>
                    <span className={styles.landscapeGlyph} aria-hidden="true" />
                    {t.landscape}
                  </span>
                ),
              },
              {
                value: 'portrait',
                title: t.portraitTitle,
                label: (
                  <span className={styles.orientationOption}>
                    <span className={styles.portraitGlyph} aria-hidden="true" />
                    {t.portrait}
                  </span>
                ),
              },
            ]}
          />
          <p className={sections.hint}>
            {orientation === 'landscape' ? t.landscapeTitle : t.portraitTitle}. {t.orientationHint}
          </p>
        </div>
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
          label={t.power}
          value={panels.powerWp}
          onChange={(v) => patch('panels', { powerWp: v })}
          limit={L.powerWp}
          unit="Wp"
        />
      </div>

      <div className={sections.group}>
        <h3 className={sections.subheading}>{t.row}</h3>
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
      </div>

      <DerivedValues numFloors={numFloors} />
    </Section>
  );
}

/** Row width, power, drop/reach, clearance (or overlap) and the critical profile angle from panelLayout. */
function DerivedValues({ numFloors }: { numFloors: number }) {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const layout = useLayout();
  const panels = useConfigSection('panels');
  const perFloorWp = panels.count * panels.powerWp;
  const overlap = numFloors > 1 && panelsOverlap(layout);
  const cm = (m: number): string => f.unit(m * 100, 'cm');

  let critical: string;
  if (numFloors < 2) critical = t.criticalNone;
  else if (overlap) critical = '–';
  else if (layout.criticalProfileAngle >= 90) critical = c.never;
  else critical = f.deg(layout.criticalProfileAngle, 1);

  const rows: { key: string; term: string; value: string; info?: string; tone?: 'bad' }[] = [
    { key: 'row', term: t.rowWidth, value: f.unit(layout.rowWidth, 'm', 2) },
    { key: 'floor', term: t.powerFloor, value: f.unit(perFloorWp, 'Wp') },
    { key: 'total', term: t.powerTotal(numFloors), value: f.unit((perFloorWp * numFloors) / 1000, 'kWp', 2) },
    { key: 'drop', term: t.drop, value: cm(layout.drop), info: t.dropInfo },
    { key: 'reach', term: t.reach, value: cm(layout.reach), info: t.reachInfo },
  ];
  if (numFloors > 1) {
    rows.push(
      overlap
        ? { key: 'gap', term: t.overlap, value: cm(-layout.verticalGap), tone: 'bad' }
        : { key: 'gap', term: t.clearance, value: cm(layout.verticalGap), info: t.clearanceInfo },
    );
  }
  rows.push({ key: 'critical', term: t.critical, value: critical, info: t.criticalInfo });

  return (
    <div className={sections.group}>
      <h3 className={sections.subheading}>{t.derived(f.deg(layout.tiltFromVertical))}</h3>
      <dl className={styles.derived}>
        {rows.map((r) => (
          <div key={r.key} className={styles.derivedRow} data-tone={r.tone}>
            <dt className={styles.term}>
              {r.term}
              {r.info && <InfoTip label={r.term}>{r.info}</InfoTip>}
            </dt>
            <dd className={styles.value}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {overlap && (
        <p className={styles.overlap} role="note">
          {t.overlapText(cm(-layout.verticalGap))}
        </p>
      )}
    </div>
  );
}
