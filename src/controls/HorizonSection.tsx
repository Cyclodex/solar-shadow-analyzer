import { Section } from '../components/Section';
import { Toggle } from '../components/Toggle';
import { useMessages, type Messages } from '../i18n';
import { useConfigSection, usePatch } from '../state/configStore';
import { HorizonSparkline } from './horizon/HorizonSparkline';
import { ManualHorizon } from './horizon/ManualHorizon';
import { ObstacleList } from './horizon/ObstacleList';
import { TerrainStatus } from './horizon/TerrainStatus';
import sections from './sections.module.css';
import styles from './HorizonSection.module.css';

const de = {
  title: 'Horizont & Umgebung',
  terrain: 'Geländehorizont berechnen',
  terrainHint: 'Aus einem digitalen Höhenmodell (Terrain Tiles), Sichtweite bis ca. 50 km.',
  summaryTerrain: 'Gelände',
  summaryObstacles: (n: number) => (n === 1 ? '1 Hindernis' : `${n} Hindernisse`),
  summaryPoints: (n: number) => (n === 1 ? '1 Punkt' : `${n} Punkte`),
  summaryFree: 'Freie Sicht',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Horizon & surroundings',
    terrain: 'Compute terrain horizon',
    terrainHint: 'From a digital elevation model (Terrain Tiles), visibility up to about 50 km.',
    summaryTerrain: 'Terrain',
    summaryObstacles: (n) => (n === 1 ? '1 obstacle' : `${n} obstacles`),
    summaryPoints: (n) => (n === 1 ? '1 point' : `${n} points`),
    summaryFree: 'Open view',
  },
};

/** Terrain horizon (toggle + load state), horizon chart, obstacles and custom horizon points. */
export function HorizonSection() {
  const t = useMessages(messages);
  const horizon = useConfigSection('horizon');
  const patch = usePatch();
  const { terrainEnabled, obstacles, manual } = horizon;

  const summary =
    [
      terrainEnabled ? t.summaryTerrain : null,
      obstacles.length > 0 ? t.summaryObstacles(obstacles.length) : null,
      manual.length > 0 ? t.summaryPoints(manual.length) : null,
    ]
      .filter(Boolean)
      .join(' · ') || t.summaryFree;

  return (
    <Section level={3} id="horizon" title={t.title} summary={summary}>
      <div className={sections.group}>
        <Toggle
          label={t.terrain}
          checked={terrainEnabled}
          onChange={(v) => patch('horizon', { terrainEnabled: v })}
          hint={t.terrainHint}
        />
        {terrainEnabled && <TerrainStatus />}
      </div>
      <div className={styles.chart}>
        <HorizonSparkline />
      </div>
      <ObstacleList />
      <ManualHorizon />
    </Section>
  );
}
