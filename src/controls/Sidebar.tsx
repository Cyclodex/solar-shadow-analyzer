import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { ResetIcon } from '../components/icons';
import { useMessages, type Messages } from '../i18n';
import { useConfigStore } from '../state/configStore';
import { BatterySection } from './BatterySection';
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

/**
 * Reset of the whole config with an inline confirmation step. The safe choice (cancel) gets the focus;
 * Escape cancels; closing the step returns the focus to the reset button.
 */
function ResetButton() {
  const t = useMessages(messages);
  const reset = useConfigStore((s) => s.reset);
  const [confirming, setConfirming] = useState(false);
  const resetRef = useRef<HTMLButtonElement>(null);
  /** Set when the confirmation closes, so that the focus only moves back then (not on mount). */
  const restoreFocus = useRef(false);
  const textId = useId();

  useEffect(() => {
    if (!confirming && restoreFocus.current) {
      restoreFocus.current = false;
      resetRef.current?.focus();
    }
  }, [confirming]);

  const close = (): void => {
    restoreFocus.current = true;
    setConfirming(false);
  };

  if (!confirming) {
    return (
      <Button ref={resetRef} variant="ghost" icon={<ResetIcon />} onClick={() => setConfirming(true)}>
        {t.reset}
      </Button>
    );
  }
  return (
    <div
      className={styles.confirm}
      role="group"
      aria-label={t.reset}
      aria-describedby={textId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <p id={textId} className={styles.confirmText}>
        {t.confirm}
      </p>
      <div className={styles.confirmActions}>
        <Button autoFocus aria-describedby={textId} onClick={close}>
          {t.cancel}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            reset();
            close();
          }}
        >
          {t.yes}
        </Button>
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
      <BatterySection />
      <HorizonSection />
      <WeatherSection />
      <EconomicsSection />
      <div className={styles.reset}>
        <ResetButton />
      </div>
    </div>
  );
}
