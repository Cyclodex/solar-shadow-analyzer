import { Button } from '../../components/Button';
import { DownloadIcon, ResetIcon } from '../../components/icons';
import { Spinner } from '../../components/Spinner';
import { useMessages, type Messages } from '../../i18n';
import { retryAddressImport, useUnplacedAddress } from '../../state/addressPointStore';
import { goToSitePlan, usePlacementNeed, type PlacementNeed } from './placementNeed';
import styles from './PlacementPrompt.module.css';

// ─────────────────────────────────────────────
// LOCATION NOT YET PLACED ON A FACADE (docs/ARCHITECTURE.md, "Integration")
// After an address pick the location is the address point inside the building: the laser scan waits
// ('waiting') until the site plan places the balcony. Where the user is, this says what happens and what to do:
// the building import under way (the site plan opens after it), «Zum Lageplan» once the buildings are there, or
// the import's failure with «Erneut versuchen» (without buildings the balcony cannot be placed). Used in the
// «Standort» section, next to the annual results and in the laser-scan status.
// ─────────────────────────────────────────────

const de = {
  loading:
    'Gebäude der Umgebung werden geladen … Danach öffnet sich der Lageplan, um Fassade und Balkon zu bestätigen.',
  place:
    'Standort noch nicht bestätigt: Der Adresspunkt liegt im Gebäude. Im Lageplan Fassade und Balkon wählen und «Übernehmen», erst dann wird der Laserscan geladen.',
  goPlan: 'Zum Lageplan',
  failed:
    'Die Gebäude der Umgebung konnten nicht geladen werden. Ohne sie lässt sich der Balkon nicht im Lageplan setzen, und der Laserscan wartet: Der Adresspunkt liegt im Gebäude.',
  notLoaded:
    'Die Gebäude der Umgebung sind nicht geladen. Ohne sie lässt sich der Balkon nicht im Lageplan setzen, und der Laserscan wartet: Der Adresspunkt liegt im Gebäude.',
  coordinates: 'Alternativ die Koordinaten des Balkons unter «Koordinaten & Zeitzone» eingeben.',
  retry: 'Erneut versuchen',
  load: 'Gebäude laden',
  results: 'vorläufig – Standort noch nicht im Lageplan bestätigt',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    loading: 'Loading the surrounding buildings … Then the site plan opens to confirm facade and balcony.',
    place:
      'Location not confirmed yet: the address point lies inside the building. Choose facade and balcony in the site plan and «Apply»; only then the laser scan loads.',
    goPlan: 'Go to the site plan',
    failed:
      'The surrounding buildings could not be loaded. Without them the balcony cannot be set in the site plan, and the laser scan waits: the address point lies inside the building.',
    notLoaded:
      'The surrounding buildings are not loaded. Without them the balcony cannot be set in the site plan, and the laser scan waits: the address point lies inside the building.',
    coordinates: 'Alternatively enter the coordinates of the balcony under «Coordinates & time zone».',
    retry: 'Try again',
    load: 'Load buildings',
    results: 'provisional – location not confirmed in the site plan yet',
  },
};

/** The action of a need: open the site plan, or load the buildings of the address point again. */
function PlacementAction({ need }: { need: PlacementNeed }) {
  const t = useMessages(messages);
  if (need === 'plan') {
    return (
      <Button size="sm" onClick={goToSitePlan} data-site-plan-source="">
        {t.goPlan}
      </Button>
    );
  }
  if (need === 'failed' || need === 'missing') {
    return (
      <Button
        size="sm"
        icon={need === 'failed' ? <ResetIcon /> : <DownloadIcon />}
        onClick={retryAddressImport}
        data-site-plan-source=""
      >
        {need === 'failed' ? t.retry : t.load}
      </Button>
    );
  }
  return null;
}

/**
 * Below the search in «Standort»: the import after an address pick, then the prompt to confirm facade and
 * balcony (or the import's failure). Nothing once the location is placed.
 */
export function AddressPlacementStatus() {
  const t = useMessages(messages);
  const need = usePlacementNeed();
  const unplaced = useUnplacedAddress() !== null;
  if (!unplaced || need === 'none') return null;
  if (need === 'loading') {
    return (
      <div className={styles.root}>
        <Spinner label={t.loading} showLabel size="sm" />
      </div>
    );
  }
  const problem = need === 'failed' || need === 'missing';
  return (
    <div
      className={problem ? `${styles.root} ${styles.problem}` : styles.root}
      role={problem ? 'alert' : 'status'}
    >
      <p>{need === 'plan' ? t.place : need === 'failed' ? t.failed : t.notLoaded}</p>
      {problem && <p className={styles.hint}>{t.coordinates}</p>}
      <div>
        <PlacementAction need={need} />
      </div>
    </div>
  );
}

/**
 * Next to the annual results while the laser scan waits for the location: the values are provisional (computed
 * for the address point without the scan); the action opens the site plan or loads the buildings.
 */
export function UnconfirmedResultsNote({ className }: { className?: string }) {
  const t = useMessages(messages);
  const need = usePlacementNeed();
  if (need === 'none') return null;
  return (
    <div className={[styles.results, className].filter(Boolean).join(' ')}>
      <p>{t.results}</p>
      <PlacementAction need={need} />
    </div>
  );
}

/** The action for the laser-scan status while it waits (its text says why). */
export function WaitingAction() {
  const need = usePlacementNeed();
  return <PlacementAction need={need} />;
}
