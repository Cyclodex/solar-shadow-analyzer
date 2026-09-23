import { useState } from 'react';
import { Button } from '../components/Button';
import { ResetIcon } from '../components/icons';
import { useMessages, type Messages } from '../i18n';
import { useConfigStore } from '../state/configStore';
import { BuildingSection } from './BuildingSection';
import { EconomicsSection } from './EconomicsSection';
import { HorizonSection } from './HorizonSection';
import { LocationSection } from './LocationSection';
import { PanelSection } from './PanelSection';
import { SystemSection } from './SystemSection';
import { TiltControl } from './TiltControl';
import { TimeControls } from './TimeControls';
import { WeatherSection } from './WeatherSection';
import styles from './Sidebar.module.css';

// The sidebar content comes in two blocks so that App can place them in different grid areas:
// on mobile the quick controls sit right below the KPIs and the settings after the analysis.

/** Time and tilt: the controls with immediate visual feedback. */
export function QuickControls() {
  return (
    <div className={styles.quick}>
      <TimeControls />
      <TiltControl />
    </div>
  );
}

const de = {
  heading: 'Einstellungen',
  reset: 'Alle Einstellungen zurücksetzen',
  confirm: 'Wirklich alle Einstellungen auf die Standardwerte zurücksetzen?',
  yes: 'Ja, zurücksetzen',
  cancel: 'Abbrechen',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    heading: 'Settings',
    reset: 'Reset all settings',
    confirm: 'Really reset all settings to their default values?',
    yes: 'Yes, reset',
    cancel: 'Cancel',
  },
};

/** Reset of the whole config with an inline confirmation step. */
function ResetButton() {
  const t = useMessages(messages);
  const reset = useConfigStore((s) => s.reset);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="ghost" icon={<ResetIcon />} onClick={() => setConfirming(true)}>
        {t.reset}
      </Button>
    );
  }
  return (
    <div className={styles.confirm} role="group" aria-label={t.reset}>
      <p className={styles.confirmText}>{t.confirm}</p>
      <div className={styles.confirmActions}>
        <Button
          variant="danger"
          autoFocus
          onClick={() => {
            reset();
            setConfirming(false);
          }}
        >
          {t.yes}
        </Button>
        <Button onClick={() => setConfirming(false)}>{t.cancel}</Button>
      </div>
    </div>
  );
}

/** Collapsible settings sections and the reset button. */
export function SettingsSections() {
  const t = useMessages(messages);
  return (
    <div className={styles.settings}>
      <h2 className={styles.heading}>{t.heading}</h2>
      <LocationSection />
      <BuildingSection />
      <PanelSection />
      <SystemSection />
      <HorizonSection />
      <WeatherSection />
      <EconomicsSection />
      <div className={styles.reset}>
        <ResetButton />
      </div>
    </div>
  );
}
