import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { useFormat, useMessages, type Messages } from '../../i18n';
import { NEAREST_ADDRESS_RADIUS, findNearestAddress, type SwissAddress } from '../../model/geocode';
import { formatCoordinateName } from '../../model/share';
import type { LocationConfig } from '../../model/types';
import { roundToStep } from '../../model/units';
import { LocateIcon } from '../icons';
import { deviceTimeZone } from './timeZones';
import styles from './MyLocationButton.module.css';

/** Options of the position request: a cached fix up to 5 min old is fine, give up after 15 s. */
const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 };

type Failure = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

type State =
  | { status: 'idle' }
  | { status: 'locating' }
  /** `latitude`/`longitude`: the fix as stored in the config (1e-6°). */
  | { status: 'done'; accuracy: number; latitude: number; longitude: number }
  | { status: 'error'; reason: Failure };

/** «Nächste Adresse übernehmen»: reverse lookup of the fix (swisstopo address directory). */
type Nearest =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; label: string; distance: number }
  | { status: 'none' }
  | { status: 'error' };

const de = {
  button: 'Mein Standort',
  locating: 'Standort wird ermittelt …',
  done: (accuracy: string) => `Position übernommen (Genauigkeit ± ${accuracy}).`,
  denied: 'Der Zugriff auf den Standort wurde verweigert. Bitte im Browser erlauben oder den Ort suchen.',
  unavailable: 'Der Standort konnte nicht ermittelt werden.',
  timeout: 'Die Standortabfrage hat zu lange gedauert. Bitte erneut versuchen.',
  unsupported: 'Dieser Browser kann den Standort nicht ermitteln.',
  nearest: 'Nächste Adresse übernehmen',
  searching: 'Nächste Adresse wird gesucht …',
  nearestDone: (label: string, distance: string) => `Übernommen: ${label} (${distance} von der Position).`,
  nearestNone: (radius: string) =>
    `Keine Gebäudeadresse im Umkreis von ${radius} (nur Schweiz und Liechtenstein).`,
  nearestError: 'Die Adresssuche (swisstopo) ist gerade nicht erreichbar.',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    button: 'My location',
    locating: 'Determining your location …',
    done: (accuracy) => `Position applied (accuracy ± ${accuracy}).`,
    denied: 'Access to your location was denied. Allow it in the browser or search for the place.',
    unavailable: 'Your location could not be determined.',
    timeout: 'The location request took too long. Please try again.',
    unsupported: 'This browser cannot determine your location.',
    nearest: 'Use the nearest address',
    searching: 'Looking for the nearest address …',
    nearestDone: (label, distance) => `Applied: ${label} (${distance} from the position).`,
    nearestNone: (radius) => `No building address within ${radius} (Switzerland and Liechtenstein only).`,
    nearestError: 'The address search (swisstopo) cannot be reached right now.',
  },
};

/** Part of the location set from the device position (the elevation stays as it is). */
export type DeviceLocation = Pick<LocationConfig, 'name' | 'latitude' | 'longitude'> &
  Partial<Pick<LocationConfig, 'timezone'>>;

export interface MyLocationButtonProps {
  onLocate: (location: DeviceLocation) => void;
  /**
   * Applies the nearest building address. With it (and `location`), the button offers «Nächste Adresse
   * übernehmen» while the location still is the device position.
   */
  onAddress?: (address: SwissAddress) => void;
  /** The current location (config). */
  location?: Pick<LocationConfig, 'latitude' | 'longitude'>;
}

/** Geolocation error code (1 denied, 2 unavailable, 3 timeout) → message key. */
function failureOf(error: GeolocationPositionError): Failure {
  if (error.code === 1) return 'denied';
  if (error.code === 3) return 'timeout';
  return 'unavailable';
}

/**
 * "My location": asks the browser for the device position (navigator.geolocation) and reports it with a
 * coordinate label ("47.100° N, 7.450° E") and the device time zone. Shows progress and readable errors. In
 * Switzerland and Liechtenstein it then offers the nearest building address (a request to geo.admin.ch only on
 * that click).
 */
export function MyLocationButton({ onLocate, onAddress, location }: MyLocationButtonProps) {
  const t = useMessages(messages);
  const f = useFormat();
  const [state, setState] = useState<State>({ status: 'idle' });
  const [nearest, setNearest] = useState<Nearest>({ status: 'idle' });
  const lookup = useRef<AbortController | null>(null);
  /** «Mein Standort»: takes the focus when the offer button disappears after it was used. */
  const locateButton = useRef<HTMLButtonElement>(null);
  const offerButton = useRef<HTMLButtonElement>(null);

  // A lookup still running when the section closes is dropped.
  useEffect(() => () => lookup.current?.abort(), []);

  const locate = (): void => {
    const geo: Geolocation | undefined = navigator.geolocation;
    lookup.current?.abort();
    setNearest({ status: 'idle' });
    if (!geo) {
      setState({ status: 'error', reason: 'unsupported' });
      return;
    }
    setState({ status: 'locating' });
    geo.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const timezone = deviceTimeZone();
        onLocate({
          name: formatCoordinateName(latitude, longitude),
          latitude,
          longitude,
          ...(timezone ? { timezone } : {}),
        });
        setState({
          status: 'done',
          accuracy,
          latitude: roundToStep(latitude, 1e-6),
          longitude: roundToStep(longitude, 1e-6),
        });
      },
      (error) => setState({ status: 'error', reason: failureOf(error) }),
      GEO_OPTIONS,
    );
  };

  const applyNearest = (latitude: number, longitude: number): void => {
    if (!onAddress || nearest.status === 'searching') return;
    const hadFocus = document.activeElement === offerButton.current;
    lookup.current?.abort();
    const ctrl = new AbortController();
    lookup.current = ctrl;
    setNearest({ status: 'searching' });
    void findNearestAddress(latitude, longitude, { signal: ctrl.signal }).then((res) => {
      if (ctrl.signal.aborted) return;
      if (!res.ok) setNearest({ status: 'error' });
      else if (!res.value) setNearest({ status: 'none' });
      else {
        const focus = document.activeElement;
        onAddress(res.value.address);
        setNearest({ status: 'done', label: res.value.address.label, distance: res.value.distance });
        // The offer goes away with the new location: keep the keyboard focus in this group.
        if (hadFocus && (focus === offerButton.current || focus === document.body))
          locateButton.current?.focus();
      }
    });
  };

  let message: string | null = null;
  if (state.status === 'locating') message = t.locating;
  else if (state.status === 'done') {
    const a = state.accuracy;
    message = t.done(a >= 1000 ? f.unit(a / 1000, 'km', 1) : f.unit(a, 'm'));
  } else if (state.status === 'error') message = t[state.reason];

  let nearestMessage: string | null = null;
  if (nearest.status === 'searching') nearestMessage = t.searching;
  else if (nearest.status === 'done')
    nearestMessage = t.nearestDone(nearest.label, f.unit(nearest.distance, 'm'));
  else if (nearest.status === 'none') nearestMessage = t.nearestNone(f.unit(NEAREST_ADDRESS_RADIUS, 'm'));
  else if (nearest.status === 'error') nearestMessage = t.nearestError;

  const offerNearest =
    onAddress !== undefined &&
    state.status === 'done' &&
    location?.latitude === state.latitude &&
    location.longitude === state.longitude &&
    nearest.status !== 'done';

  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <Button
          ref={locateButton}
          icon={<LocateIcon />}
          onClick={locate}
          disabled={state.status === 'locating'}
        >
          {t.button}
        </Button>
        <p className={state.status === 'error' ? styles.error : styles.message} role="status">
          {message}
        </p>
      </div>
      {(offerNearest || nearestMessage) && (
        <div className={styles.row}>
          {offerNearest && state.status === 'done' && (
            <Button
              ref={offerButton}
              size="sm"
              onClick={() => applyNearest(state.latitude, state.longitude)}
              aria-busy={nearest.status === 'searching' || undefined}
            >
              {t.nearest}
            </Button>
          )}
          <p className={nearest.status === 'error' ? styles.error : styles.message} role="status">
            {nearestMessage}
          </p>
        </div>
      )}
    </div>
  );
}
