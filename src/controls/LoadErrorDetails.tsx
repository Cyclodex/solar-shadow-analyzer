import { useMessages, type Messages } from '../i18n';
import { classifyLoadError, type LoadErrorCause } from './loadError';
import styles from './LoadErrorDetails.module.css';

const de = {
  details: 'Technische Details',
  network: 'Keine Verbindung zum Server (offline oder blockiert).',
  http: (status: number) => `Der Server hat mit Fehler ${status} geantwortet.`,
  data: 'Die empfangenen Daten sind unvollständig oder fehlerhaft.',
  noElevation: 'Für diesen Standort gibt es keine Höhendaten.',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    details: 'Technical details',
    network: 'No connection to the server (offline or blocked).',
    http: (status) => `The server responded with error ${status}.`,
    data: 'The received data are incomplete or invalid.',
    noElevation: 'There is no elevation data for this site.',
  },
};

function causeText(cause: LoadErrorCause, t: typeof de): string {
  switch (cause.kind) {
    case 'network':
      return t.network;
    case 'http':
      return t.http(cause.status);
    case 'data':
      return t.data;
    case 'no-elevation':
      return t.noElevation;
  }
}

/**
 * Translated cause of a failed load plus the raw technical message (English, from the loader) in a
 * collapsed disclosure, marked as English so that screen readers pronounce it correctly.
 */
export function LoadErrorDetails({ error }: { error: string | null }) {
  const t = useMessages(messages);
  if (!error) return null;
  const cause = classifyLoadError(error);
  return (
    <>
      {cause && <p className={styles.cause}>{causeText(cause, t)}</p>}
      <details className={styles.details}>
        <summary>{t.details}</summary>
        <code lang="en" translate="no">
          {error}
        </code>
      </details>
    </>
  );
}
