import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { NumberField } from '../../components/NumberField';
import { useMessages, type Messages } from '../../i18n';
import {
  DEFAULT_MANUAL_HEIGHT,
  DEFAULT_MANUAL_RECT,
  MANUAL_RECT_LIMITS as RECT_LIMITS,
  type FacadeRect,
} from '../../model/buildings';
import { LIMITS } from '../../model/defaults';
import { PlusIcon } from '../icons';
import styles from './BuildingList.module.css';

const de = {
  title: 'Gebäude von Hand erfassen',
  intro:
    'Rechteck vor der Fassade, gemessen wie ein Hindernis. Es bleibt an seinem Ort, auch wenn sich später Standort oder Fassade ändern.',
  distance: 'Abstand zur Fassade',
  distanceHint: 'Von der Fassadenwand bis zur nächsten Seite',
  offset: 'Versatz entlang der Fassade',
  offsetHint: 'Mitte des Gebäudes; + = rechts, von aussen auf die Fassade gesehen',
  width: 'Breite (entlang der Fassade)',
  depth: 'Tiefe (von der Fassade weg)',
  rotation: 'Drehung',
  rotationHint: 'Um die Mitte, im Uhrzeigersinn von oben gesehen',
  height: 'Höhe',
  base: 'Basis über dem Boden am Standort',
  add: 'Hinzufügen',
  cancel: 'Abbrechen',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Enter a building by hand',
    intro:
      'A rectangle in front of the facade, measured like an obstacle. It stays in place even if the location or facade changes later.',
    distance: 'Distance from the facade',
    distanceHint: 'From the facade wall to the nearest side',
    offset: 'Offset along the facade',
    offsetHint: 'Centre of the building; + = right, seen from outside facing the facade',
    width: 'Width (along the facade)',
    depth: 'Depth (away from the facade)',
    rotation: 'Rotation',
    rotationHint: 'About the centre, clockwise seen from above',
    height: 'Height',
    base: 'Base above the ground at the site',
    add: 'Add',
    cancel: 'Cancel',
  },
};

export interface AddBuildingFormProps {
  onAdd: (rect: FacadeRect, height: number, base: number) => void;
  onCancel: () => void;
}

/** Form for a manual building: a rectangle in the facade frame, its height and base. */
export function AddBuildingForm({ onAdd, onCancel }: AddBuildingFormProps) {
  const t = useMessages(messages);
  const [rect, setRect] = useState<FacadeRect>(DEFAULT_MANUAL_RECT);
  const [height, setHeight] = useState(DEFAULT_MANUAL_HEIGHT);
  const [base, setBase] = useState(0);
  const groupRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const set = (partial: Partial<FacadeRect>): void => setRect((r) => ({ ...r, ...partial }));

  // Focus the form itself (announced by its name), not a field: no virtual keyboard pops up on phones.
  useEffect(() => groupRef.current?.focus(), []);

  // A group, not a <form>: Enter in a field only commits that field (NumberField), it never submits.
  return (
    <div ref={groupRef} className={styles.form} role="group" aria-labelledby={titleId} tabIndex={-1}>
      <h5 id={titleId} className={styles.formTitle}>
        {t.title}
      </h5>
      <p className={styles.hint}>{t.intro}</p>
      <NumberField
        label={t.distance}
        value={rect.distance}
        onChange={(v) => set({ distance: v })}
        limit={RECT_LIMITS.distance}
        sliderMax={150}
        unit="m"
        hint={t.distanceHint}
      />
      <NumberField
        label={t.offset}
        value={rect.offset}
        onChange={(v) => set({ offset: v })}
        limit={RECT_LIMITS.offset}
        sliderMin={-75}
        sliderMax={75}
        unit="m"
        hint={t.offsetHint}
      />
      <NumberField
        label={t.width}
        value={rect.width}
        onChange={(v) => set({ width: v })}
        limit={RECT_LIMITS.width}
        sliderMax={100}
        unit="m"
      />
      <NumberField
        label={t.depth}
        value={rect.depth}
        onChange={(v) => set({ depth: v })}
        limit={RECT_LIMITS.depth}
        sliderMax={60}
        unit="m"
      />
      <NumberField
        label={t.rotation}
        value={rect.rotation}
        onChange={(v) => set({ rotation: v })}
        limit={RECT_LIMITS.rotation}
        unit="°"
        hint={t.rotationHint}
      />
      <NumberField
        label={t.height}
        value={height}
        onChange={setHeight}
        limit={LIMITS.neighbour.height}
        sliderMax={80}
        unit="m"
      />
      <NumberField
        label={t.base}
        value={base}
        onChange={setBase}
        limit={LIMITS.neighbour.base}
        sliderMin={-20}
        sliderMax={30}
        unit="m"
      />
      <div className={styles.actions}>
        <Button variant="primary" size="sm" icon={<PlusIcon />} onClick={() => onAdd(rect, height, base)}>
          {t.add}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </div>
  );
}
