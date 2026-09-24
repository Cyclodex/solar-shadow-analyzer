import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useFormat, useLang, useMessages, type Messages } from '../../i18n';
import { searchLocations } from '../../model/presets';
import type { LocationConfig } from '../../model/types';
import { SearchIcon } from '../icons';
import styles from './PlaceSearch.module.css';

/** Delay after the last keystroke before the geocoding request, ms. */
export const SEARCH_DEBOUNCE_MS = 300;
/** Queries shorter than this are not sent (searchLocations returns [] for them anyway). */
export const MIN_QUERY_LENGTH = 2;
/** Remembered result lists (per language + query) while the component is mounted. */
const MAX_CACHED_QUERIES = 20;

const de = {
  label: 'Ort suchen',
  placeholder: 'z. B. Bern, Wien, Freiburg …',
  searching: 'Suche läuft …',
  tooShort: `Mindestens ${MIN_QUERY_LENGTH} Zeichen eingeben.`,
  none: (q: string) => `Keine Treffer für «${q}» – oder die Ortssuche ist nicht erreichbar.`,
  count: (n: number) =>
    n === 1 ? '1 Ort gefunden, mit Pfeiltasten auswählen.' : `${n} Orte gefunden, mit Pfeiltasten auswählen.`,
  picked: (name: string) => `Übernommen: ${name}`,
  results: 'Suchergebnisse',
  source: 'Ortssuche: Open-Meteo Geocoding (Daten: GeoNames).',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    label: 'Search place',
    placeholder: 'e.g. Bern, Vienna, Freiburg …',
    searching: 'Searching …',
    tooShort: `Type at least ${MIN_QUERY_LENGTH} characters.`,
    none: (q) => `No places found for “${q}” – or the place search cannot be reached.`,
    count: (n) =>
      n === 1
        ? '1 place found, use the arrow keys to choose.'
        : `${n} places found, use the arrow keys to choose.`,
    picked: (name) => `Applied: ${name}`,
    results: 'Search results',
    source: 'Place search: Open-Meteo Geocoding (data: GeoNames).',
  },
};

export interface PlaceSearchProps {
  /** Called with the complete location (name, coordinates, time zone, elevation) of the chosen result. */
  onSelect: (location: LocationConfig) => void;
}

type ResultCache = ReadonlyMap<string, readonly LocationConfig[]>;

/**
 * Place search as an ARIA 1.2 combobox (input + listbox, aria-activedescendant): debounced Open-Meteo
 * geocoding (searchLocations) with AbortController, ArrowDown/ArrowUp move through the results, Enter
 * applies the active (or first) result, Escape closes the list and then clears the input.
 */
export function PlaceSearch({ onSelect }: PlaceSearchProps) {
  const t = useMessages(messages);
  const f = useFormat();
  const lang = useLang();
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const optionId = (i: number): string => `${id}-option-${i}`;

  const [query, setQuery] = useState('');
  const [cache, setCache] = useState<ResultCache>(() => new Map());
  /**
   * Key of the latest request that returned nothing. Not cached like hits: searchLocations also returns []
   * on network errors, so typing the query again must ask again.
   */
  const [emptyKey, setEmptyKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [picked, setPicked] = useState<string | null>(null);

  const q = query.trim();
  const key = `${lang}|${q}`;
  const tooShort = q.length < MIN_QUERY_LENGTH;
  const results = tooShort ? null : (cache.get(key) ?? (emptyKey === key ? [] : null));
  const searching = !tooShort && results === null;
  const options = results ?? [];
  const expanded = open && options.length > 0;
  const activeIndex = active < options.length ? active : -1;

  // Debounced request; a newer query (or unmount) aborts the running one.
  useEffect(() => {
    const k = `${lang}|${q}`;
    if (q.length < MIN_QUERY_LENGTH || cache.has(k) || emptyKey === k) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void searchLocations(q, lang, { signal: ctrl.signal }).then((found) => {
        if (ctrl.signal.aborted) return;
        if (found.length === 0) {
          setEmptyKey(k);
          return;
        }
        setCache((prev) => {
          const next = new Map(prev);
          next.set(k, found);
          while (next.size > MAX_CACHED_QUERIES) next.delete(next.keys().next().value as string);
          return next;
        });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, lang, cache, emptyKey]);

  // Keep the active option visible inside the scrolling list.
  useEffect(() => {
    if (!expanded || activeIndex < 0) return;
    document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, activeIndex, id]);

  const choose = (location: LocationConfig): void => {
    onSelect(location);
    setPicked(location.name);
    setQuery('');
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    const n = options.length;
    switch (e.key) {
      case 'ArrowDown':
        if (n === 0) return;
        e.preventDefault();
        setOpen(true);
        setActive(expanded ? (activeIndex + 1) % n : Math.max(0, activeIndex));
        break;
      case 'ArrowUp':
        if (n === 0) return;
        e.preventDefault();
        setOpen(true);
        setActive(activeIndex <= 0 ? n - 1 : activeIndex - 1);
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
          setActive(-1);
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
  } else if (results && results.length === 0) status = t.none(q);
  else if (!q && picked) status = t.picked(picked);

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
            setEmptyKey(null);
            setOpen(true);
            setActive(-1);
            setPicked(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </div>
      <ul id={listId} role="listbox" aria-label={t.results} className={styles.list} hidden={!expanded}>
        {expanded &&
          options.map((loc, i) => (
            <li
              key={`${loc.name}|${loc.latitude}|${loc.longitude}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className={styles.option}
              // Keep the focus in the input (no blur before the click).
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => {
                if (i !== activeIndex) setActive(i);
              }}
              onClick={() => choose(loc)}
            >
              <span className={styles.optionName}>{loc.name}</span>
              <span className={styles.optionMeta}>
                {f.coords(loc.latitude, loc.longitude)} · {f.unit(loc.elevation, 'm')} · {loc.timezone}
              </span>
            </li>
          ))}
      </ul>
      <p className={styles.status} role="status">
        {showSpinner && <span className={styles.spinner} aria-hidden="true" />}
        {status}
        {expanded && <span className="sr-only">{t.count(options.length)}</span>}
      </p>
      <p id={hintId} className={styles.hint}>
        {t.source}
      </p>
    </div>
  );
}
