import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useFormat, useLang, useMessages, type Messages } from '../../i18n';
import { searchSwissAddresses, type GeoErrorKind, type SwissAddress } from '../../model/geocode';
import { searchLocations } from '../../model/presets';
import type { LocationConfig } from '../../model/types';
import { SearchIcon } from '../icons';
import styles from './PlaceSearch.module.css';

/** Delay after the last keystroke before the requests, ms (≥ 300 ms: geo.admin.ch allows 40 requests/min). */
export const SEARCH_DEBOUNCE_MS = 300;
/** Queries shorter than this are not sent. */
export const MIN_QUERY_LENGTH = 2;
/** Places (Open-Meteo) per query; addresses: ADDRESS_SEARCH_LIMIT (geocode.ts). */
export const PLACE_RESULTS = 6;
/** Remembered result lists (per language + query) while the component is mounted. */
const MAX_CACHED_QUERIES = 20;

const de = {
  label: 'Adresse oder Ort suchen',
  placeholder: 'z. B. Kramgasse 49 Bern, Wien …',
  searching: 'Suche läuft …',
  tooShort: `Mindestens ${MIN_QUERY_LENGTH} Zeichen eingeben.`,
  none: (q: string) => `Keine Treffer für «${q}» – oder die Suche ist nicht erreichbar.`,
  addressError: 'Die Adresssuche (swisstopo) ist gerade nicht erreichbar.',
  count: (addresses: number, places: number) =>
    `${addresses === 1 ? '1 Adresse' : `${addresses} Adressen`} und ${places === 1 ? '1 Ort' : `${places} Orte`} gefunden, mit Pfeiltasten auswählen.`,
  picked: (name: string) => `Übernommen: ${name}`,
  results: 'Suchergebnisse',
  addresses: 'Adressen',
  addressesSource: 'swisstopo, CH und FL',
  places: 'Orte',
  placesSource: 'Open-Meteo',
  switzerland: 'Schweiz',
  liechtenstein: 'Liechtenstein',
  address: 'Gebäudeadresse',
  similar: 'ähnliche Schreibweise',
  source:
    'Adressen: amtliches Gebäudeadressverzeichnis (©\u00a0swisstopo), nur Schweiz und Liechtenstein. Orte: Open-Meteo Geocoding (Daten: GeoNames).',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    label: 'Search address or place',
    placeholder: 'e.g. Kramgasse 49 Bern, Vienna …',
    searching: 'Searching …',
    tooShort: `Type at least ${MIN_QUERY_LENGTH} characters.`,
    none: (q) => `Nothing found for “${q}” – or the search cannot be reached.`,
    addressError: 'The address search (swisstopo) cannot be reached right now.',
    count: (addresses, places) =>
      `${addresses === 1 ? '1 address' : `${addresses} addresses`} and ${places === 1 ? '1 place' : `${places} places`} found, use the arrow keys to choose.`,
    picked: (name) => `Applied: ${name}`,
    results: 'Search results',
    addresses: 'Addresses',
    addressesSource: 'swisstopo, CH and LI',
    places: 'Places',
    placesSource: 'Open-Meteo',
    switzerland: 'Switzerland',
    liechtenstein: 'Liechtenstein',
    address: 'Building address',
    similar: 'similar spelling',
    source:
      'Addresses: official directory of building addresses (©\u00a0swisstopo), Switzerland and Liechtenstein only. Places: Open-Meteo Geocoding (data: GeoNames).',
  },
};

export interface PlaceSearchProps {
  /** A place (Open-Meteo): the complete location (name, coordinates, time zone, elevation). */
  onSelectPlace: (location: LocationConfig) => void;
  /** A building address (swisstopo, CH/FL). */
  onSelectAddress: (address: SwissAddress) => void;
}

/** Results of one query; a missing part is still loading (or failed, see Miss). */
interface Entry {
  addresses?: readonly SwissAddress[];
  places?: readonly LocationConfig[];
}

/**
 * Failures of the current query. Not cached like hits: typing the query again asks again (searchLocations
 * also returns [] on network errors, so an empty place list counts as a miss).
 */
interface Miss {
  key: string;
  addresses?: GeoErrorKind;
  places?: true;
}

type Option =
  | { key: string; kind: 'address'; address: SwissAddress }
  | { key: string; kind: 'place'; location: LocationConfig };

interface Group {
  id: 'addresses' | 'places';
  label: string;
  source: string;
  options: Option[];
}

function withEntry(cache: ReadonlyMap<string, Entry>, key: string, part: Entry): Map<string, Entry> {
  const next = new Map(cache);
  const merged = { ...next.get(key), ...part };
  next.delete(key);
  next.set(key, merged);
  while (next.size > MAX_CACHED_QUERIES) next.delete(next.keys().next().value as string);
  return next;
}

/**
 * Search for building addresses (swisstopo SearchServer, Switzerland and Liechtenstein) and places (Open-Meteo
 * geocoding) in one ARIA 1.2 combobox (input + listbox with the groups «Adressen» and «Orte»,
 * aria-activedescendant). Both are asked in parallel 300 ms after the last keystroke; a newer query aborts the
 * running requests. Results appear per source as they arrive; with a digit in the query (a house number) the
 * addresses come first, else the places. ArrowDown/ArrowUp move through all results, Enter applies the active
 * (or first) one, Escape closes the list and then clears the input.
 */
export function PlaceSearch({ onSelectPlace, onSelectAddress }: PlaceSearchProps) {
  const t = useMessages(messages);
  const f = useFormat();
  const lang = useLang();
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const optionId = (i: number): string => `${id}-option-${i}`;

  const [query, setQuery] = useState('');
  const [cache, setCache] = useState<ReadonlyMap<string, Entry>>(() => new Map());
  const [miss, setMiss] = useState<Miss | null>(null);
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const q = query.trim();
  const key = `${lang}|${q}`;
  const tooShort = q.length < MIN_QUERY_LENGTH;
  const entry = tooShort ? undefined : cache.get(key);
  const missed = !tooShort && miss?.key === key ? miss : null;
  const addresses = entry?.addresses ?? (missed?.addresses ? [] : undefined);
  const places = entry?.places ?? (missed?.places ? [] : undefined);
  const needAddresses = !tooShort && addresses === undefined;
  const needPlaces = !tooShort && places === undefined;
  const searching = needAddresses || needPlaces;

  // One debounced request per source: an answer of one source does not restart the other.
  useEffect(() => {
    if (!needAddresses) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void searchSwissAddresses(q, { signal: ctrl.signal }).then((res) => {
        if (ctrl.signal.aborted) return;
        if (res.ok) setCache((prev) => withEntry(prev, key, { addresses: res.value }));
        else setMiss((m) => ({ ...(m?.key === key ? m : { key }), addresses: res.error.kind }));
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [needAddresses, q, key]);

  useEffect(() => {
    if (!needPlaces) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void searchLocations(q, lang, { signal: ctrl.signal, count: PLACE_RESULTS }).then((found) => {
        if (ctrl.signal.aborted) return;
        if (found.length > 0) setCache((prev) => withEntry(prev, key, { places: found }));
        else setMiss((m) => ({ ...(m?.key === key ? m : { key }), places: true }));
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [needPlaces, q, lang, key]);

  const addressGroup: Group = {
    id: 'addresses',
    label: t.addresses,
    source: t.addressesSource,
    options: (addresses ?? []).map((address) => ({
      key: `a:${address.featureId}`,
      kind: 'address',
      address,
    })),
  };
  const placeGroup: Group = {
    id: 'places',
    label: t.places,
    source: t.placesSource,
    options: (places ?? []).map((location) => ({
      key: `p:${location.name}|${location.latitude}|${location.longitude}`,
      kind: 'place',
      location,
    })),
  };
  const groups = (/\d/.test(q) ? [addressGroup, placeGroup] : [placeGroup, addressGroup]).filter(
    (g) => g.options.length > 0,
  );
  const options = groups.flatMap((g) => g.options);
  /** Index of each group's first option in `options`. */
  const firstIndex = groups.map((_, gi) => groups.slice(0, gi).reduce((n, g) => n + g.options.length, 0));
  const expanded = open && options.length > 0;
  const activeIndex = activeKey === null ? -1 : options.findIndex((o) => o.key === activeKey);

  // Keep the active option visible inside the scrolling list.
  useEffect(() => {
    if (!expanded || activeIndex < 0) return;
    document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, activeIndex, id]);

  const choose = (option: Option): void => {
    if (option.kind === 'address') {
      onSelectAddress(option.address);
      setPicked(option.address.label);
    } else {
      onSelectPlace(option.location);
      setPicked(option.location.name);
    }
    setQuery('');
    setOpen(false);
    setActiveKey(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    const n = options.length;
    switch (e.key) {
      case 'ArrowDown':
        if (n === 0) return;
        e.preventDefault();
        setOpen(true);
        setActiveKey(options[expanded ? (activeIndex + 1) % n : Math.max(0, activeIndex)].key);
        break;
      case 'ArrowUp':
        if (n === 0) return;
        e.preventDefault();
        setOpen(true);
        setActiveKey(options[activeIndex <= 0 ? n - 1 : activeIndex - 1].key);
        break;
      case 'Enter':
        if (!expanded) return;
        e.preventDefault();
        choose(options[Math.max(0, activeIndex)]);
        break;
      case 'Escape':
        if (expanded) {
          e.preventDefault();
          setOpen(false);
          setActiveKey(null);
        } else if (query) {
          e.preventDefault();
          setQuery('');
        }
        break;
      default:
    }
  };

  let status: string | null = null;
  let showSpinner = false;
  if (q.length > 0 && tooShort) status = t.tooShort;
  else if (searching) {
    status = t.searching;
    showSpinner = true;
  } else if (!tooShort && options.length === 0) status = t.none(q);
  else if (!q && picked) status = t.picked(picked);
  const addressFailed = missed?.addresses !== undefined && missed.addresses !== 'aborted';

  return (
    <div className={styles.root}>
      <label htmlFor={`${id}-input`} className={styles.label}>
        {t.label}
      </label>
      <div className={styles.inputWrap}>
        <SearchIcon className={styles.icon} />
        <input
          id={`${id}-input`}
          className={styles.input}
          type="search"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder={t.placeholder}
          value={query}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-describedby={hintId}
          onChange={(e) => {
            setQuery(e.target.value);
            setMiss(null);
            setOpen(true);
            setActiveKey(null);
            setPicked(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div id={listId} role="listbox" aria-label={t.results} className={styles.list} hidden={!expanded}>
        {expanded &&
          groups.map((g, gi) => (
            <ul key={g.id} role="group" aria-labelledby={`${id}-${g.id}`} className={styles.group}>
              <li role="presentation" id={`${id}-${g.id}`} className={styles.groupLabel}>
                {g.label} <span className={styles.groupSource}>{g.source}</span>
              </li>
              {g.options.map((option, oi) => {
                const i = firstIndex[gi] + oi;
                return (
                  <li
                    key={option.key}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={styles.option}
                    // Keep the focus in the input (no blur before the click).
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => {
                      if (i !== activeIndex) setActiveKey(option.key);
                    }}
                    onClick={() => choose(option)}
                  >
                    {option.kind === 'address' ? (
                      <>
                        <span className={styles.optionName}>{option.address.label}</span>
                        <span className={styles.optionMeta}>
                          {t.address} · {option.address.country === 'LI' ? t.liechtenstein : t.switzerland}
                          {option.address.match === 'fuzzy' && (
                            <>
                              {' · '}
                              <span className={styles.similar}>{t.similar}</span>
                            </>
                          )}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className={styles.optionName}>{option.location.name}</span>
                        <span className={styles.optionMeta}>
                          {f.coords(option.location.latitude, option.location.longitude)} ·{' '}
                          {f.unit(option.location.elevation, 'm')} · {option.location.timezone}
                        </span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          ))}
      </div>
      <p className={styles.status} role="status">
        {showSpinner && <span className={styles.spinner} aria-hidden="true" />}
        {status}
        {expanded && (
          <span className="sr-only">{t.count(addressGroup.options.length, placeGroup.options.length)}</span>
        )}
      </p>
      {addressFailed && <p className={styles.error}>{t.addressError}</p>}
      <p id={hintId} className={styles.hint}>
        {t.source}
      </p>
    </div>
  );
}
