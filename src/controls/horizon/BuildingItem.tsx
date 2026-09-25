import { useId, type Ref } from 'react';
import { Button } from '../../components/Button';
import { ResetIcon } from '../../components/icons';
import { NumberField } from '../../components/NumberField';
import { TextField } from '../../components/TextField';
import { compassPoint, useFormat, useLang, useMessages, type Messages } from '../../i18n';
import type { BuildingBearing } from '../../model/buildings';
import { LIMITS } from '../../model/defaults';
import { MAX_TEXT_LENGTH } from '../../model/share';
import type { Building } from '../../model/types';
import { TrashIcon } from '../icons';
import styles from './BuildingList.module.css';

const de = {
  own: 'Eigenes Gebäude',
  ownHint:
    'Die Fassade mit den Panels gehört dazu; als Hindernis zählen nur Teile vor dem Balkon (etwa ein Flügel).',
  manual: 'von Hand',
  edited: 'bearbeitet',
  removed: 'entfernt',
  height: (h: string) => `${h} hoch`,
  base: (b: string) => `Basis ${b}`,
  where: (d: string, dir: string) => `${d} entfernt, ${dir}`,
  adjoining: (dir: string) => `angrenzend, ${dir}`,
  remove: (name: string) => `${name} entfernen`,
  restore: (name: string) => `${name} wiederherstellen`,
  name: 'Bezeichnung',
  heightField: 'Höhe über der Basis',
  heightHint: 'Bis zum höchsten Punkt des Dachs (gerechnet wird mit flachem Dach).',
  baseField: 'Basis über dem Boden am Standort',
  baseHint: 'Negativ, wenn das Gebäude tiefer steht als das eigene.',
  editedHint: 'Geändert: Im Laserscan ersetzt dieses Gebäude mit flachem Dach das gemessene.',
  removedHint: 'Entfernt: zählt nicht mehr, auch nicht im Laserscan (z. B. abgerissen).',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    own: 'Own building',
    ownHint:
      'The facade with the panels belongs to it; only parts in front of the balcony count as obstacles (e.g. a wing).',
    manual: 'manual',
    edited: 'edited',
    removed: 'removed',
    height: (h) => `${h} high`,
    base: (b) => `base ${b}`,
    where: (d, dir) => `${d} away, ${dir}`,
    adjoining: (dir) => `adjoining, ${dir}`,
    remove: (name) => `Remove ${name}`,
    restore: (name) => `Restore ${name}`,
    name: 'Name',
    heightField: 'Height above the base',
    heightHint: 'Up to the highest point of the roof (computed with a flat roof).',
    baseField: 'Base above the ground at the site',
    baseHint: 'Negative if the building stands lower than your own.',
    editedHint: 'Changed: in the laser scan this flat-roofed building replaces the measured one.',
    removedHint: 'Removed: no longer counts, not even in the laser scan (e.g. demolished).',
  },
};

/** Closer than this to the balcony (m), a building is «adjoining» (e.g. the neighbour part of a row house). */
const ADJOINING_M = 0.5;

export interface BuildingItemProps {
  building: Building;
  /** Display name (buildingName). */
  name: string;
  /** Placeholder of the name field (the fallback name). */
  fallbackName: string;
  own: boolean;
  bearing: BuildingBearing | null;
  open: boolean;
  onToggle: () => void;
  onChange: (partial: Partial<Pick<Building, 'name' | 'height' | 'base'>>) => void;
  /** Delete (manual) or mark removed (imported); for a removed building: restore. */
  onRemoveOrRestore: () => void;
  toggleRef?: Ref<HTMLButtonElement>;
}

/**
 * One surrounding building: collapsible header (name, badges, height, distance and direction from the
 * balcony) with delete/restore, and the editable name, height and base.
 */
export function BuildingItem({
  building,
  name,
  fallbackName,
  own,
  bearing,
  open,
  onToggle,
  onChange,
  onRemoveOrRestore,
  toggleRef,
}: BuildingItemProps) {
  const t = useMessages(messages);
  const f = useFormat();
  const lang = useLang();
  const id = useId();
  const L = LIMITS.neighbour;
  const m = (v: number): string => f.unit(v, 'm', Number.isInteger(v) ? 0 : 1);
  const removed = building.removed === true;
  const meta = [
    t.height(m(building.height)),
    building.base !== 0 ? t.base(m(building.base)) : null,
    bearing && !own
      ? bearing.distance < ADJOINING_M
        ? t.adjoining(compassPoint(bearing.azimuth, lang))
        : t.where(m(Math.round(bearing.distance)), compassPoint(bearing.azimuth, lang))
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const badges = [
    own ? t.own : null,
    building.source === 'manual' ? t.manual : null,
    building.edited ? t.edited : null,
    removed ? t.removed : null,
  ].filter((b): b is string => b !== null);

  return (
    <li
      className={styles.item}
      data-building={building.id}
      data-open={open || undefined}
      data-removed={removed || undefined}
    >
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
            <span className={styles.titleRow}>
              <span className={styles.name}>{name}</span>
              {badges.map((b) => (
                <span key={b} className={styles.badge}>
                  {b}
                </span>
              ))}
            </span>
            <span className={styles.meta}>{meta}</span>
          </span>
        </button>
        {/* One button for both actions: it keeps the focus when a removal turns it into «restore». */}
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon={removed ? <ResetIcon /> : <TrashIcon />}
          onClick={onRemoveOrRestore}
        >
          {removed ? t.restore(name) : t.remove(name)}
        </Button>
      </div>
      <fieldset id={`${id}-body`} className={styles.body} hidden={!open}>
        <legend className="sr-only">{name}</legend>
        {open && (
          <>
            {own && <p className={styles.hint}>{t.ownHint}</p>}
            {removed && <p className={styles.hint}>{t.removedHint}</p>}
            <TextField
              label={t.name}
              value={building.name}
              maxLength={MAX_TEXT_LENGTH}
              placeholder={fallbackName}
              onCommit={(v) => onChange({ name: v })}
            />
            <NumberField
              label={t.heightField}
              value={building.height}
              onChange={(v) => onChange({ height: v })}
              limit={L.height}
              sliderMax={80}
              unit="m"
              hint={t.heightHint}
              disabled={removed}
            />
            <NumberField
              label={t.baseField}
              value={building.base}
              onChange={(v) => onChange({ base: v })}
              limit={L.base}
              sliderMin={-20}
              sliderMax={30}
              unit="m"
              hint={t.baseHint}
              disabled={removed}
            />
            {building.edited && <p className={styles.hint}>{t.editedHint}</p>}
          </>
        )}
      </fieldset>
    </li>
  );
}
