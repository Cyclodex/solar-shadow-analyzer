import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { CheckIcon, DownloadIcon } from '../../components/icons';
import { NumberField } from '../../components/NumberField';
import { SelectField } from '../../components/SelectField';
import { Toggle } from '../../components/Toggle';
import { useLayout } from '../../hooks/useModel';
import { compassPoint, useFormat, useLang, useMessages, type Messages } from '../../i18n';
import { requestBuildingImport } from '../../hooks/useBuildingImport';
import { anchorDistance, buildingBearing, OTHER_SITE_DISTANCE } from '../../model/buildings';
import type { Vertex } from '../../model/polygon';
import type { Building } from '../../model/types';
import { cmToM } from '../../model/units';
import { clearAddressPoint, isAddressAnchor, useAddressPointStore } from '../../state/addressPointStore';
import { requestBuildingFocus, useBuildingImportStore } from '../../state/buildingImportStore';
import { useConfigSection, useConfigStore } from '../../state/configStore';
import { useUiStore } from '../../state/uiStore';
import { useTimeStore } from '../../state/timeStore';
import sections from '../sections.module.css';
import { buildingName, useSiteGeometry } from './buildingData';
import { hasScrollAnchoring, holdInView } from './holdInView';
import { SitePlanMap, type MapBuilding } from './SitePlanMap';
import { useSun } from './useSun';
import {
  alongRange,
  clampAlong,
  currentPlacement,
  ownBuildingChoices,
  ownFacadeEdges,
  placementConfig,
  placementPoint,
  samePlacement,
  sitePlanOwnBuilding,
  suggestedPlacement,
  type Placement,
} from './sitePlanModel';
import styles from './SitePlan.module.css';

// ─────────────────────────────────────────────
// SITE PLAN «Lageplan» (owned by the buildings feature, docs/ARCHITECTURE.md "Umgebung")
// SVG top view of the stored buildings to confirm the facade and the balcony: tap an exterior edge of the own
// building (its outward normal → building.facadeAzimuth), then tap or drag along it (→ config.location, the
// facade origin, 1e-6°); keyboard/screen-reader alternative: facade list + «Position entlang der Fassade».
// Choices are a draft until «Übernehmen» (a new location reloads weather, terrain and laser scan). Opens by
// itself after an import (buildingImportStore.sitePlanRequest). Reads the stores itself; SitePlan.tsx loads it
// on first use and renders it without props.
// ─────────────────────────────────────────────

const de = {
  title: 'Lageplan',
  placed: (az: string, dir: string) => `Balkon an der Fassade ${az} ${dir} des eigenen Gebäudes.`,
  notPlaced:
    'Der Standort liegt noch nicht auf einer Fassade des eigenen Gebäudes: im Lageplan die Fassade mit dem Balkon wählen.',
  noOwn:
    'Kein eigenes Gebäude erkannt: im Lageplan unter «Eigenes Gebäude» wählen oder das Gebäude antippen und «Das ist mein Gebäude» wählen.',
  manualOnly:
    'Nur von Hand erfasste Gebäude: Fassade und Balkon lassen sich auf Gebäuden wählen, die von swisstopo geladen wurden.',
  otherSite: (distance: string) =>
    `Die gespeicherten Gebäude gehören zu einem anderen Ort: Sie liegen ${distance} vom Standort entfernt.`,
  loadHere: 'Gebäude um den Standort laden',
  loading: 'Gebäude werden geladen …',
  ownBuilding: 'Eigenes Gebäude',
  ownChoose: 'Gebäude wählen',
  ownOption: (name: string, where: string) => `${name} · ${where}`,
  ownHint: 'Importierte Gebäude bis 25 m vom Standort und die angrenzenden.',
  atLocation: 'am Standort',
  guide:
    'Fassade und Balkon bestätigen: im Plan die Fassade mit dem Balkon antippen oder anklicken (blau), dann die Stelle des Balkons darauf; der Punkt lässt sich entlang der Fassade ziehen. Gepunktete Kanten sind Brandmauern. Zum Schluss «Übernehmen».',
  map: 'Lageplan, Norden oben',
  help: 'Auf Touchscreens scrollt ein Finger die Seite, seitwärts ziehen verschiebt den Plan, zwei Finger zoomen. Maus: ziehen verschiebt, Strg + Mausrad zoomt. Tastatur: Pfeiltasten verschieben, Plus und Minus zoomen, 0 zentriert. Fassade und Balkon auch mit der Auswahl darunter.',
  zoomIn: 'Vergrössern',
  zoomOut: 'Verkleinern',
  recenter: 'Plan zentrieren',
  wheelHint: 'Zum Zoomen Strg (Mac: ⌘) gedrückt halten oder die Knöpfe verwenden',
  north: 'N',
  location: 'Bisheriger Standort',
  address: 'Adresse',
  description: (own: string, facade: string, neighbours: number) =>
    `${own} ${facade} ${neighbours === 1 ? '1 weiteres Gebäude' : `${neighbours} weitere Gebäude`} im Plan.`,
  ownKnown: (name: string) => `Eigenes Gebäude: ${name}.`,
  facadeShown: (az: string, dir: string, along: string) =>
    `Balkon an der Fassade ${az} ${dir}, ${along} von der linken Ecke.`,
  facadeNone: 'Keine Fassade gewählt.',
  facade: 'Fassade mit dem Balkon',
  facadeOption: (az: string, dir: string, length: string) => `${az} ${dir} · ${length} lang`,
  facadeChoose: 'Fassade wählen',
  along: 'Position entlang der Fassade',
  alongHint: 'Mitte der Panelreihen, von der linken Ecke aus (von aussen gesehen).',
  partyWalls: (n: number) =>
    n === 1 ? '1 Brandmauer ist nicht wählbar.' : `${n} Brandmauern sind nicht wählbar.`,
  partyTapped: 'Brandmauer: grenzt an ein anderes Gebäude und ist nicht als Fassade wählbar.',
  noFacade: 'Dieses Gebäude hat keine wählbare Fassade (alle Kanten sind Brandmauern oder kürzer als 2 m).',
  apply: 'Übernehmen',
  discard: 'Verwerfen',
  pending: 'Noch nicht übernommen: Standort und Fassadenazimut ändern sich erst mit «Übernehmen».',
  applied: (az: string, dir: string) => `Standort auf die Fassade ${az} ${dir} gesetzt.`,
  opened: 'Lageplan geöffnet: Fassade und Balkon bestätigen.',
  sun: 'Sonnenrichtung zur gewählten Zeit',
  legend: 'Legende',
  legendOwn: 'Eigenes Gebäude',
  legendFacade: 'wählbare Fassade',
  legendParty: 'Brandmauer',
  legendBalcony: 'Balkon und Panelreihe',
  legendNeighbour: 'Umgebungsgebäude',
  legendEdited: 'bearbeitet',
  legendManual: 'von Hand',
  legendRemoved: 'entfernt',
  legendSun: 'Sonne',
  own: 'Eigenes Gebäude',
  manual: 'von Hand',
  edited: 'bearbeitet',
  removed: 'entfernt',
  height: (h: string) => `${h} hoch`,
  base: (b: string) => `Basis ${b}`,
  where: (d: string, dir: string) => `${d} entfernt, ${dir}`,
  adjoining: 'angrenzend',
  edit: 'In der Liste bearbeiten',
  mine: 'Das ist mein Gebäude',
  close: 'Schliessen',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Site plan',
    placed: (az, dir) => `Balcony on the ${az} ${dir} facade of your building.`,
    notPlaced:
      'The location is not on a facade of your building yet: choose the facade with the balcony in the site plan.',
    noOwn:
      'No own building found: choose it under «Own building» in the site plan, or tap it and choose «This is my building».',
    manualOnly:
      'Only buildings entered by hand: facade and balcony can be chosen on buildings loaded from swisstopo.',
    otherSite: (distance) =>
      `The stored buildings belong to another site: they are ${distance} from the location.`,
    loadHere: 'Load the buildings around the location',
    loading: 'Loading buildings …',
    ownBuilding: 'Own building',
    ownChoose: 'Choose a building',
    ownOption: (name, where) => `${name} · ${where}`,
    ownHint: 'Imported buildings up to 25 m from the location and the adjoining ones.',
    atLocation: 'at the location',
    guide:
      'Confirm facade and balcony: tap or click the facade with the balcony in the plan (blue), then the spot of the balcony on it; the point can be dragged along the facade. Dotted edges are party walls. Finally «Apply».',
    map: 'Site plan, north up',
    help: 'On touch screens one finger scrolls the page, dragging sideways pans the plan, two fingers zoom. Mouse: drag to pan, Ctrl + wheel to zoom. Keyboard: arrow keys pan, plus and minus zoom, 0 recentres. Facade and balcony can also be set with the fields below.',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    recenter: 'Recentre plan',
    wheelHint: 'Hold Ctrl (Mac: ⌘) to zoom, or use the buttons',
    north: 'N',
    location: 'Previous location',
    address: 'Address',
    description: (own, facade, neighbours) =>
      `${own} ${facade} ${neighbours === 1 ? '1 other building' : `${neighbours} other buildings`} in the plan.`,
    ownKnown: (name) => `Own building: ${name}.`,
    facadeShown: (az, dir, along) => `Balcony on the ${az} ${dir} facade, ${along} from the left corner.`,
    facadeNone: 'No facade chosen.',
    facade: 'Facade with the balcony',
    facadeOption: (az, dir, length) => `${az} ${dir} · ${length} long`,
    facadeChoose: 'Choose a facade',
    along: 'Position along the facade',
    alongHint: 'Centre of the panel rows, from the left corner (seen from outside).',
    partyWalls: (n) => (n === 1 ? '1 party wall cannot be chosen.' : `${n} party walls cannot be chosen.`),
    partyTapped: 'Party wall: it adjoins another building and cannot be the facade.',
    noFacade: 'This building has no facade to choose (all edges are party walls or shorter than 2 m).',
    apply: 'Apply',
    discard: 'Discard',
    pending: 'Not applied yet: location and facade azimuth change only with «Apply».',
    applied: (az, dir) => `Location set on the ${az} ${dir} facade.`,
    opened: 'Site plan opened: confirm facade and balcony.',
    sun: 'Sun direction at the selected time',
    legend: 'Legend',
    legendOwn: 'Own building',
    legendFacade: 'facade to choose',
    legendParty: 'party wall',
    legendBalcony: 'balcony and panel row',
    legendNeighbour: 'surrounding building',
    legendEdited: 'edited',
    legendManual: 'manual',
    legendRemoved: 'removed',
    legendSun: 'sun',
    own: 'Own building',
    manual: 'manual',
    edited: 'edited',
    removed: 'removed',
    height: (h) => `${h} high`,
    base: (b) => `base ${b}`,
    where: (d, dir) => `${d} away, ${dir}`,
    adjoining: 'adjoining',
    edit: 'Edit in the list',
    mine: 'This is my building',
    close: 'Close',
  },
};

/** Closer than this to the balcony (m), a building is «adjoining» (as in the building list). */
const ADJOINING_M = 0.5;

/** A choice in the plan that is not applied yet; it belongs to one buildings list (a new import drops it). */
interface Draft {
  buildings: readonly Building[];
  /** Building the user declared as their own (null: the automatic choice). */
  ownId: string | null;
  /** Chosen facade and position (null: the configured or suggested one). */
  placement: Placement | null;
}

/**
 * Site plan of the «Gebäude» section: shown when surrounding buildings are stored (with their anchor). A
 * disclosure with the placement status; open: instructions after an import, the map, legend, facade list,
 * position slider, the selected building and «Übernehmen».
 */
export function SitePlanPanel() {
  const t = useMessages(messages);
  const f = useFormat();
  const lang = useLang();
  const horizon = useConfigSection('horizon');
  const location = useConfigSection('location');
  const { facadeAzimuth, balconyDepth } = useConfigSection('building');
  const setConfig = useConfigStore((s) => s.setConfig);
  const layout = useLayout();
  const site = useSiteGeometry();
  const importedOwnId = useBuildingImportStore((s) => s.summary?.ownId ?? null);
  const lastRequest = useBuildingImportStore((s) => s.request);
  const open = useBuildingImportStore((s) => s.sitePlanOpen);
  // Re-renders when an address import stores its anchor (isAddressAnchor below reads it).
  useAddressPointStore((s) => s.anchor);
  const request = useBuildingImportStore((s) => s.sitePlanRequest);
  const setOpen = (v: boolean): void => useBuildingImportStore.setState({ sitePlanOpen: v });

  const { buildings } = horizon;
  const anchor = site.anchor;
  const origin = site.origin;
  const [draftState, setDraftState] = useState<Draft | null>(null);
  const draft = draftState?.buildings === buildings ? draftState : null;
  const guide = useBuildingImportStore((s) => s.sitePlanGuide);
  // The tapped building, for this buildings list (a new import drops it).
  const [selection, setSelection] = useState<{ buildings: readonly Building[]; id: string } | null>(null);
  const selectedId = selection?.buildings === buildings ? selection.id : null;
  const setSelectedId = (id: string | null): void => setSelection(id ? { buildings, id } : null);
  const [showSun, setShowSun] = useState(false);
  const [notice, setNotice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLParagraphElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const releaseHold = useRef<(() => void) | null>(null);
  const bodyId = useId();

  const autoOwn = useMemo(
    () => sitePlanOwnBuilding(buildings, origin, facadeAzimuth, importedOwnId),
    [buildings, origin, facadeAzimuth, importedOwnId],
  );
  const chosenId = draft?.ownId ?? null;
  const own = useMemo(
    () =>
      chosenId ? sitePlanOwnBuilding(buildings, origin, facadeAzimuth, importedOwnId, chosenId) : autoOwn,
    [buildings, origin, facadeAzimuth, importedOwnId, chosenId, autoOwn],
  );
  const choices = useMemo(() => ownBuildingChoices(buildings, origin, own), [buildings, origin, own]);
  const edges = useMemo(() => (own ? ownFacadeEdges(own, buildings) : []), [own, buildings]);
  // The configured placement only counts for the automatically found own building.
  const current = useMemo(
    () => (origin && !draft?.ownId ? currentPlacement(edges, origin, facadeAzimuth) : null),
    [edges, origin, facadeAzimuth, draft?.ownId],
  );
  const suggestion = useMemo(
    () => (!current && origin ? suggestedPlacement(edges, origin, facadeAzimuth) : null),
    [current, edges, origin, facadeAzimuth],
  );
  const shown = draft?.placement ?? current ?? suggestion;
  const pending = shown !== null && !samePlacement(shown, current);
  const hasSite = anchor !== null && buildings.some((b) => !b.removed);
  // The location moved more than 2 km from the buildings' anchor without a new import.
  const siteDistance = anchor ? anchorDistance(anchor, location) : 0;
  const otherSite = hasSite && siteDistance > OTHER_SITE_DISTANCE;
  const importedAny = buildings.some((b) => b.source === 'swisstopo' && !b.removed);
  const importing = useBuildingImportStore((s) => s.status === 'loading');

  // Open by itself after an import (address pick: the section was opened too, scroll there).
  const placed = current !== null;
  useEffect(() => {
    if (!request) return;
    const r = useBuildingImportStore.getState().consumeSitePlanRequest();
    if (!r || !hasSite) return;
    // «Gebäude laden» with the balcony already on a facade: nothing to confirm.
    if (r.reason === 'manual' && placed) return;
    useBuildingImportStore.setState({ sitePlanOpen: true, sitePlanGuide: true });
    // An instant jump (a smooth scroll would end short of it while the results above still grow). The
    // browser's scroll anchoring then keeps the plan in place; without it (holdInView) the plan is held there
    // until the user scrolls, taps or types.
    if (r.reason === 'address') {
      requestAnimationFrame(() => {
        const el = rootRef.current;
        if (!el) return;
        el.scrollIntoView?.({ block: 'start' });
        releaseHold.current?.();
        releaseHold.current = hasScrollAnchoring() ? null : holdInView(el);
        // Keyboard and screen-reader users follow the jump: the focus moves to the instructions, unless it
        // is somewhere else than where the pick came from (the search, the prompts, nothing).
        const active = document.activeElement;
        const follow =
          !active || active === document.body || active.closest('[data-site-plan-source]') !== null;
        const target = guideRef.current ?? toggleRef.current;
        if (follow && target) target.focus({ preventScroll: true });
        else setAnnouncement(t.opened);
      });
    }
    // t: the texts of the current language (stable per language).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, hasSite, placed]);
  useEffect(() => () => releaseHold.current?.(), []);

  // Nothing to place without stored buildings (the building list explains the import).
  if (!hasSite) return null;

  const deg = (az: number): string => f.deg(Math.round(az) % 360);
  const dirOf = (az: number): string => compassPoint(Math.round(az) % 360, lang);
  const m = (v: number, digits = 1): string => f.unit(v, 'm', digits);

  const status = otherSite
    ? t.otherSite(f.unit(Math.round(siteDistance / 100) / 10, 'km', 1))
    : !own
      ? importedAny
        ? t.noOwn
        : t.manualOnly
      : current
        ? t.placed(deg(current.edge.azimuth), dirOf(current.edge.azimuth))
        : t.notPlaced;

  // «Gebäude um den Standort laden» (another site): a pending confirmation (changes to imported buildings
  // would be lost) is asked in the building list, so that section opens.
  const loadHere = (): void => {
    if (importing) return;
    requestBuildingImport({ latitude: location.latitude, longitude: location.longitude, reason: 'manual' });
    if (useBuildingImportStore.getState().pendingConfirm)
      useUiStore.getState().setSectionOpen('horizon', true);
  };

  const setPlacement = (placement: Placement | null, ownId = draft?.ownId ?? null): void => {
    setDraftState({ buildings, ownId, placement });
    setNotice('');
  };

  const apply = (): void => {
    if (!shown || !anchor || !pending) return;
    const next = placementConfig(anchor, shown);
    setConfig((c) => ({
      ...c,
      location: { ...c.location, latitude: next.latitude, longitude: next.longitude },
      building: { ...c.building, facadeAzimuth: next.facadeAzimuth },
    }));
    setDraftState(null);
    clearAddressPoint();
    useBuildingImportStore.setState({ sitePlanGuide: false });
    setNotice('');
    setAnnouncement(t.applied(deg(shown.edge.azimuth), dirOf(shown.edge.azimuth)));
  };

  const selectable = edges.filter((e) => e.selectable).sort((a, b) => a.azimuth - b.azimuth);
  const partyCount = edges.filter((e) => e.party).length;

  const mapBuildings: MapBuilding[] = buildings.map((b) => ({
    id: b.id,
    footprint: b.footprint,
    kind:
      b.id === own?.id
        ? 'own'
        : b.removed
          ? 'removed'
          : b.source === 'manual'
            ? 'manual'
            : b.edited
              ? 'edited'
              : 'neighbour',
  }));

  // The anchor is marked when it is the picked address (this session's last import came from a pick there, or
  // the stored buildings were imported around an address: addressPointStore). The centre of «Gebäude laden» is
  // not marked (it is the location of that moment).
  const fromAddress =
    anchor !== null &&
    anchor.radius > 0 &&
    ((lastRequest?.reason === 'address' &&
      lastRequest.latitude === anchor.latitude &&
      lastRequest.longitude === anchor.longitude) ||
      isAddressAnchor(anchor));
  const marker = fromAddress ? { point: [0, 0] as Vertex, label: t.address } : null;
  const shownPoint = shown ? placementPoint(shown) : null;
  const apart = (a: Vertex, b: Vertex | null | undefined): boolean =>
    !b || Math.hypot(a[0] - b[0], a[1] - b[1]) > 1;
  // The configured location, unless it is the balcony shown or the address marker.
  const locationMark = origin && apart(origin, shownPoint) && apart(origin, marker?.point) ? origin : null;

  const ownIndex = own ? buildings.indexOf(own) : -1;
  const description = t.description(
    own ? t.ownKnown(buildingName(own, ownIndex, lang)) : importedAny ? t.noOwn : t.manualOnly,
    shown ? t.facadeShown(deg(shown.edge.azimuth), dirOf(shown.edge.azimuth), m(shown.along)) : t.facadeNone,
    buildings.filter((b) => b.id !== own?.id && !b.removed).length,
  );

  const selectedIndex = selectedId ? buildings.findIndex((b) => b.id === selectedId) : -1;
  const selected = selectedIndex >= 0 ? buildings[selectedIndex] : null;

  const facadeOptions = selectable.map((e) => ({
    value: String(e.index),
    label: t.facadeOption(deg(e.azimuth), dirOf(e.azimuth), m(e.length)),
  }));
  const range = shown ? alongRange(shown.edge) : null;

  return (
    <div ref={rootRef} className={styles.root}>
      <h5 className={styles.heading}>
        <button
          ref={toggleRef}
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <span className={styles.chevron} aria-hidden="true" />
          {t.title}
        </button>
      </h5>
      {!(open && guide && !current && !otherSite) && (
        <p className={current ? sections.hint : styles.status}>{status}</p>
      )}
      <div id={bodyId} className={styles.body} hidden={!open}>
        {open && otherSite && (
          <div className={styles.actions}>
            <Button
              size="sm"
              icon={<DownloadIcon />}
              onClick={loadHere}
              aria-disabled={importing || undefined}
              className={importing ? styles.unavailable : undefined}
            >
              {t.loadHere}
            </Button>
            {importing && (
              <span className={sections.hint} role="status">
                {t.loading}
              </span>
            )}
          </div>
        )}
        {open && !otherSite && (
          <>
            {guide && !current && (
              <p ref={guideRef} className={styles.guide} role="note" tabIndex={-1}>
                {t.guide}
              </p>
            )}
            <SitePlanMap
              buildings={mapBuildings}
              own={own?.footprint ?? null}
              edges={edges}
              placement={shown}
              rowWidth={layout.rowWidth}
              rowOffset={cmToM(balconyDepth)}
              marker={marker}
              location={locationMark}
              selectedId={selectedId}
              sunSite={showSun ? location : null}
              fitKey={`${own?.id ?? ''}|${anchor?.latitude},${anchor?.longitude}`}
              labels={t}
              description={description}
              onPlace={(p) => setPlacement(p)}
              onPartyWall={() => setNotice(t.partyTapped)}
              onSelect={setSelectedId}
            />
            <Legend t={t} sun={showSun} />
            {notice && (
              <p className={styles.notice} role="status">
                {notice}
              </p>
            )}
            {selected && (
              <SelectedBuilding
                t={t}
                building={selected}
                name={buildingName(selected, selectedIndex, lang)}
                own={selected.id === own?.id}
                from={origin}
                onEdit={() => requestBuildingFocus(selected.id)}
                onMine={() => {
                  setPlacement(null, selected.id);
                  setSelectedId(null);
                }}
                onClose={() => setSelectedId(null)}
              />
            )}
            {choices.length > 0 && (
              <SelectField
                label={t.ownBuilding}
                value={own?.id ?? ''}
                options={choices.map(({ building: b, bearing }) => ({
                  value: b.id,
                  label: t.ownOption(
                    buildingName(b, buildings.indexOf(b), lang),
                    !bearing || bearing.distance < ADJOINING_M
                      ? t.atLocation
                      : `${m(Math.round(bearing.distance), 0)} ${compassPoint(bearing.azimuth, lang)}`,
                  ),
                }))}
                placeholder={t.ownChoose}
                hint={t.ownHint}
                onChange={(id) => {
                  if (id !== own?.id) setPlacement(null, id === autoOwn?.id ? null : id);
                }}
              />
            )}
            {own && selectable.length === 0 && <p className={styles.notice}>{t.noFacade}</p>}
            {selectable.length > 0 && (
              <SelectField
                label={t.facade}
                value={shown ? String(shown.edge.index) : ''}
                options={facadeOptions}
                placeholder={t.facadeChoose}
                hint={partyCount > 0 ? t.partyWalls(partyCount) : undefined}
                onChange={(v) => {
                  const edge = edges.find((e) => String(e.index) === v);
                  if (edge) setPlacement({ edge, along: clampAlong(edge, edge.length / 2) });
                }}
              />
            )}
            {shown && range && (
              <NumberField
                label={t.along}
                value={Math.round(shown.along * 10) / 10}
                onChange={(v) => setPlacement({ edge: shown.edge, along: clampAlong(shown.edge, v) })}
                min={range.min}
                max={range.max}
                step={0.1}
                unit="m"
                hint={t.alongHint}
              />
            )}
            {(own || draft) && (
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<CheckIcon />}
                  onClick={apply}
                  aria-disabled={!pending || undefined}
                  className={pending ? undefined : styles.unavailable}
                >
                  {t.apply}
                </Button>
                {draft && (
                  <Button size="sm" variant="ghost" onClick={() => setDraftState(null)}>
                    {t.discard}
                  </Button>
                )}
              </div>
            )}
            {pending && <p className={sections.hint}>{t.pending}</p>}
            <Toggle label={t.sun} checked={showSun} onChange={setShowSun} />
            {showSun && <SunCaption site={location} />}
          </>
        )}
      </div>
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </div>
  );
}

function Legend({ t, sun }: { t: typeof de; sun: boolean }) {
  const items: [string, string][] = [
    [styles.swOwn, t.legendOwn],
    [styles.swFacade, t.legendFacade],
    [styles.swParty, t.legendParty],
    [styles.swBalcony, t.legendBalcony],
    [styles.swNeighbour, t.legendNeighbour],
    [styles.swEdited, t.legendEdited],
    [styles.swManual, t.legendManual],
    [styles.swRemoved, t.legendRemoved],
  ];
  if (sun) items.push([styles.swSun, t.legendSun]);
  return (
    <ul className={styles.legend} aria-label={t.legend}>
      {items.map(([cls, label]) => (
        <li key={label}>
          <span className={`${styles.sw} ${cls}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** Card of a building tapped in the plan: name, badges, height, where it lies; edit in the list, «mine». */
function SelectedBuilding({
  t,
  building,
  name,
  own,
  from,
  onEdit,
  onMine,
  onClose,
}: {
  t: typeof de;
  building: Building;
  name: string;
  own: boolean;
  from: Vertex | null;
  onEdit: () => void;
  onMine: () => void;
  onClose: () => void;
}) {
  const f = useFormat();
  const lang = useLang();
  const m = (v: number): string => f.unit(v, 'm', Number.isInteger(v) ? 0 : 1);
  const bearing = from && !own ? buildingBearing(building.footprint, from) : null;
  const badges = [
    own ? t.own : null,
    building.source === 'manual' ? t.manual : null,
    building.edited ? t.edited : null,
    building.removed ? t.removed : null,
  ].filter((b): b is string => b !== null);
  const meta = [
    t.height(m(building.height)),
    building.base !== 0 ? t.base(m(building.base)) : null,
    bearing
      ? bearing.distance < ADJOINING_M
        ? `${t.adjoining}, ${compassPoint(bearing.azimuth, lang)}`
        : t.where(m(Math.round(bearing.distance)), compassPoint(bearing.azimuth, lang))
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={styles.card} role="group" aria-label={name}>
      <p className={styles.cardTitle}>
        <span className={styles.cardName}>{name}</span>
        {badges.map((b) => (
          <span key={b} className={styles.badge}>
            {b}
          </span>
        ))}
      </p>
      <p className={styles.cardMeta}>{meta}</p>
      <div className={styles.cardActions}>
        <Button size="sm" onClick={onEdit}>
          {t.edit}
        </Button>
        {!own && !building.removed && building.source === 'swisstopo' && (
          <Button size="sm" onClick={onMine}>
            {t.mine}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t.close}
        </Button>
      </div>
    </div>
  );
}

/** «Sonne um 14:30: 215° SW, 42° hoch» at the selected time (own component: it follows the time). */
const sunMessages: Messages<{
  up: (time: string, az: string, dir: string, alt: string) => string;
  down: (time: string) => string;
}> = {
  de: {
    up: (time, az, dir, alt) => `Sonne um ${time}: ${az} ${dir}, ${alt} hoch.`,
    down: (time) => `Um ${time} steht die Sonne unter dem Horizont.`,
  },
  en: {
    up: (time, az, dir, alt) => `Sun at ${time}: ${az} ${dir}, ${alt} high.`,
    down: (time) => `At ${time} the sun is below the horizon.`,
  },
};

function SunCaption({ site }: { site: { latitude: number; longitude: number } }) {
  const t = useMessages(sunMessages);
  const f = useFormat();
  const lang = useLang();
  const sun = useSun(site);
  const time = f.time(Math.round(useTimeStore((s) => s.minutes)));
  return (
    <p className={sections.hint} data-testid="sun-caption">
      {sun.altitude > 0
        ? t.up(time, f.deg(sun.azimuth), compassPoint(sun.azimuth, lang), f.deg(sun.altitude))
        : t.down(time)}
    </p>
  );
}
