import { useId } from 'react';
import { Button } from '../../components/Button';
import { InfoTip } from '../../components/InfoTip';
import { Spinner } from '../../components/Spinner';
import { useFormat, useMessages, type Messages } from '../../i18n';
import type { BuildingCategory, BuildingInfo, ConstructionPeriod } from '../../model/geocode';
import { useConfigSection } from '../../state/configStore';
import { addressMatchesLocation, retryBuildingInfo, useAddressSession } from './addressSession';
import styles from './AddressBuilding.module.css';

const de = {
  title: 'Gebäude an der Adresse',
  switzerland: 'Schweiz',
  liechtenstein: 'Liechtenstein',
  egid: (egid: string) => `EGID ${egid}`,
  loading: 'Gebäudeangaben werden geladen …',
  error: 'Die Gebäudeangaben konnten nicht geladen werden.',
  retry: 'Erneut versuchen',
  noRecord: 'Keine Angaben im eidgenössischen Gebäude- und Wohnungsregister.',
  noRecordLi: 'Für Liechtenstein gibt es keine Angaben im eidgenössischen Gebäude- und Wohnungsregister.',
  storeys: 'Geschosse',
  storeysInfo:
    'Laut Gebäuderegister: alle Geschosse einschliesslich Erdgeschoss; Dach- und Untergeschosse nur, wenn sie bewohnt oder beheizt sind; ohne Keller.',
  year: 'Baujahr',
  area: 'Grundfläche',
  category: 'Gebäudekategorie',
  unknown: 'nicht erfasst',
  before: (year: number) => `vor ${year}`,
  since: (year: number) => `ab ${year}`,
  period: (text: string) => `${text} (Bauperiode)`,
  categories: {
    1010: 'Provisorische Unterkunft',
    1020: 'Gebäude mit ausschliesslicher Wohnnutzung',
    1030: 'Andere Wohngebäude (Wohngebäude mit Nebennutzung)',
    1040: 'Gebäude mit teilweiser Wohnnutzung',
    1060: 'Gebäude ohne Wohnnutzung',
    1080: 'Sonderbau',
  } satisfies Record<BuildingCategory, string>,
  source: 'Quelle: Gebäude- und Wohnungsregister (BFS) über geo.admin.ch, © swisstopo.',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Building at the address',
    switzerland: 'Switzerland',
    liechtenstein: 'Liechtenstein',
    egid: (egid) => `EGID ${egid}`,
    loading: 'Loading the building data …',
    error: 'The building data could not be loaded.',
    retry: 'Try again',
    noRecord: 'No data in the Federal Register of Buildings and Dwellings.',
    noRecordLi: 'The Federal Register of Buildings and Dwellings has no data for Liechtenstein.',
    storeys: 'Storeys',
    storeysInfo:
      'As recorded in the building register: all storeys including the ground floor; attics and basements only when lived in or heated; no cellars.',
    year: 'Year built',
    area: 'Footprint',
    category: 'Building category',
    unknown: 'not recorded',
    before: (year) => `before ${year}`,
    since: (year) => `from ${year}`,
    period: (text) => `${text} (period)`,
    categories: {
      1010: 'Temporary accommodation',
      1020: 'Residential only',
      1030: 'Other residential building (with secondary use)',
      1040: 'Partly residential',
      1060: 'Non-residential',
      1080: 'Special structure',
    },
    source: 'Source: Federal Register of Buildings and Dwellings (FSO) via geo.admin.ch, © swisstopo.',
  },
};

type T = typeof de;

/** "vor 1919", "1986–1990", "ab 2016". */
function periodText(p: ConstructionPeriod, t: T): string {
  if (p.from === null && p.to !== null) return t.before(p.to + 1);
  if (p.to === null && p.from !== null) return t.since(p.from);
  return `${p.from}–${p.to}`;
}

function Facts({ info }: { info: BuildingInfo }) {
  const t = useMessages(messages);
  const f = useFormat();
  let year = t.unknown;
  if (info.year !== null) year = String(info.year);
  else if (info.period) year = t.period(periodText(info.period, t));
  const rows: [string, string, string?][] = [
    [t.storeys, info.storeys === null ? t.unknown : f.int(info.storeys), t.storeysInfo],
    [t.year, year],
    [t.area, info.area === null ? t.unknown : f.unit(info.area, 'm²')],
    [t.category, info.category === null ? t.unknown : t.categories[info.category]],
  ];
  return (
    <dl className={styles.facts}>
      {rows.map(([term, value, info]) => (
        <div key={term} className={styles.fact}>
          <dt className={styles.term}>
            {term}
            {info && <InfoTip label={term}>{info}</InfoTip>}
          </dt>
          <dd className={styles.value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Read-only data of the building at the picked address (building register: storeys, year of construction,
 * footprint, category). Shown while the location still is that address (addressMatchesLocation); session only.
 */
export function AddressBuilding() {
  const t = useMessages(messages);
  const headingId = useId();
  const location = useConfigSection('location');
  const address = useAddressSession((s) => s.address);
  const building = useAddressSession((s) => s.building);
  if (!address || !addressMatchesLocation(address, location)) return null;

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <h4 id={headingId} className={styles.title}>
        {t.title}
      </h4>
      <p className={styles.address}>
        <span className={styles.label}>{address.label}</span>
        <span className={styles.meta}>
          {address.country === 'LI' ? t.liechtenstein : t.switzerland} · {t.egid(address.egid)}
        </span>
      </p>
      {building.status === 'loading' && <Spinner label={t.loading} showLabel size="sm" />}
      {building.status === 'error' && (
        <div className={styles.error} role="alert">
          <span>{t.error}</span>
          <Button size="sm" variant="ghost" onClick={retryBuildingInfo}>
            {t.retry}
          </Button>
        </div>
      )}
      {building.status === 'ready' &&
        (building.info ? (
          <Facts info={building.info} />
        ) : (
          <p className={styles.note}>{address.country === 'LI' ? t.noRecordLi : t.noRecord}</p>
        ))}
      <p className={styles.source}>{t.source}</p>
    </section>
  );
}
