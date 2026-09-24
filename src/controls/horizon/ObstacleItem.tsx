import { useId, useMemo, type Ref } from 'react';
import { Button } from '../../components/Button';
import { NumberField } from '../../components/NumberField';
import { TextField } from '../../components/TextField';
import { useFormat, useLang, useMessages, type Messages } from '../../i18n';
import { LIMITS } from '../../model/defaults';
import { obstacleHorizon } from '../../model/horizon';
import { MAX_TEXT_LENGTH } from '../../model/share';
import type { FacadeVector, Obstacle } from '../../model/types';
import { obstacleName, profilePeak } from './horizonData';
import { TrashIcon } from './icons';
import styles from './ObstacleItem.module.css';

const de = {
  remove: (name: string) => `${name} entfernen`,
  size: (w: string, h: string, d: string) => `${w} breit, ${h} hoch, ${d} entfernt`,
  peak: (el: string, floor: string) => `Höhenwinkel bis ${el} (vom ${floor} aus)`,
  below: (floor: string) => `Niedriger als die Panelmitte im ${floor}: dort ohne Einfluss auf den Horizont`,
  name: 'Bezeichnung',
  offsetAlong: 'Versatz entlang der Fassade',
  offsetHint: 'Mitte des Hindernisses; + = rechts, von aussen auf die Fassade gesehen',
  distance: 'Abstand zur Fassade',
  distanceHint: 'Von der Fassadenwand bis zur nächsten Seite des Hindernisses',
  width: 'Breite (entlang der Fassade)',
  depth: 'Tiefe (von der Fassade weg)',
  height: 'Höhe über Boden',
  heightHint: (floor: string, z: string) => `Zum Vergleich: Panelmitte im ${floor} auf ${z}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    remove: (name) => `Remove ${name}`,
    size: (w, h, d) => `${w} wide, ${h} high, ${d} away`,
    peak: (el, floor) => `Elevation angle up to ${el} (seen from ${floor})`,
    below: (floor) => `Lower than the panel centre on ${floor}: no effect on the horizon there`,
    name: 'Name',
    offsetAlong: 'Offset along the facade',
    offsetHint: 'Centre of the obstacle; + = right, seen from outside facing the facade',
    distance: 'Distance from the facade',
    distanceHint: 'From the facade wall to the nearest side of the obstacle',
    width: 'Width (along the facade)',
    depth: 'Depth (away from the facade)',
    height: 'Height above ground',
    heightHint: (floor, z) => `For comparison: panel centre on ${floor} at ${z}`,
  },
};

export interface ObstacleItemProps {
  obstacle: Obstacle;
  /** Position in the list (0-based), used for the fallback name. */
  index: number;
  open: boolean;
  onToggle: () => void;
  onChange: (partial: Partial<Obstacle>) => void;
  onRemove: () => void;
  /** Panel centre of the analysed floor (the observer of the obstacle horizon), null if unknown. */
  observer: FacadeVector | null;
  /** Storey label of the analysed floor, e.g. "1. OG". */
  floorName: string;
  facadeAzimuth: number;
  /** Ref of the expand/collapse button (focus target after adding an obstacle). */
  toggleRef?: Ref<HTMLButtonElement>;
}

/**
 * One obstacle: collapsible header (name, size, how high it rises above the horizon seen from the analysed
 * floor) with a remove button, and the editable fields (name, position and size in m).
 */
export function ObstacleItem({
  obstacle,
  index,
  open,
  onToggle,
  onChange,
  onRemove,
  observer,
  floorName,
  facadeAzimuth,
  toggleRef,
}: ObstacleItemProps) {
  const t = useMessages(messages);
  const f = useFormat();
  const id = useId();
  const L = LIMITS.obstacle;
  const lang = useLang();
  const name = obstacleName(obstacle, index, lang);
  const m = (v: number): string => f.unit(v, 'm', Number.isInteger(v) ? 0 : 1);

  const peak = useMemo(
    () => (observer ? profilePeak(obstacleHorizon([obstacle], observer, facadeAzimuth, 1)) : null),
    [obstacle, observer, facadeAzimuth],
  );
  const rises = peak !== null && peak.elevation > 0;

  return (
    <li className={styles.item} data-open={open || undefined}>
      <div className={styles.head}>
        <button
          ref={toggleRef}
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={onToggle}
        >
          <span className={styles.chevron} aria-hidden="true" />
          <span className={styles.text}>
            <span className={styles.name}>{name}</span>
            <span className={styles.meta}>
              {t.size(m(obstacle.width), m(obstacle.height), m(obstacle.distance))}
            </span>
            {peak && (
              <span className={rises ? styles.meta : styles.metaFaint}>
                {rises ? t.peak(f.deg(peak.elevation, 1), floorName) : t.below(floorName)}
              </span>
            )}
          </span>
        </button>
        <Button size="sm" variant="ghost" iconOnly icon={<TrashIcon />} onClick={onRemove}>
          {t.remove(name)}
        </Button>
      </div>
      <fieldset id={`${id}-body`} className={styles.body} hidden={!open}>
        <legend className="sr-only">{name}</legend>
        {open && (
          <>
            <TextField
              label={t.name}
              value={obstacle.name}
              maxLength={MAX_TEXT_LENGTH}
              placeholder={obstacleName({ ...obstacle, name: '' }, index, lang)}
              onCommit={(v) => onChange({ name: v })}
            />
            <NumberField
              label={t.distance}
              value={obstacle.distance}
              onChange={(v) => onChange({ distance: v })}
              limit={L.distance}
              sliderMax={150}
              unit="m"
              hint={t.distanceHint}
            />
            <NumberField
              label={t.offsetAlong}
              value={obstacle.offsetAlong}
              onChange={(v) => onChange({ offsetAlong: v })}
              limit={L.offsetAlong}
              sliderMin={-75}
              sliderMax={75}
              unit="m"
              hint={t.offsetHint}
            />
            <NumberField
              label={t.width}
              value={obstacle.width}
              onChange={(v) => onChange({ width: v })}
              limit={L.width}
              sliderMax={100}
              unit="m"
            />
            <NumberField
              label={t.depth}
              value={obstacle.depth}
              onChange={(v) => onChange({ depth: v })}
              limit={L.depth}
              sliderMax={60}
              unit="m"
            />
            <NumberField
              label={t.height}
              value={obstacle.height}
              onChange={(v) => onChange({ height: v })}
              limit={L.height}
              sliderMax={80}
              unit="m"
              hint={observer ? t.heightHint(floorName, m(Math.round(observer.z * 10) / 10)) : undefined}
            />
          </>
        )}
      </fieldset>
    </li>
  );
}
