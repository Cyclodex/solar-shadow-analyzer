import { useId } from 'react';
import { Button } from '../components/Button';
import { NumberField } from '../components/NumberField';
import { Spinner } from '../components/Spinner';
import { useFormat, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { LIMITS } from '../model/defaults';
import { useAnnualResultsState, useTiltSweep } from '../hooks/useModel';
import { useConfigSection, usePatch } from '../state/configStore';
import styles from './TiltControl.module.css';

const de = {
  heading: 'Panelneigung',
  field: 'Neigung θ ab Senkrechte',
  scale: '0° = senkrecht hängend, 90° = liegend',
  optimum: (deg: string) => `Optimum: ${deg}`,
  optimumMark: (deg: string) => `Opt. ${deg}`,
  apply: (deg: string) => `Optimum ${deg} übernehmen`,
  isOptimum: 'Aktuelle Neigung ist das Optimum',
  optimumSub: (kwh: string) => `höchster Jahresertrag aller Stockwerke: ${kwh}`,
  clearSky: '(klarer Himmel)',
  computing: 'Optimum wird berechnet …',
  sweepNote: 'Gerechnet in 5°-Schritten.',
  provisional: 'vorläufig – Geländehorizont wird geladen',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    heading: 'Panel tilt',
    field: 'Tilt θ from vertical',
    scale: '0° = hanging vertically, 90° = lying flat',
    optimum: (deg) => `Optimum: ${deg}`,
    optimumMark: (deg) => `Opt. ${deg}`,
    apply: (deg) => `Apply optimum ${deg}`,
    isOptimum: 'The current tilt is the optimum',
    optimumSub: (kwh) => `highest annual yield of all floors: ${kwh}`,
    clearSky: '(clear sky)',
    computing: 'Computing optimum …',
    sweepNote: 'Computed in 5° steps.',
    provisional: 'provisional – loading terrain horizon',
  },
};

/**
 * Prominent tilt control (θ from vertical, β = 90° − θ as secondary hint) with the optimum tilt of the
 * tilt sweep (annual total of all floors) as slider mark and apply button. While the weather of a new site
 * or year is still arriving a spinner replaces the optimum; while only the terrain horizon is (after
 * PROVISIONAL_DELAY_MS), the optimum without it is shown dimmed and marked as provisional, without the
 * apply button; while the sweep is being updated after another input changed, the previous optimum is
 * shown dimmed.
 */
export function TiltControl() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const id = useId();
  const panels = useConfigSection('panels');
  const patch = usePatch();
  // While a new weather series loads, the store still holds the previous one (possibly of another site or
  // year), and a newly arrived series reaches the deferred sweep one render later: no optimum until the
  // weather is final. While only the terrain horizon loads, the optimum is provisional.
  const annualState = useAnnualResultsState();
  const sweep = useTiltSweep(annualState !== 'loading');
  const provisional = annualState === 'provisional';
  const theta = panels.tiltFromVertical;
  const optimum = sweep?.optimum;
  const updating = sweep?.updating === true;
  const dimmed = updating || provisional;
  const setTilt = (v: number): void => patch('panels', { tiltFromVertical: v });

  return (
    <section className={styles.card} aria-labelledby={`${id}-heading`}>
      <div className={styles.head}>
        <h2 id={`${id}-heading`} className={styles.heading}>
          {t.heading}
        </h2>
        <p className={styles.big} aria-hidden="true">
          <span className={styles.symbol}>{c.tiltSymbol}</span> {f.deg(theta)}
        </p>
      </div>
      <p className={styles.beta}>{c.tiltFromHorizontalHint(f.deg(90 - theta))}</p>
      <NumberField
        label={t.field}
        value={theta}
        onChange={setTilt}
        limit={LIMITS.panels.tiltFromVertical}
        unit="°"
        hint={t.scale}
        marks={
          optimum
            ? [
                {
                  value: optimum.tiltFromVertical,
                  label: t.optimumMark(f.deg(optimum.tiltFromVertical)),
                  tone: 'sun',
                },
              ]
            : undefined
        }
      />
      <div className={styles.optimum} aria-live="polite" aria-busy={updating || undefined}>
        {sweep && optimum ? (
          <>
            <div className={dimmed ? `${styles.optimumText} ${styles.updating}` : styles.optimumText}>
              <strong>{t.optimum(f.deg(optimum.tiltFromVertical))}</strong>
              <span className={styles.sub}>
                {t.optimumSub(f.kwh(optimum.totalKwh))} {sweep.source === 'clear-sky' ? t.clearSky : ''}
              </span>
              <span className={styles.sub}>{provisional ? t.provisional : t.sweepNote}</span>
            </div>
            {provisional ? null : optimum.tiltFromVertical === theta ? (
              <span className={styles.badge}>{t.isOptimum}</span>
            ) : (
              <Button size="sm" onClick={() => setTilt(optimum.tiltFromVertical)}>
                {t.apply(f.deg(optimum.tiltFromVertical))}
              </Button>
            )}
          </>
        ) : (
          <Spinner label={t.computing} showLabel size="sm" />
        )}
      </div>
    </section>
  );
}
