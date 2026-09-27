import { useRef } from 'react';
import { Button } from '../../components/Button';
import { SelectField } from '../../components/SelectField';
import { Toggle } from '../../components/Toggle';
import { cssVars } from '../../components/cssVars';
import { ResetIcon } from '../../components/icons';
import { useFormat, useMessages, type Messages } from '../../i18n';
import { LIMITS } from '../../model/defaults';
import { estimateDsmBytes } from '../../model/dsmEstimate';
import { dsmMaskPolygons } from '../../model/surroundings';
import type { SurfaceModelConfig } from '../../model/types';
import { useConfigSection, usePatch } from '../../state/configStore';
import { useDataStore } from '../../state/dataStore';
import { useSurfaceRefresh } from '../../hooks/useSurfaceModel';
import { LoadErrorDetails } from '../LoadErrorDetails';
import { WaitingAction } from '../location/PlacementPrompt';
import { usePlacementNeed } from '../location/placementNeed';
import sections from '../sections.module.css';
import styles from './SurfaceModelControls.module.css';

// ─────────────────────────────────────────────
// LASER-SCAN SETTINGS
// docs/ARCHITECTURE.md, "Umgebung": toggle «Laserscan-Umgebung (swisstopo)», load state (progress with MB,
// data year, error with retry, «nur in der Schweiz und Liechtenstein verfügbar», partial coverage at the
// border, a reload of the data for new tilts or floors with its own progress or error), «Bäume berücksichtigen»
// (trees opaque all year) and the traced radius with its estimated download (model/dsmEstimate.ts
// estimateDsmBytes). Reads config.horizon.surfaceModel, dataStore.surface and useSurfaceRefresh itself.
// ─────────────────────────────────────────────

const de = {
  toggle: 'Laserscan-Umgebung (swisstopo)',
  hint: 'Gebäude und Bäume aus dem Oberflächenmodell swissSURFACE3D (0.5 m) als Horizont je Stockwerk. Nur Schweiz und Liechtenstein.',
  starting: 'Laserscan wird geladen …',
  loading: (mb: string, pct: string) => `Laserscan wird geladen … ${mb} (${pct})`,
  progress: 'Fortschritt Laserscan',
  ready: 'Laserscan geladen',
  years: (years: string) => `Datenstand ${years}`,
  size: (mb: string) => `${mb} Daten`,
  coverage: (pct: string) =>
    `Der Laserscan deckt nur ${pct} des Umkreises ab: Ausserhalb der Schweiz und Liechtensteins fehlen Gebäude und Bäume.`,
  unavailable: 'Laserscan nur in der Schweiz und Liechtenstein verfügbar.',
  error: 'Der Laserscan konnte nicht geladen werden.',
  fallbackBuildings:
    'Es wird ohne Laserscan gerechnet: Die Umgebungsgebäude zählen als Gebäude mit flachem Dach.',
  fallbackNone: 'Es wird ohne Laserscan gerechnet.',
  retry: 'Erneut versuchen',
  waiting:
    'Der Laserscan wartet auf den Lageplan: Der Standort liegt noch im eigenen Gebäude (etwa am Adresspunkt), von dort sähe er nur dieses. Nach «Übernehmen» von Fassade und Balkon im Abschnitt «Gebäude» wird er für diese Stelle geladen; bis dahin zählen die Umgebungsgebäude als Gebäude mit flachem Dach, ohne das eigene.',
  waitingBuildings:
    'Der Laserscan wartet auf die Gebäude der Umgebung: Der Standort ist noch der Adresspunkt im Gebäude, von dort sähe er nur dieses. Sind die Gebäude geladen, im Lageplan Fassade und Balkon übernehmen; dann wird er für diese Stelle geladen.',
  refreshStarting: 'Laserscan wird nachgeladen …',
  refreshing: (mb: string, pct: string) => `Laserscan wird nachgeladen … ${mb} (${pct})`,
  refreshHint:
    'Für neue Neigungen oder Stockwerke gilt bis dahin der Horizont der nächstgelegenen berechneten Panelreihe.',
  refreshError:
    'Der Laserscan konnte nicht nachgeladen werden. Für neue Neigungen oder Stockwerke gilt der Horizont der nächstgelegenen berechneten Panelreihe.',
  trees: 'Bäume berücksichtigen',
  treesHint: 'Bäume werden ganzjährig als blickdicht angenommen (Befliegung meist ohne Laub).',
  buildingsOnly: 'Aus: nur Gebäude; alles ausserhalb der Gebäudegrundrisse wird zu Boden.',
  radius: 'Umkreis',
  radiusOption: (m: string, mb: string) => `${m} (ca. ${mb})`,
  radiusHint:
    'Datenmenge geschätzt (mittlere Kachelgrösse in Bern). Hügel und Berge weiter weg liefert der Geländehorizont.',
  attribution: 'Daten: © swisstopo (swissSURFACE3D Raster, swissALTI3D)',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    toggle: 'Laser-scan surroundings (swisstopo)',
    hint: 'Buildings and trees from the swissSURFACE3D surface model (0.5 m) as horizon per floor. Switzerland and Liechtenstein only.',
    starting: 'Loading laser scan …',
    loading: (mb, pct) => `Loading laser scan … ${mb} (${pct})`,
    progress: 'Laser scan progress',
    ready: 'Laser scan loaded',
    years: (years) => `Data from ${years}`,
    size: (mb) => `${mb} of data`,
    coverage: (pct) =>
      `The laser scan covers only ${pct} of the radius: buildings and trees outside Switzerland and Liechtenstein are missing.`,
    unavailable: 'Laser scan only available in Switzerland and Liechtenstein.',
    error: 'The laser scan could not be loaded.',
    fallbackBuildings:
      'Calculating without the laser scan: the surrounding buildings count as flat-roofed buildings.',
    fallbackNone: 'Calculating without the laser scan.',
    retry: 'Try again',
    waiting:
      'The laser scan waits for the site plan: the location still lies inside the own building (e.g. at the address point), from where it would see nothing but that building. Once facade and balcony are applied in the «Building» section it loads for that spot; until then the surrounding buildings count as flat-roofed buildings, without the own one.',
    waitingBuildings:
      'The laser scan waits for the surrounding buildings: the location is still the address point inside the building, from where it would see nothing but that building. Once the buildings are loaded, apply facade and balcony in the site plan; then it loads for that spot.',
    refreshStarting: 'Reloading the laser scan …',
    refreshing: (mb, pct) => `Reloading the laser scan … ${mb} (${pct})`,
    refreshHint: 'Until then, new tilts or floors use the horizon of the nearest computed panel row.',
    refreshError:
      'The laser scan could not be reloaded. New tilts or floors use the horizon of the nearest computed panel row.',
    trees: 'Include trees',
    treesHint: 'Trees are assumed to be opaque all year (scans are mostly flown without leaves).',
    buildingsOnly: 'Off: buildings only; everything outside building footprints becomes ground.',
    radius: 'Radius',
    radiusOption: (m, mb) => `${m} (approx. ${mb})`,
    radiusHint:
      'Estimated data volume (mean tile size in Bern). Hills and mountains farther away come from the terrain horizon.',
    attribution: 'Data: © swisstopo (swissSURFACE3D Raster, swissALTI3D)',
  },
};

/** Radii offered (LIMITS.surfaceModel.radius: 150–500 m in 50 m steps). */
const RADII = (() => {
  const { min, max, step } = LIMITS.surfaceModel.radius;
  const out: number[] = [];
  for (let r = min; r <= max; r += step) out.push(r);
  return out;
})();

/** Progress of a laser-scan download: label with MB and percent, and the bar. */
function LoadProgress({ progress, bytes, refresh }: { progress: number; bytes: number; refresh: boolean }) {
  const t = useMessages(messages);
  const f = useFormat();
  const pct = Math.round(progress * 100);
  const mb = f.unit(bytes / 1e6, 'MB', 1);
  const label = refresh
    ? bytes > 0
      ? t.refreshing(mb, f.pct(pct))
      : t.refreshStarting
    : bytes > 0
      ? t.loading(mb, f.pct(pct))
      : t.starting;
  return (
    <div className={styles.loading}>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      <div
        className={styles.bar}
        role="progressbar"
        aria-label={t.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${f.pct(pct)}, ${mb}`}
        style={cssVars({ '--progress': progress })}
      >
        <span className={styles.fill} />
      </div>
      {refresh && <p className={styles.note}>{t.refreshHint}</p>}
    </div>
  );
}

/**
 * Load state of the laser scan: progress, error with retry, outside coverage, or data year and size; while
 * the shown site's data loads again for new tilts or floors (useSurfaceRefresh), that progress or its error.
 */
function SurfaceStatus({ hasBuildings }: { hasBuildings: boolean }) {
  const statusRef = useRef<HTMLDivElement>(null);
  const retrySurface = useDataStore((s) => s.retrySurface);
  // «Erneut versuchen» unmounts with its error block: the focus moves to the status (the progress next).
  const retry = (): void => {
    retrySurface();
    statusRef.current?.focus({ preventScroll: true });
  };
  return (
    <div ref={statusRef} tabIndex={-1} className={styles.status}>
      <SurfaceStatusContent hasBuildings={hasBuildings} retry={retry} />
    </div>
  );
}

function SurfaceStatusContent({ hasBuildings, retry }: { hasBuildings: boolean; retry: () => void }) {
  const t = useMessages(messages);
  const f = useFormat();
  const surface = useDataStore((s) => s.surface);
  const refresh = useSurfaceRefresh();
  const need = usePlacementNeed();
  const mb = (bytes: number): string => f.unit(bytes / 1e6, 'MB', 1);

  if (surface.status === 'loading') {
    return <LoadProgress progress={surface.progress} bytes={surface.bytes} refresh={false} />;
  }
  if (refresh?.status === 'loading') {
    return <LoadProgress progress={refresh.progress} bytes={refresh.bytes} refresh />;
  }
  if (surface.status === 'error') {
    return (
      <div className={styles.error} role="alert">
        <p>
          {t.error} {hasBuildings ? t.fallbackBuildings : t.fallbackNone}
        </p>
        <LoadErrorDetails error={surface.error} />
        <div>
          <Button size="sm" icon={<ResetIcon />} onClick={retry}>
            {t.retry}
          </Button>
        </div>
      </div>
    );
  }
  if (surface.status === 'unavailable') {
    return (
      <p className={styles.note} role="status">
        {t.unavailable}
      </p>
    );
  }
  if (surface.status === 'waiting') {
    return (
      <div className={`${styles.note} ${styles.waiting}`} role="status">
        <p>{need === 'plan' ? t.waiting : t.waitingBuildings}</p>
        <WaitingAction />
      </div>
    );
  }
  if (surface.status === 'ready') {
    const partial = surface.coverage !== null && surface.coverage < 0.999;
    return (
      <>
        <div className={styles.ready} role="status">
          <p className={styles.facts}>
            <span className={styles.ok}>{t.ready}</span>
            {surface.dataYears.length > 0 && <span>{t.years(surface.dataYears.join(', '))}</span>}
            {surface.bytes > 0 && <span>{t.size(mb(surface.bytes))}</span>}
          </p>
          {partial && (
            <p className={styles.note}>{t.coverage(f.pct(Math.round((surface.coverage ?? 0) * 100)))}</p>
          )}
        </div>
        {refresh?.status === 'error' && (
          <div className={styles.error} role="alert">
            <p>{t.refreshError}</p>
            <LoadErrorDetails error={refresh.error} />
            <div>
              <Button size="sm" icon={<ResetIcon />} onClick={retry}>
                {t.retry}
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }
  return null;
}

/** Laser-scan horizon settings and status in the «Horizont & Umgebung» section. */
export function SurfaceModelControls() {
  const t = useMessages(messages);
  const f = useFormat();
  const horizon = useConfigSection('horizon');
  const patch = usePatch();
  const model = horizon.surfaceModel;
  const set = (partial: Partial<SurfaceModelConfig>): void =>
    patch('horizon', { surfaceModel: { ...model, ...partial } });
  const masks = dsmMaskPolygons(horizon.buildings).length > 0;
  const estimate = (radius: number): string =>
    f.unit(
      estimateDsmBytes(radius, { ground: masks || !model.trees, vectorTiles: !model.trees }) / 1e6,
      'MB',
      1,
    );

  return (
    <div className={sections.group}>
      <Toggle
        label={t.toggle}
        checked={model.enabled}
        onChange={(enabled) => set({ enabled })}
        hint={t.hint}
      />
      {model.enabled && (
        <>
          <SurfaceStatus hasBuildings={horizon.buildings.some((b) => !b.removed)} />
          <Toggle
            label={t.trees}
            checked={model.trees}
            onChange={(trees) => set({ trees })}
            hint={model.trees ? t.treesHint : `${t.treesHint} ${t.buildingsOnly}`}
          />
          <SelectField
            label={t.radius}
            value={String(model.radius)}
            options={RADII.map((r) => ({
              value: String(r),
              label: t.radiusOption(f.unit(r, 'm'), estimate(r)),
            }))}
            onChange={(v) => set({ radius: Number(v) })}
            hint={t.radiusHint}
          />
          <p className={styles.attribution}>{t.attribution}</p>
        </>
      )}
    </div>
  );
}
