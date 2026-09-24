import { useId, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { useFloorPlacements, useFocusFloor } from '../../hooks/useModel';
import { floorLabel, useLang, useMessages, type Messages } from '../../i18n';
import { createObstacle } from '../../model/defaults';
import { MAX_OBSTACLES } from '../../model/share';
import type { Obstacle } from '../../model/types';
import { useConfigSection, usePatch } from '../../state/configStore';
import { obstacleName } from './horizonData';
import { PlusIcon } from '../icons';
import { ObstacleItem } from './ObstacleItem';
import styles from './ObstacleList.module.css';

const de = {
  heading: 'Hindernisse',
  intro: 'Nachbargebäude oder Bäume als Quader vor der Fassade. Sie verdecken tiefstehende Sonne.',
  empty: 'Keine Hindernisse erfasst.',
  add: 'Hindernis hinzufügen',
  max: (n: number) => `Maximal ${n} Hindernisse.`,
  added: (name: string) => `${name} hinzugefügt.`,
  removed: (name: string) => `${name} entfernt.`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    heading: 'Obstacles',
    intro: 'Neighbouring buildings or trees as boxes in front of the facade. They block the low sun.',
    empty: 'No obstacles yet.',
    add: 'Add obstacle',
    max: (n) => `At most ${n} obstacles.`,
    added: (name) => `${name} added.`,
    removed: (name) => `${name} removed.`,
  },
};

/** Unused id "o<n>" (same scheme as sanitizeConfig). */
function newObstacleId(existing: readonly Obstacle[]): string {
  let i = existing.length + 1;
  while (existing.some((o) => o.id === `o${i}`)) i++;
  return `o${i}`;
}

/**
 * Obstacle editor: collapsible items (name, position, size), add (up to MAX_OBSTACLES) and remove.
 * A new obstacle opens and receives focus; after removing, focus moves to the add button.
 */
export function ObstacleList() {
  const t = useMessages(messages);
  const lang = useLang();
  const { obstacles } = useConfigSection('horizon');
  const facadeAzimuth = useConfigSection('building').facadeAzimuth;
  const patch = usePatch();
  const placements = useFloorPlacements();
  const focus = useFocusFloor();
  const placement = placements[focus] ?? null;
  const floorName = placement ? floorLabel(placement.storey, lang) : '–';

  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');
  /** Id of a just added obstacle: its toggle button takes the focus when it mounts. */
  const pendingFocus = useRef<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const full = obstacles.length >= MAX_OBSTACLES;
  const maxId = useId();

  const setObstacles = (next: Obstacle[]): void => patch('horizon', { obstacles: next });

  const add = (): void => {
    if (full) return;
    const id = newObstacleId(obstacles);
    const name = obstacleName(createObstacle(id, ''), obstacles.length, lang);
    pendingFocus.current = id;
    setObstacles([...obstacles, createObstacle(id, name)]);
    setOpenIds((prev) => new Set(prev).add(id));
    setAnnouncement(t.added(name));
  };

  const remove = (o: Obstacle, index: number): void => {
    setObstacles(obstacles.filter((x) => x.id !== o.id));
    setAnnouncement(t.removed(obstacleName(o, index, lang)));
    addRef.current?.focus();
  };

  const toggle = (id: string): void =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className={styles.root}>
      <h4 className={styles.heading}>{t.heading}</h4>
      <p className={styles.hint}>{t.intro}</p>
      {obstacles.length > 0 ? (
        <ul className={styles.list}>
          {obstacles.map((o, i) => (
            <ObstacleItem
              key={o.id}
              obstacle={o}
              index={i}
              open={openIds.has(o.id)}
              onToggle={() => toggle(o.id)}
              onChange={(partial) =>
                setObstacles(obstacles.map((x) => (x.id === o.id ? { ...x, ...partial } : x)))
              }
              onRemove={() => remove(o, i)}
              observer={placement?.center ?? null}
              floorName={floorName}
              facadeAzimuth={facadeAzimuth}
              toggleRef={(el) => {
                if (el && pendingFocus.current === o.id) {
                  pendingFocus.current = null;
                  el.focus();
                }
              }}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{t.empty}</p>
      )}
      <div className={styles.actions}>
        {/* aria-disabled instead of disabled: stays focusable (focus target after removing an item). */}
        <Button
          ref={addRef}
          size="sm"
          icon={<PlusIcon />}
          aria-disabled={full || undefined}
          aria-describedby={full ? maxId : undefined}
          className={full ? styles.unavailable : undefined}
          onClick={add}
        >
          {t.add}
        </Button>
        {full && (
          <span id={maxId} className={styles.hint}>
            {t.max(MAX_OBSTACLES)}
          </span>
        )}
      </div>
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </div>
  );
}
