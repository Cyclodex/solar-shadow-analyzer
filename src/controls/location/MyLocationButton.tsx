import { useState } from 'react';
import { Button } from '../../components/Button';
import { useFormat, useMessages, type Messages } from '../../i18n';
import { formatCoordinateName } from '../../model/share';
import type { LocationConfig } from '../../model/types';
import { LocateIcon } from './icons';
import { deviceTimeZone } from './timeZones';
import styles from './MyLocationButton.module.css';

/** Options of the position request: a cached fix up to 5 min old is fine, give up after 15 s. */
const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 };

type Failure = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

type State =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'done'; accuracy: number }
  | { status: 'error'; reason: Failure };

const de = {
  button: 'Mein Standort',
  locating: 'Standort wird ermittelt …',
  done: (accuracy: string) => `Position übernommen (Genauigkeit ± ${accuracy}).`,
  denied: 'Der Zugriff auf den Standort wurde verweigert. Bitte im Browser erlauben oder den Ort suchen.',
  unavailable: 'Der Standort konnte nicht ermittelt werden.',
  timeout: 'Die Standortabfrage hat zu lange gedauert. Bitte erneut versuchen.',
  unsupported: 'Dieser Browser kann den Standort nicht ermitteln.',
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
  },
};

/** Part of the location set from the device position (the elevation stays as it is). */
export type DeviceLocation = Pick<LocationConfig, 'name' | 'latitude' | 'longitude'> &
  Partial<Pick<LocationConfig, 'timezone'>>;

export interface MyLocationButtonProps {
  onLocate: (location: DeviceLocation) => void;
}

/** Geolocation error code (1 denied, 2 unavailable, 3 timeout) → message key. */
function failureOf(error: GeolocationPositionError): Failure {
  if (error.code === 1) return 'denied';
  if (error.code === 3) return 'timeout';
  return 'unavailable';
}

/**
 * "My location": asks the browser for the device position (navigator.geolocation) and reports it with a
 * coordinate label ("47.100° N, 7.450° E") and the device time zone. Shows progress and readable errors.
 */
export function MyLocationButton({ onLocate }: MyLocationButtonProps) {
  const t = useMessages(messages);
  const f = useFormat();
  const [state, setState] = useState<State>({ status: 'idle' });

  const locate = (): void => {
    const geo: Geolocation | undefined = navigator.geolocation;
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
        setState({ status: 'done', accuracy });
      },
      (error) => setState({ status: 'error', reason: failureOf(error) }),
      GEO_OPTIONS,
    );
  };

  let message: string | null = null;
  if (state.status === 'locating') message = t.locating;
  else if (state.status === 'done') {
    const a = state.accuracy;
    message = t.done(a >= 1000 ? f.unit(a / 1000, 'km', 1) : f.unit(a, 'm'));
  } else if (state.status === 'error') message = t[state.reason];

  return (
    <div className={styles.root}>
      <Button icon={<LocateIcon />} onClick={locate} disabled={state.status === 'locating'}>
        {t.button}
      </Button>
      <p className={state.status === 'error' ? styles.error : styles.message} role="status">
        {message}
      </p>
    </div>
  );
}
