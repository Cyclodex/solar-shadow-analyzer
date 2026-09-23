import { Button } from '../components/Button';
import { NumberField } from '../components/NumberField';
import { Section } from '../components/Section';
import { Spinner } from '../components/Spinner';
import { Toggle } from '../components/Toggle';
import { useFormat, useMessages, type Messages } from '../i18n';
import { LIMITS, createObstacle } from '../model/defaults';
import { MAX_OBSTACLES } from '../model/share';
import type { Obstacle } from '../model/types';
import { useConfigSection, usePatch } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import styles from './sections.module.css';

const de = {
  title: 'Horizont & Umgebung',
  terrain: 'Geländehorizont berechnen',
  terrainHint: 'Aus einem digitalen Höhenmodell (Terrain Tiles), Sichtweite bis ca. 50 km.',
  terrainLoading: (pct: string) => `Wird geladen … ${pct}`,
  terrainReady: (max: string) => `Geladen, höchster Geländewinkel ${max}`,
  terrainError: 'Konnte nicht geladen werden – es wird ohne Gelände gerechnet.',
  obstacles: 'Hindernisse (Nachbargebäude)',
  obstacleName: (n: number) => `Hindernis ${n}`,
  add: 'Hindernis hinzufügen',
  remove: (name: string) => `${name} entfernen`,
  offsetAlong: 'Versatz entlang der Fassade',
  offsetHint: '+ = rechts, von aussen auf die Fassade gesehen',
  distance: 'Abstand zur Fassade',
  width: 'Breite',
  depth: 'Tiefe',
  height: 'Höhe über Boden',
  manual: 'Eigene Horizontpunkte',
  manualCount: (n: number) => `${n} Punkte geladen`,
  manualNone: 'Keine eigenen Horizontpunkte.',
  clearManual: 'Horizontpunkte entfernen',
  summaryTerrain: 'Gelände',
  summaryObstacles: (n: number) => `${n} Hindernis${n === 1 ? '' : 'se'}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Horizon & surroundings',
    terrain: 'Compute terrain horizon',
    terrainHint: 'From a digital elevation model (Terrain Tiles), visibility up to about 50 km.',
    terrainLoading: (pct) => `Loading … ${pct}`,
    terrainReady: (max) => `Loaded, highest terrain angle ${max}`,
    terrainError: 'Could not be loaded – calculating without terrain.',
    obstacles: 'Obstacles (neighbouring buildings)',
    obstacleName: (n) => `Obstacle ${n}`,
    add: 'Add obstacle',
    remove: (name) => `Remove ${name}`,
    offsetAlong: 'Offset along the facade',
    offsetHint: '+ = right, seen from outside facing the facade',
    distance: 'Distance from the facade',
    width: 'Width',
    depth: 'Depth',
    height: 'Height above ground',
    manual: 'Custom horizon points',
    manualCount: (n) => `${n} points loaded`,
    manualNone: 'No custom horizon points.',
    clearManual: 'Remove horizon points',
    summaryTerrain: 'Terrain',
    summaryObstacles: (n) => `${n} obstacle${n === 1 ? '' : 's'}`,
  },
};

function newObstacleId(existing: readonly Obstacle[]): string {
  let i = existing.length + 1;
  while (existing.some((o) => o.id === `o${i}`)) i++;
  return `o${i}`;
}

/** Terrain horizon, obstacles, custom horizon points. (Basic version.) */
export function HorizonSection() {
  const t = useMessages(messages);
  const f = useFormat();
  const horizon = useConfigSection('horizon');
  const patch = usePatch();
  const terrain = useDataStore((s) => s.terrain);
  const L = LIMITS.obstacle;
  const { obstacles } = horizon;

  const updateObstacle = (id: string, partial: Partial<Obstacle>): void =>
    patch('horizon', { obstacles: obstacles.map((o) => (o.id === id ? { ...o, ...partial } : o)) });

  const summary = [horizon.terrainEnabled ? t.summaryTerrain : null, t.summaryObstacles(obstacles.length)]
    .filter(Boolean)
    .join(' · ');

  let terrainStatus = null;
  if (horizon.terrainEnabled) {
    if (terrain.status === 'loading') {
      terrainStatus = <Spinner size="sm" showLabel label={t.terrainLoading(f.pct(terrain.progress * 100))} />;
    } else if (terrain.status === 'ready' && terrain.profile) {
      terrainStatus = <span>{t.terrainReady(f.deg(Math.max(...terrain.profile.elevations), 1))}</span>;
    } else if (terrain.status === 'error') {
      terrainStatus = <span className={styles.statusError}>{t.terrainError}</span>;
    }
  }

  return (
    <Section id="horizon" title={t.title} summary={summary}>
      <div className={styles.group}>
        <Toggle
          label={t.terrain}
          checked={horizon.terrainEnabled}
          onChange={(terrainEnabled) => patch('horizon', { terrainEnabled })}
          hint={t.terrainHint}
        />
        {terrainStatus && <div className={styles.status}>{terrainStatus}</div>}
      </div>

      <div className={styles.group}>
        <h3 className={styles.subheading}>{t.obstacles}</h3>
        {obstacles.map((o, i) => (
          <fieldset key={o.id} className={styles.item}>
            <legend className="sr-only">{o.name || t.obstacleName(i + 1)}</legend>
            <div className={styles.itemHead}>
              <span className={styles.subheading} aria-hidden="true">
                {o.name || t.obstacleName(i + 1)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => patch('horizon', { obstacles: obstacles.filter((x) => x.id !== o.id) })}
              >
                {t.remove(o.name || t.obstacleName(i + 1))}
              </Button>
            </div>
            <NumberField
              label={t.offsetAlong}
              value={o.offsetAlong}
              onChange={(v) => updateObstacle(o.id, { offsetAlong: v })}
              limit={L.offsetAlong}
              unit="m"
              hint={t.offsetHint}
            />
            <NumberField
              label={t.distance}
              value={o.distance}
              onChange={(v) => updateObstacle(o.id, { distance: v })}
              limit={L.distance}
              unit="m"
            />
            <NumberField
              label={t.width}
              value={o.width}
              onChange={(v) => updateObstacle(o.id, { width: v })}
              limit={L.width}
              unit="m"
            />
            <NumberField
              label={t.depth}
              value={o.depth}
              onChange={(v) => updateObstacle(o.id, { depth: v })}
              limit={L.depth}
              unit="m"
            />
            <NumberField
              label={t.height}
              value={o.height}
              onChange={(v) => updateObstacle(o.id, { height: v })}
              limit={L.height}
              unit="m"
            />
          </fieldset>
        ))}
        <div className={styles.actions}>
          <Button
            size="sm"
            disabled={obstacles.length >= MAX_OBSTACLES}
            onClick={() =>
              patch('horizon', {
                obstacles: [
                  ...obstacles,
                  createObstacle(newObstacleId(obstacles), t.obstacleName(obstacles.length + 1)),
                ],
              })
            }
          >
            {t.add}
          </Button>
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.subheading}>{t.manual}</h3>
        <p className={styles.hint}>
          {horizon.manual.length > 0 ? t.manualCount(horizon.manual.length) : t.manualNone}
        </p>
        {horizon.manual.length > 0 && (
          <div className={styles.actions}>
            <Button size="sm" variant="danger" onClick={() => patch('horizon', { manual: [] })}>
              {t.clearManual}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
