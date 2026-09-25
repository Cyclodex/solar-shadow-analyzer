import { useId, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { DownloadIcon } from '../../components/icons';
import { requestBuildingImport } from '../../hooks/useBuildingImport';
import { useDsmActive } from '../../hooks/useSurfaceModel';
import { useFormat, useLang, useMessages, type Messages } from '../../i18n';
import { manualAnchor, rectFootprint, type FacadeRect } from '../../model/buildings';
import { SWISSTOPO_ATTRIBUTION } from '../../model/buildingSources';
import { facadeTransform } from '../../model/enu';
import { MAX_BUILDINGS, MAX_TOTAL_BUILDING_VERTICES } from '../../model/share';
import type { Building } from '../../model/types';
import { useBuildingImportStore } from '../../state/buildingImportStore';
import { useConfigSection, useConfigStore } from '../../state/configStore';
import { PlusIcon } from '../icons';
import { bearingFromSite, buildingName, newBuildingId, useSiteGeometry } from '../siteplan/buildingData';
import { AddBuildingForm } from './AddBuildingForm';
import { BuildingImportStatus } from './BuildingImportStatus';
import { BuildingItem } from './BuildingItem';
import styles from './BuildingList.module.css';

// ─────────────────────────────────────────────
// SURROUNDING BUILDINGS (owned by the buildings feature, docs/ARCHITECTURE.md "Umgebung")
// Import / re-import from swisstopo (count, date, attribution, progress, errors), the list of buildings
// (name, height, base, distance and direction from the balcony, delete/restore, edit) and manual entry.
// Reads and writes config.horizon.buildings / buildingImport itself; HorizonSection renders it without props.
// ─────────────────────────────────────────────

const de = {
  heading: 'Umgebungsgebäude',
  empty:
    'Noch keine Gebäude. Eine Adresse in der Schweiz oder in Liechtenstein unter «Standort» wählen: Die Gebäude der Umgebung werden dann von swisstopo geladen. Sie lassen sich auch um den eingestellten Standort laden oder von Hand erfassen.',
  summary: (n: number, manual: number) =>
    `${n === 1 ? '1 Gebäude' : `${n} Gebäude`}${manual > 0 ? `, davon ${manual} von Hand` : ''}`,
  source: (date: string) => (date ? `Quelle swisstopo, Stand ${date}` : 'Quelle swisstopo'),
  removedCount: (n: number) => `${n} entfernt`,
  inScan:
    'Der Laserscan enthält die importierten Gebäude bereits; zusätzlich zählen nur bearbeitete und von Hand erfasste.',
  prisms: 'Gebäude zählen als Prismen mit flachem Dach bis zum höchsten Punkt.',
  showList: (n: number) => `Liste (${n})`,
  showAll: (n: number) => `Alle ${n} anzeigen`,
  showFewer: 'Weniger anzeigen',
  load: 'Gebäude laden',
  reload: 'Neu laden',
  loadHint: (radius: string) => `Gebäude von swisstopo im Umkreis von ${radius} um den Standort.`,
  add: 'Gebäude hinzufügen',
  max: (n: number) => `Maximal ${n} Gebäude.`,
  added: (name: string) => `${name} hinzugefügt.`,
  removed: (name: string) => `${name} entfernt.`,
  restored: (name: string) => `${name} wiederhergestellt.`,
  attribution: (a: string) => `Gebäudegrundrisse und -höhen: ${a}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    heading: 'Surrounding buildings',
    empty:
      'No buildings yet. Choose an address in Switzerland or Liechtenstein under «Location»: the surrounding buildings are then loaded from swisstopo. They can also be loaded around the current location or entered by hand.',
    summary: (n, manual) =>
      `${n === 1 ? '1 building' : `${n} buildings`}${manual > 0 ? `, ${manual} entered by hand` : ''}`,
    source: (date) => (date ? `source swisstopo, as of ${date}` : 'source swisstopo'),
    removedCount: (n) => `${n} removed`,
    inScan:
      'The laser scan already contains the imported buildings; only edited and manually entered ones are added.',
    prisms: 'Buildings count as flat-roofed prisms up to their highest point.',
    showList: (n) => `List (${n})`,
    showAll: (n) => `Show all ${n}`,
    showFewer: 'Show fewer',
    load: 'Load buildings',
    reload: 'Reload',
    loadHint: (radius) => `swisstopo buildings within ${radius} of the location.`,
    add: 'Add building',
    max: (n) => `At most ${n} buildings.`,
    added: (name) => `${name} added.`,
    removed: (name) => `${name} removed.`,
    restored: (name) => `${name} restored.`,
    attribution: (a) => `Building footprints and heights: ${a}`,
  },
};

/** Buildings shown before «show all». */
export const LIST_PAGE = 20;

/**
 * Surrounding buildings of the «Horizont & Umgebung» section: summary (count, source, date, «contained in the
 * laser scan»), import status, a collapsible list sorted by distance from the balcony (own building first,
 * removed ones stay in place, restorable), load/reload from swisstopo and manual entry of a rectangle in the facade frame.
 */
export function BuildingList() {
  const t = useMessages(messages);
  const f = useFormat();
  const lang = useLang();
  // Sections, not the whole config: the list does not re-render while the tilt or the time changes.
  const horizon = useConfigSection('horizon');
  const location = useConfigSection('location');
  const building = useConfigSection('building');
  const setConfig = useConfigStore((s) => s.setConfig);
  const { buildings, buildingImport, surfaceModel } = horizon;
  const site = useSiteGeometry();
  const importing = useBuildingImportStore((s) => s.status === 'loading');
  const summary = useBuildingImportStore((s) => s.summary);

  const [listOpen, setListOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const pendingFocus = useRef<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const maxId = useId();

  const imported = buildings.filter((b) => b.source === 'swisstopo');
  const manualCount = buildings.filter((b) => b.source === 'manual').length;
  const shown = buildings.filter((b) => !b.removed).length;
  const removedCount = buildings.length - shown;
  const vertices = buildings.reduce((s, b) => s + b.footprint.length, 0);
  const full = buildings.length >= MAX_BUILDINGS || vertices + 4 > MAX_TOTAL_BUILDING_VERTICES;

  // Own building first, then by distance from the balcony (a removed building keeps its place: restorable).
  const rows = useMemo(() => {
    const list = buildings.map((b, index) => ({
      building: b,
      index,
      own: site.ownIds.has(b.id),
      bearing: bearingFromSite(b, site),
    }));
    return list.sort(
      (p, q) =>
        Number(q.own) - Number(p.own) ||
        (p.bearing?.distance ?? 0) - (q.bearing?.distance ?? 0) ||
        p.index - q.index,
    );
  }, [buildings, site]);
  const visible = showAll ? rows : rows.slice(0, LIST_PAGE);

  const setBuildings = (next: Building[]): void =>
    setConfig((c) => ({ ...c, horizon: { ...c.horizon, buildings: next } }));

  const patchBuilding = (b: Building, partial: Partial<Pick<Building, 'name' | 'height' | 'base'>>): void => {
    const geometry = partial.height !== undefined || partial.base !== undefined;
    setBuildings(
      buildings.map((x) =>
        x.id === b.id
          ? { ...x, ...partial, ...(geometry && x.source === 'swisstopo' ? { edited: true } : {}) }
          : x,
      ),
    );
  };

  const removeOrRestore = (b: Building, index: number): void => {
    const name = buildingName(b, index, lang);
    if (b.source === 'manual') {
      setBuildings(buildings.filter((x) => x.id !== b.id));
      setAnnouncement(t.removed(name));
      addRef.current?.focus();
    } else if (b.removed) {
      setBuildings(
        buildings.map((x) => {
          if (x.id !== b.id) return x;
          const { removed: _, ...rest } = x;
          void _;
          return rest;
        }),
      );
      setAnnouncement(t.restored(name));
    } else {
      setBuildings(buildings.map((x) => (x.id === b.id ? { ...x, removed: true } : x)));
      setAnnouncement(t.removed(name));
    }
  };

  const add = (rect: FacadeRect, height: number, base: number): void => {
    if (full) return;
    const anchor = manualAnchor(buildingImport, location);
    const footprint = rectFootprint(rect, facadeTransform(anchor, location, building.facadeAzimuth));
    const id = newBuildingId(buildings);
    const b: Building = { id, name: '', footprint, base, height, source: 'manual' };
    setConfig((c) => ({
      ...c,
      horizon: { ...c.horizon, buildings: [...c.horizon.buildings, b], buildingImport: anchor },
    }));
    setAdding(false);
    setListOpen(true);
    setShowAll(true);
    setOpenIds((prev) => new Set(prev).add(id));
    pendingFocus.current = id;
    setAnnouncement(t.added(buildingName(b, buildings.length, lang)));
  };

  const toggle = (id: string): void =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const load = (): void =>
    requestBuildingImport({ latitude: location.latitude, longitude: location.longitude, reason: 'manual' });

  const date = buildingImport?.date ? f.date(buildingImport.date) : '';
  const summaryLine = [
    t.summary(shown, manualCount),
    imported.length > 0 ? t.source(date) : null,
    removedCount > 0 ? t.removedCount(removedCount) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={styles.root}>
      <h4 className={styles.heading}>{t.heading}</h4>
      {buildings.length > 0 ? (
        <p className={styles.summary}>{summaryLine}</p>
      ) : (
        !importing && <p className={styles.empty}>{t.empty}</p>
      )}
      {buildings.length > 0 && <ModelHint scan={t.inScan} prisms={t.prisms} imported={imported.length > 0} />}

      <BuildingImportStatus />

      {buildings.length > 0 && (
        <>
          <button
            type="button"
            className={styles.listToggle}
            aria-expanded={listOpen}
            aria-controls={listId}
            onClick={() => setListOpen((o) => !o)}
          >
            <span className={styles.chevron} aria-hidden="true" />
            {t.showList(buildings.length)}
          </button>
          <div id={listId} hidden={!listOpen}>
            {listOpen && (
              <ul className={styles.list}>
                {visible.map(({ building: b, index, own, bearing }) => (
                  <BuildingItem
                    key={b.id}
                    building={b}
                    name={buildingName(b, index, lang)}
                    fallbackName={buildingName({ ...b, name: '' }, index, lang)}
                    own={own}
                    bearing={bearing}
                    open={openIds.has(b.id)}
                    onToggle={() => toggle(b.id)}
                    onChange={(partial) => patchBuilding(b, partial)}
                    onRemoveOrRestore={() => removeOrRestore(b, index)}
                    toggleRef={(el) => {
                      if (el && pendingFocus.current === b.id) {
                        pendingFocus.current = null;
                        el.focus();
                      }
                    }}
                  />
                ))}
              </ul>
            )}
            {listOpen && rows.length > LIST_PAGE && (
              <Button size="sm" variant="ghost" className={styles.more} onClick={() => setShowAll((v) => !v)}>
                {showAll ? t.showFewer : t.showAll(rows.length)}
              </Button>
            )}
          </div>
        </>
      )}

      <div className={styles.actions}>
        <Button
          size="sm"
          icon={<DownloadIcon />}
          onClick={() => !importing && load()}
          aria-disabled={importing || undefined}
          className={importing ? styles.unavailable : undefined}
        >
          {imported.length > 0 ? t.reload : t.load}
        </Button>
        {/* aria-disabled instead of disabled: stays focusable (focus target after removing a building). */}
        <Button
          ref={addRef}
          size="sm"
          icon={<PlusIcon />}
          aria-expanded={adding}
          aria-disabled={full || undefined}
          aria-describedby={full ? maxId : undefined}
          className={full ? styles.unavailable : undefined}
          onClick={() => !full && setAdding((a) => !a)}
        >
          {t.add}
        </Button>
        {full && (
          <span id={maxId} className={styles.hint}>
            {t.max(MAX_BUILDINGS)}
          </span>
        )}
      </div>
      <p className={styles.hint}>{t.loadHint(f.unit(surfaceModel.radius, 'm'))}</p>
      {adding && (
        <AddBuildingForm
          onAdd={add}
          onCancel={() => {
            setAdding(false);
            addRef.current?.focus();
          }}
        />
      )}
      {imported.length > 0 && (
        <p className={styles.source}>{t.attribution(summary?.attribution ?? SWISSTOPO_ATTRIBUTION)}</p>
      )}
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </div>
  );
}

/**
 * How the buildings count: «contained in the laser scan» while it is active (imported ones then only mask
 * it), else as prisms. Its own component: useDsmActive needs the whole config (site key).
 */
function ModelHint({ scan, prisms, imported }: { scan: string; prisms: string; imported: boolean }) {
  const config = useConfigStore((s) => s.config);
  const dsmActive = useDsmActive(config);
  return <p className={styles.hint}>{dsmActive && imported ? scan : prisms}</p>;
}
