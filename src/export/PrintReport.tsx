import type { ReactNode } from 'react';
import { currentPlacement, ownFacadeEdges, sitePlanOwnBuilding } from '../controls/siteplan/sitePlanModel';
import {
  compassPoint,
  displayLocationName,
  floorLabel,
  useFormat,
  useLang,
  useMessages,
  type Messages,
} from '../i18n';
import { useCommon } from '../i18n/common';
import { useSelectedUtc } from '../hooks/useModel';
import { anchorDistance, OTHER_SITE_DISTANCE, SWISSTOPO_CREDIT } from '../model/buildings';
import { lonLatToEnu } from '../model/enu';
import type { Config, ShadingModel } from '../model/types';
import { useConfig } from '../state/configStore';
import { useDataStore, type SurfaceStatus } from '../state/dataStore';
import { useTimeStore } from '../state/timeStore';
import { shareUrl } from '../state/urlSync';
import { useAddressBuildingSummary } from '../controls/location/addressBuildingText';
import styles from './PrintReport.module.css';

const de = {
  title: 'Eingaben dieses Berichts',
  created: (when: string) => `Erstellt am ${when}`,
  instant: (when: string) => `Ansichten und «Jetzt»-Werte für ${when}`,
  location: 'Standort',
  name: 'Name',
  coordinates: 'Koordinaten',
  elevation: 'Höhe',
  timezone: 'Zeitzone',
  building: 'Gebäude',
  facade: 'Fassadenausrichtung',
  floors: 'Stockwerke mit Panels',
  floorsValue: (n: string, lowest: string) => `${n}, unterstes: ${lowest}`,
  floorHeight: 'Stockwerkhöhe',
  railingHeight: 'Geländerhöhe',
  balconyDepth: 'Balkontiefe',
  panels: 'Panels',
  modules: 'Module je Stockwerk',
  moduleSize: 'Modulmasse (Länge × Breite)',
  gap: 'Abstand zwischen Modulen',
  tilt: 'Neigung θ ab Senkrechte',
  system: 'System',
  inverter: 'Wechselrichter-Grenze je Stockwerk',
  losses: 'Systemverluste',
  tempCoeff: 'Temperaturkoeffizient',
  albedo: 'Albedo',
  shadingModel: 'Teilverschattung',
  shadingModels: { linear: 'flächenanteilig', substring: 'Bypass-Teilstränge' } satisfies Record<
    ShadingModel,
    string
  >,
  environment: 'Horizont & Wetter',
  terrain: 'Geländehorizont',
  on: 'ein',
  off: 'aus',
  obstacles: 'Hindernisse',
  manualHorizon: 'Eigene Horizontpunkte',
  weather: 'Wetterdaten',
  weatherOpenMeteo: (year: number) => `Open-Meteo, Jahr ${year}`,
  weatherFallback: (year: number) =>
    `Open-Meteo, Jahr ${year} – nicht verfügbar, gerechnet mit klarem Himmel`,
  economics: 'Wirtschaftlichkeit',
  price: 'Strompreis (Bezug)',
  feedIn: 'Einspeisevergütung',
  selfConsumption: 'Eigenverbrauchsanteil',
  investment: 'Investition je Stockwerk',
  degradation: 'Degradation',
  perYear: '%/Jahr',
  lifetime: 'Betrachtungsdauer',
  link: 'Link zu dieser Konfiguration',
  linkLong: (n: string) =>
    `Der ganze Link hat ${n} Zeichen (mit den gespeicherten Gebäuden) und ist auf Papier nicht brauchbar: In der App über «Teilen» kopieren.`,
  placement: 'Lage am Gebäude',
  placed: (az: string, dir: string) =>
    `Balkon auf der Fassade ${az} ${dir}, im Lageplan gesetzt; Koordinaten auf 0.000001° (höchstens 0.07 m)`,
  notPlaced: 'nicht im Lageplan bestätigt',
  surroundings: 'Umgebung',
  buildings: 'Umgebungsgebäude',
  buildingsNone: 'keine',
  buildingsCount: (n: string, parts: string[]) => (parts.length > 0 ? `${n} (${parts.join(', ')})` : n),
  manual: (n: string) => `${n} von Hand`,
  edited: (n: string) => `${n} bearbeitet`,
  removed: (n: string) => `${n} entfernt`,
  buildingImport: 'Gebäude-Import',
  buildingImportValue: (date: string, radius: string) =>
    date ? `swisstopo, Stand ${date}, Umkreis ${radius}` : `Umkreis ${radius}`,
  surfaceModel: 'Laserscan (swissSURFACE3D)',
  surfaceOn: (trees: boolean, radius: string) =>
    `ein, ${trees ? 'mit Bäumen (ganzjährig undurchsichtig)' : 'nur Gebäude'}, Umkreis ${radius}`,
  surfaceStatus: 'Laserscan-Stand',
  surfaceReady: (years: string) => (years ? `geladen, Datenstand ${years}` : 'geladen'),
  surfaceCoverage: (pct: string) => `deckt ${pct} des Umkreises ab (Grenze der Schweiz und Liechtensteins)`,
  surfaceLoading: 'wird geladen: Ergebnisse vorläufig',
  surfaceWaiting: 'wartet auf die Bestätigung von Fassade und Balkon im Lageplan',
  surfaceError: 'konnte nicht geladen werden',
  surfaceUnavailable: 'nur in der Schweiz und Liechtenstein verfügbar',
  withPrisms: 'gerechnet mit den Umgebungsgebäuden als Gebäude mit flachem Dach',
  withoutScan: 'gerechnet ohne Laserscan',
  addressBuilding: 'Gebäude an der Adresse',
  sources: 'Datenquellen',
};

const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Inputs of this report',
    created: (when) => `Created ${when}`,
    instant: (when) => `Views and “now” values for ${when}`,
    location: 'Location',
    name: 'Name',
    coordinates: 'Coordinates',
    elevation: 'Elevation',
    timezone: 'Time zone',
    building: 'Building',
    facade: 'Facade orientation',
    floors: 'Floors with panels',
    floorsValue: (n, lowest) => `${n}, lowest: ${lowest}`,
    floorHeight: 'Floor-to-floor height',
    railingHeight: 'Railing height',
    balconyDepth: 'Balcony depth',
    panels: 'Panels',
    modules: 'Modules per floor',
    moduleSize: 'Module size (length × width)',
    gap: 'Gap between modules',
    tilt: 'Tilt θ from vertical',
    system: 'System',
    inverter: 'Inverter limit per floor',
    losses: 'System losses',
    tempCoeff: 'Temperature coefficient',
    albedo: 'Albedo',
    shadingModel: 'Partial shading',
    shadingModels: { linear: 'proportional to shaded area', substring: 'bypass substrings' },
    environment: 'Horizon & weather',
    terrain: 'Terrain horizon',
    on: 'on',
    off: 'off',
    obstacles: 'Obstacles',
    manualHorizon: 'Custom horizon points',
    weather: 'Weather data',
    weatherOpenMeteo: (year) => `Open-Meteo, year ${year}`,
    weatherFallback: (year) => `Open-Meteo, year ${year} – unavailable, computed with clear skies`,
    economics: 'Economics',
    price: 'Electricity price (purchase)',
    feedIn: 'Feed-in tariff',
    selfConsumption: 'Self-consumption share',
    investment: 'Investment per floor',
    degradation: 'Degradation',
    perYear: '%/year',
    lifetime: 'Evaluation period',
    link: 'Link to this configuration',
    linkLong: (n) =>
      `The full link has ${n} characters (with the stored buildings) and is of no use on paper: copy it in the app with «Share».`,
    placement: 'Position on the building',
    placed: (az, dir) =>
      `balcony on the ${az} ${dir} facade, set in the site plan; coordinates to 0.000001° (at most 0.07 m)`,
    notPlaced: 'not confirmed in the site plan',
    surroundings: 'Surroundings',
    buildings: 'Surrounding buildings',
    buildingsNone: 'none',
    buildingsCount: (n, parts) => (parts.length > 0 ? `${n} (${parts.join(', ')})` : n),
    manual: (n) => `${n} entered by hand`,
    edited: (n) => `${n} edited`,
    removed: (n) => `${n} removed`,
    buildingImport: 'Building import',
    buildingImportValue: (date, radius) =>
      date ? `swisstopo, as of ${date}, radius ${radius}` : `radius ${radius}`,
    surfaceModel: 'Laser scan (swissSURFACE3D)',
    surfaceOn: (trees, radius) =>
      `on, ${trees ? 'with trees (opaque all year)' : 'buildings only'}, radius ${radius}`,
    surfaceStatus: 'Laser-scan state',
    surfaceReady: (years) => (years ? `loaded, data from ${years}` : 'loaded'),
    surfaceCoverage: (pct) => `covers ${pct} of the radius (border of Switzerland and Liechtenstein)`,
    surfaceLoading: 'loading: results provisional',
    surfaceWaiting: 'waiting for facade and balcony to be confirmed in the site plan',
    surfaceError: 'could not be loaded',
    surfaceUnavailable: 'available in Switzerland and Liechtenstein only',
    withPrisms: 'computed with the surrounding buildings as flat-roofed buildings',
    withoutScan: 'computed without the laser scan',
    addressBuilding: 'Building at the address',
    sources: 'Data sources',
  },
};

/**
 * Where the location sits on the own building (as the site plan finds it): the facade azimuth of the
 * edge it lies on, null when it is not on a facade, undefined when there is nothing to place it on (no
 * surrounding buildings, only ones entered by hand, or those of another site more than 2 km away).
 */
function placementAzimuth(config: Config): number | null | undefined {
  const { buildings, buildingImport } = config.horizon;
  if (!buildingImport || buildings.length === 0) return undefined;
  if (anchorDistance(buildingImport, config.location) > OTHER_SITE_DISTANCE) return undefined;
  const { facadeAzimuth } = config.building;
  const origin = lonLatToEnu(buildingImport, config.location.latitude, config.location.longitude);
  const own = sitePlanOwnBuilding(buildings, origin, facadeAzimuth);
  if (!own) return buildings.some((b) => b.source === 'swisstopo' && !b.removed) ? null : undefined;
  const placed = currentPlacement(ownFacadeEdges(own, buildings), origin, facadeAzimuth);
  return placed ? facadeAzimuth : null;
}

function Group({ title, items }: { title: string; items: [string, ReactNode][] }) {
  return (
    <div className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      <dl className={styles.list}>
        {items.map(([label, value]) => (
          <div key={label} className={styles.row}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Longest share link printed in full (characters); longer ones (stored buildings: ~10'000) are shortened. */
export const PRINT_LINK_MAX = 500;
/** Characters of a shortened link that are printed. */
const PRINT_LINK_HEAD = 120;

/** The share link: in full up to PRINT_LINK_MAX characters, else its start with «…» and a note. */
function ShareLink({ url, label, long }: { url: string; label: string; long: (n: string) => string }) {
  const f = useFormat();
  const short = url.length > PRINT_LINK_MAX;
  return (
    <p className={styles.link}>
      <span className={styles.linkLabel}>{label}:</span>{' '}
      <span className={styles.url}>{short ? `${url.slice(0, PRINT_LINK_HEAD)}…` : url}</span>
      {short && <span className={styles.linkNote}>{long(f.int(url.length))}</span>}
    </p>
  );
}

/**
 * Print-only appendix: every input the printed results depend on, the selected instant and the share
 * link that reopens exactly this analysis. Rendered only while printing (see usePrintMode).
 */
export function PrintReport({ printedAt }: { printedAt: number }) {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const config = useConfig();
  const date = useTimeStore((s) => s.date);
  const minutes = useTimeStore((s) => s.minutes);
  const utc = useSelectedUtc();
  const weatherFallback = useDataStore((st) => st.weather.usingFallback);
  const surface = useDataStore((st) => st.surface);
  const addressBuilding = useAddressBuildingSummary();
  const { location: loc, building: b, panels: p, system: s, horizon: h, weather: w, economics: e } = config;

  // Surroundings (buildings feature): position on the building, buildings, laser scan, sources.
  const placedAz = placementAzimuth(config);
  const placementRows: [string, ReactNode][] =
    placedAz === undefined
      ? []
      : [
          [
            t.placement,
            placedAz === null ? t.notPlaced : t.placed(f.deg(placedAz), compassPoint(placedAz, lang)),
          ],
        ];
  const count = (pred: (x: (typeof h.buildings)[number]) => boolean): number =>
    h.buildings.filter(pred).length;
  const nManual = count((x) => x.source === 'manual');
  const nEdited = count((x) => x.edited === true && !x.removed);
  const nRemoved = count((x) => x.removed === true);
  const imported = count((x) => x.source === 'swisstopo') > 0;
  const surroundingRows: [string, ReactNode][] = [];
  if (h.buildings.length > 0 || h.surfaceModel.enabled) {
    surroundingRows.push([
      t.buildings,
      h.buildings.length === 0
        ? t.buildingsNone
        : t.buildingsCount(
            f.int(h.buildings.length - nRemoved),
            [
              nManual > 0 ? t.manual(f.int(nManual)) : null,
              nEdited > 0 ? t.edited(f.int(nEdited)) : null,
              nRemoved > 0 ? t.removed(f.int(nRemoved)) : null,
            ].filter((x): x is string => x !== null),
          ),
    ]);
    if (h.buildingImport && h.buildingImport.radius > 0) {
      surroundingRows.push([
        t.buildingImport,
        t.buildingImportValue(
          h.buildingImport.date ? f.date(h.buildingImport.date) : '',
          f.unit(h.buildingImport.radius, 'm'),
        ),
      ]);
    }
    surroundingRows.push([
      t.surfaceModel,
      h.surfaceModel.enabled ? t.surfaceOn(h.surfaceModel.trees, f.unit(h.surfaceModel.radius, 'm')) : t.off,
    ]);
    if (h.surfaceModel.enabled) {
      // What the printed results used: the scan, or the fallback while it loads, waits or failed.
      const fallback = h.buildings.some((x) => !x.removed) ? t.withPrisms : t.withoutScan;
      const partial = surface.coverage !== null && surface.coverage < 0.999;
      const state: Partial<Record<SurfaceStatus, string[]>> = {
        ready: [
          t.surfaceReady(surface.dataYears.join(', ')),
          ...(partial ? [t.surfaceCoverage(f.pct(Math.round((surface.coverage ?? 0) * 100)))] : []),
        ],
        loading: [t.surfaceLoading, fallback],
        waiting: [t.surfaceWaiting, fallback],
        error: [t.surfaceError, fallback],
        unavailable: [t.surfaceUnavailable],
      };
      const text = (state[surface.status] ?? []).join('; ');
      if (text) surroundingRows.push([t.surfaceStatus, text]);
    }
  }
  // «© swisstopo» once: imported buildings, the laser scan or a location from the address search.
  if (imported || h.surfaceModel.enabled || addressBuilding !== null) {
    surroundingRows.push([t.sources, SWISSTOPO_CREDIT]);
  }

  const created = new Intl.DateTimeFormat(f.locale, { dateStyle: 'long', timeStyle: 'short' }).format(
    printedAt,
  );
  // Tariffs keep up to 4 decimals (e.g. 0.3214), otherwise 2.
  const perKwh = (v: number): string => {
    const digits = Math.abs(v * 100 - Math.round(v * 100)) > 1e-9 ? 4 : 2;
    return `${f.currency(v, e.currency, digits)}/kWh`;
  };

  return (
    <section className={styles.report} aria-label={t.title}>
      <h2 className={styles.title}>{t.title}</h2>
      <p className={styles.meta}>
        {t.created(created)} ·{' '}
        {t.instant(`${f.date(date)}, ${f.time(minutes)} ${f.tzName(loc.timezone, utc)}`)}
      </p>
      <div className={styles.groups}>
        <Group
          title={t.location}
          items={[
            [t.name, displayLocationName(loc, f)],
            ...(addressBuilding?.facts
              ? ([[t.addressBuilding, addressBuilding.facts]] as [string, string][])
              : []),
            // 6 decimals: the stored precision (1e-6°, at most 0.07 m).
            [t.coordinates, f.coords(loc.latitude, loc.longitude, 6)],
            ...placementRows,
            [t.elevation, f.unit(loc.elevation, 'm')],
            [t.timezone, loc.timezone],
          ]}
        />
        <Group
          title={t.building}
          items={[
            [t.facade, `${f.deg(b.facadeAzimuth)} ${compassPoint(b.facadeAzimuth, lang)}`],
            [t.floors, t.floorsValue(f.int(b.numFloors), floorLabel(b.lowestFloor, lang))],
            [t.floorHeight, f.unit(b.floorHeight, 'cm')],
            [t.railingHeight, f.unit(b.railingHeight, 'cm')],
            [t.balconyDepth, f.unit(b.balconyDepth, 'cm')],
          ]}
        />
        <Group
          title={t.panels}
          items={[
            [t.modules, `${f.int(p.count)} × ${f.unit(p.powerWp, 'Wp')}`],
            [t.moduleSize, `${f.num(p.length, 1)} × ${f.unit(p.width, 'cm', 1)}`],
            [t.gap, f.unit(p.gap, 'cm', 1)],
            [
              t.tilt,
              `${f.deg(p.tiltFromVertical)} (${c.tiltFromHorizontalHint(f.deg(90 - p.tiltFromVertical))})`,
            ],
          ]}
        />
        <Group
          title={t.system}
          items={[
            [t.inverter, f.unit(s.inverterLimitW, 'W')],
            [t.losses, f.pct(s.lossesPct, 1)],
            [t.tempCoeff, f.unit(s.tempCoeffPct, '%/K', 2)],
            ['NOCT', f.unit(s.noct, '°C')],
            [t.albedo, f.num(s.albedo, 2)],
            [t.shadingModel, t.shadingModels[s.shadingModel]],
          ]}
        />
        <Group
          title={t.environment}
          items={[
            [t.terrain, h.terrainEnabled ? t.on : t.off],
            [t.obstacles, f.int(h.obstacles.length)],
            [t.manualHorizon, f.int(h.manual.length)],
            [
              t.weather,
              w.source === 'clear-sky'
                ? c.clearSkyHint
                : weatherFallback
                  ? t.weatherFallback(w.year)
                  : t.weatherOpenMeteo(w.year),
            ],
          ]}
        />
        {surroundingRows.length > 0 && <Group title={t.surroundings} items={surroundingRows} />}
        <Group
          title={t.economics}
          items={[
            [t.price, perKwh(e.electricityPrice)],
            [t.feedIn, perKwh(e.feedInTariff)],
            [t.selfConsumption, f.pct(e.selfConsumptionPct)],
            [t.investment, f.currency(e.investmentPerFloor, e.currency, 0)],
            [t.degradation, f.unit(e.degradationPct, t.perYear, 1)],
            [t.lifetime, c.years(f.int(e.lifetimeYears))],
          ]}
        />
      </div>
      <ShareLink url={shareUrl(config)} label={t.link} long={t.linkLong} />
    </section>
  );
}
