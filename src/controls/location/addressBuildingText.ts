import { useFormat, useMessages, type Messages } from '../../i18n';
import type { BuildingCategory, BuildingInfo, ConstructionPeriod } from '../../model/geocode';
import { useConfigSection } from '../../state/configStore';
import { addressMatchesLocation, useAddressSession } from './addressSession';

// Texts of the building register block (AddressBuilding.tsx) and its one-line form for the print report.

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
  source: 'Quelle: Gebäude- und Wohnungsregister (BFS) über geo.admin.ch, ©\u00a0swisstopo.',
};
export const messages: Messages<typeof de> = {
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
    source: 'Source: Federal Register of Buildings and Dwellings (FSO) via geo.admin.ch, ©\u00a0swisstopo.',
  },
};

export type T = typeof de;

/** "vor 1919", "1986–1990", "ab 2016". */
function periodText(p: ConstructionPeriod, t: T): string {
  if (p.from === null && p.to !== null) return t.before(p.to + 1);
  if (p.to === null && p.from !== null) return t.since(p.from);
  return `${p.from}–${p.to}`;
}

/** Year of construction, else the construction period, else «nicht erfasst». */
export function yearText(info: BuildingInfo, t: T): string {
  if (info.year !== null) return String(info.year);
  if (info.period) return t.period(periodText(info.period, t));
  return t.unknown;
}

/**
 * The picked address while the location still is it (as AddressBuilding shows it), for the print report:
 * `facts` is one line of the building register data («EGID 1230393 · Geschosse 4 · Baujahr vor 1919
 * (Bauperiode) · Grundfläche 147 m²»), null while loading, after an error or without a record. Null when the
 * location is not a picked address.
 */
export function useAddressBuildingSummary(): { facts: string | null } | null {
  const t = useMessages(messages);
  const f = useFormat();
  const location = useConfigSection('location');
  const address = useAddressSession((s) => s.address);
  const building = useAddressSession((s) => s.building);
  if (!address || !addressMatchesLocation(address, location)) return null;
  const info = building.status === 'ready' ? building.info : null;
  if (!info) return { facts: null };
  const parts = [
    t.egid(info.egid),
    info.storeys !== null ? `${t.storeys} ${f.int(info.storeys)}` : null,
    `${t.year} ${yearText(info, t)}`,
    info.area !== null ? `${t.area} ${f.unit(info.area, 'm²')}` : null,
  ];
  return { facts: parts.filter((x): x is string => x !== null).join(' · ') };
}
