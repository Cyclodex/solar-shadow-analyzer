import { useId } from 'react';
import { NumberField } from '../components/NumberField';
import { Section } from '../components/Section';
import { compassPoint, floorLabel, useFormat, useLang, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { LIMITS } from '../model/defaults';
import { useConfigSection, usePatch } from '../state/configStore';
import { CompassDial } from './location/CompassDial';
import sections from './sections.module.css';
import styles from './BuildingSection.module.css';

const de = {
  title: 'Gebäude',
  orientation: 'Ausrichtung',
  facadeAzimuth: 'Fassadenazimut',
  facadeDial: 'Fassadenausrichtung',
  facadeFaces: (dir: string) => `Die Fassade schaut nach ${dir}.`,
  facadeScale: '0° = Nord, 90° = Ost, 180° = Süd, 270° = West',
  dialHelp:
    'Kompass ziehen oder anklicken. Tasten: Pfeile ±1°, mit Umschalt ±10°, Bild ↑/↓ in 45°-Schritten.',
  floorsHeading: 'Stockwerke',
  numFloors: 'Stockwerke mit Panels',
  lowestFloor: 'Unterstes Panel-Stockwerk',
  storeys: (from: string, to: string | null) => `Panels: ${to ? `${from} bis ${to}` : from}`,
  lowestHint: '0 = Erdgeschoss',
  floorHeight: 'Stockwerkhöhe',
  floorHeightHint: 'Vertikaler Abstand zwischen zwei übereinanderliegenden Panelreihen',
  balconyHeading: 'Balkon',
  railingHeight: 'Geländerhöhe',
  railingHint: 'Die Panels hängen an der Oberkante des Geländers.',
  balconyDepth: 'Balkontiefe',
  balconyHint: 'Abstand von der Fassade zum Geländer',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Building',
    orientation: 'Orientation',
    facadeAzimuth: 'Facade azimuth',
    facadeDial: 'Facade orientation',
    facadeFaces: (dir) => `The facade faces ${dir}.`,
    facadeScale: '0° = north, 90° = east, 180° = south, 270° = west',
    dialHelp: 'Drag or click the compass. Keys: arrows ±1°, with Shift ±10°, Page Up/Down in 45° steps.',
    floorsHeading: 'Floors',
    numFloors: 'Floors with panels',
    lowestFloor: 'Lowest panel floor',
    storeys: (from, to) => `Panels: ${to ? `${from} to ${to}` : from}`,
    lowestHint: '0 = ground floor',
    floorHeight: 'Floor-to-floor height',
    floorHeightHint: 'Vertical distance between two stacked panel rows',
    balconyHeading: 'Balcony',
    railingHeight: 'Railing height',
    railingHint: 'The panels hang from the top of the railing.',
    balconyDepth: 'Balcony depth',
    balconyHint: 'Distance from the facade to the railing',
  },
};

/** Facade orientation (compass dial + number), floors and balcony geometry. */
export function BuildingSection() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const helpId = useId();
  const building = useConfigSection('building');
  const patch = usePatch();
  const L = LIMITS.building;
  const { facadeAzimuth, numFloors, lowestFloor } = building;
  const dir = compassPoint(facadeAzimuth, lang);
  const topStorey = lowestFloor + numFloors - 1;
  const setAzimuth = (v: number): void => patch('building', { facadeAzimuth: v });

  return (
    <Section
      level={3}
      id="building"
      title={t.title}
      summary={`${f.deg(facadeAzimuth)} ${dir} · ${c.floorsCount(numFloors)}`}
    >
      <div className={sections.group}>
        <h4 className={sections.subheading}>{t.orientation}</h4>
        <div className={styles.orientation}>
          <CompassDial
            className={styles.dial}
            value={facadeAzimuth}
            onChange={setAzimuth}
            label={t.facadeDial}
            valueText={(v) => `${f.deg(v)} ${compassPoint(v, lang)}`}
            describedBy={helpId}
          />
          <div className={styles.orientationText}>
            <p className={styles.faces}>{t.facadeFaces(dir)}</p>
            <p className={sections.hint}>{t.facadeScale}</p>
          </div>
        </div>
        <NumberField
          label={t.facadeAzimuth}
          value={facadeAzimuth}
          onChange={setAzimuth}
          limit={L.facadeAzimuth}
          unit="°"
          slider={false}
        />
        <p id={helpId} className={sections.hint}>
          {t.dialHelp}
        </p>
      </div>

      <div className={sections.group}>
        <h4 className={sections.subheading}>{t.floorsHeading}</h4>
        <NumberField
          label={t.numFloors}
          value={numFloors}
          onChange={(v) => patch('building', { numFloors: v })}
          limit={L.numFloors}
        />
        <NumberField
          label={t.lowestFloor}
          value={lowestFloor}
          onChange={(v) => patch('building', { lowestFloor: v })}
          limit={L.lowestFloor}
          sliderMax={12}
          hint={t.lowestHint}
        />
        <p className={styles.storeys} aria-live="polite">
          {t.storeys(floorLabel(lowestFloor, lang), numFloors > 1 ? floorLabel(topStorey, lang) : null)}
        </p>
        <NumberField
          label={t.floorHeight}
          value={building.floorHeight}
          onChange={(v) => patch('building', { floorHeight: v })}
          limit={L.floorHeight}
          unit="cm"
          hint={t.floorHeightHint}
        />
      </div>

      <div className={sections.group}>
        <h4 className={sections.subheading}>{t.balconyHeading}</h4>
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
      </div>
    </Section>
  );
}
