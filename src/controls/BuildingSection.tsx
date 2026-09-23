import { NumberField } from '../components/NumberField';
import { Section } from '../components/Section';
import { compassPoint, floorLabel, useFormat, useLang, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { LIMITS } from '../model/defaults';
import { useConfigSection, usePatch } from '../state/configStore';

const de = {
  title: 'Gebäude',
  facadeAzimuth: 'Fassadenausrichtung (Azimut)',
  facadeHint: (dir: string) =>
    `Richtung, in die die Fassade schaut: ${dir} (0° = Nord, 90° = Ost, 180° = Süd, 270° = West)`,
  floorHeight: 'Stockwerkhöhe',
  floorHeightHint: 'Vertikaler Abstand zwischen zwei übereinanderliegenden Panelreihen',
  railingHeight: 'Geländerhöhe',
  railingHint: 'Die Panels hängen an der Oberkante des Geländers',
  balconyDepth: 'Balkontiefe',
  balconyHint: 'Abstand von der Fassade zum Geländer',
  numFloors: 'Stockwerke mit Panels',
  lowestFloor: 'Unterstes Panel-Stockwerk',
  lowestHint: (label: string) => `= ${label}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Building',
    facadeAzimuth: 'Facade orientation (azimuth)',
    facadeHint: (dir) =>
      `Direction the facade faces: ${dir} (0° = north, 90° = east, 180° = south, 270° = west)`,
    floorHeight: 'Floor-to-floor height',
    floorHeightHint: 'Vertical distance between two stacked panel rows',
    railingHeight: 'Railing height',
    railingHint: 'The panels hang from the top of the railing',
    balconyDepth: 'Balcony depth',
    balconyHint: 'Distance from the facade to the railing',
    numFloors: 'Floors with panels',
    lowestFloor: 'Lowest panel floor',
    lowestHint: (label) => `= ${label}`,
  },
};

/** Facade orientation and balcony geometry. (Basic version.) */
export function BuildingSection() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const building = useConfigSection('building');
  const patch = usePatch();
  const L = LIMITS.building;
  const dir = compassPoint(building.facadeAzimuth, lang);

  return (
    <Section
      id="building"
      title={t.title}
      summary={`${f.deg(building.facadeAzimuth)} ${dir} · ${c.floorsCount(building.numFloors)}`}
    >
      <NumberField
        label={t.facadeAzimuth}
        value={building.facadeAzimuth}
        onChange={(v) => patch('building', { facadeAzimuth: v })}
        limit={L.facadeAzimuth}
        unit="°"
        hint={t.facadeHint(dir)}
      />
      <NumberField
        label={t.numFloors}
        value={building.numFloors}
        onChange={(v) => patch('building', { numFloors: v })}
        limit={L.numFloors}
      />
      <NumberField
        label={t.lowestFloor}
        value={building.lowestFloor}
        onChange={(v) => patch('building', { lowestFloor: v })}
        limit={L.lowestFloor}
        hint={t.lowestHint(floorLabel(building.lowestFloor, lang))}
      />
      <NumberField
        label={t.floorHeight}
        value={building.floorHeight}
        onChange={(v) => patch('building', { floorHeight: v })}
        limit={L.floorHeight}
        unit="cm"
        hint={t.floorHeightHint}
      />
      <NumberField
        label={t.railingHeight}
        value={building.railingHeight}
        onChange={(v) => patch('building', { railingHeight: v })}
        limit={L.railingHeight}
        unit="cm"
        hint={t.railingHint}
      />
      <NumberField
        label={t.balconyDepth}
        value={building.balconyDepth}
        onChange={(v) => patch('building', { balconyDepth: v })}
        limit={L.balconyDepth}
        unit="cm"
        hint={t.balconyHint}
      />
    </Section>
  );
}
