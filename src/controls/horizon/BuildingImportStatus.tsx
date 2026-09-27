import { useEffect, useRef } from 'react';
import { Button } from '../../components/Button';
import { cssVars } from '../../components/cssVars';
import { ResetIcon } from '../../components/icons';
import {
  abortBuildingImport,
  confirmBuildingImport,
  dismissBuildingImport,
  retryBuildingImport,
} from '../../hooks/useBuildingImport';
import { useFormat, useMessages, type Messages } from '../../i18n';
import type { BuildingSourceError } from '../../model/buildingSources';
import { useBuildingImportStore } from '../../state/buildingImportStore';
import { useConfigSection } from '../../state/configStore';
import styles from './BuildingList.module.css';

const de = {
  tiles: (done: number, total: number, mb: string) =>
    total > 0 ? `Gebäude werden geladen … ${done} von ${total} Kacheln, ${mb}` : 'Gebäude werden geladen …',
  select: (done: number, total: number) => `Gebäude werden ausgewählt … ${done} von ${total}`,
  progress: 'Fortschritt Gebäude-Import',
  abort: 'Abbrechen',
  error: 'Die Gebäude konnten nicht geladen werden.',
  errorKept: 'Die Gebäude konnten nicht geladen werden. Die bisherigen bleiben.',
  retry: 'Erneut versuchen',
  details: 'Technische Details',
  network: 'Keine Verbindung zum Server (offline oder blockiert).',
  http: (status: number) => `Der Server hat mit Fehler ${status} geantwortet.`,
  timeout: 'Der Server hat nicht rechtzeitig geantwortet.',
  data: 'Die empfangenen Daten sind unvollständig oder fehlerhaft.',
  input: 'Für diesen Standort ist kein Import möglich.',
  unavailable: 'Gebäudedaten von swisstopo gibt es nur in der Schweiz und in Liechtenstein.',
  coverage: 'Gebäude ausserhalb der Schweiz und Liechtensteins fehlen.',
  result: (found: string, stored: string, horizon: string, radius: string) =>
    `${found} Gebäudeteile im Umkreis von ${radius} gefunden, ${stored} übernommen: ${horizon} bestimmen den Horizont einer möglichen Fassade, die übrigen stehen in der Nähe.`,
  dropped: (n: number, deg: string) =>
    `${n} weitere Gebäude (Horizont bis ${deg}) passen nicht mehr in die Liste.`,
  droppedManual: (n: number) =>
    n === 1
      ? '1 von Hand erfasstes Gebäude lag über 2 km entfernt und wurde entfernt.'
      : `${n} von Hand erfasste Gebäude lagen über 2 km entfernt und wurden entfernt.`,
  confirmTitle: 'Gebäude neu laden?',
  confirmAddress: 'Für die gewählte Adresse lassen sich die Gebäude neu laden.',
  confirmText: (n: number) =>
    `Die Änderungen an ${n === 1 ? '1 importierten Gebäude' : `${n} importierten Gebäuden`} (entfernt oder Höhe geändert) gehen dabei verloren. Von Hand erfasste Gebäude bleiben.`,
  confirm: 'Neu laden',
  keep: 'Behalten',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    tiles: (done, total, mb) =>
      total > 0 ? `Loading buildings … ${done} of ${total} tiles, ${mb}` : 'Loading buildings …',
    select: (done, total) => `Selecting buildings … ${done} of ${total}`,
    progress: 'Building import progress',
    abort: 'Cancel',
    error: 'The buildings could not be loaded.',
    errorKept: 'The buildings could not be loaded. The previous ones stay.',
    retry: 'Try again',
    details: 'Technical details',
    network: 'No connection to the server (offline or blocked).',
    http: (status) => `The server responded with error ${status}.`,
    timeout: 'The server did not respond in time.',
    data: 'The received data are incomplete or invalid.',
    input: 'No import is possible for this location.',
    unavailable: 'swisstopo building data is only available in Switzerland and Liechtenstein.',
    coverage: 'Buildings outside Switzerland and Liechtenstein are missing.',
    result: (found, stored, horizon, radius) =>
      `${found} building parts found within ${radius}, ${stored} kept: ${horizon} set the horizon of a possible facade, the others are nearby.`,
    dropped: (n, deg) => `${n} more buildings (horizon up to ${deg}) no longer fit into the list.`,
    droppedManual: (n) =>
      n === 1
        ? '1 manually entered building was more than 2 km away and was removed.'
        : `${n} manually entered buildings were more than 2 km away and were removed.`,
    confirmTitle: 'Reload the buildings?',
    confirmAddress: 'The buildings can be reloaded for the chosen address.',
    confirmText: (n) =>
      `The changes to ${n === 1 ? '1 imported building' : `${n} imported buildings`} (removed or height changed) will be lost. Manually entered buildings stay.`,
    confirm: 'Reload',
    keep: 'Keep',
  },
};

function causeText(error: BuildingSourceError, t: typeof de): string {
  switch (error.kind) {
    case 'network':
    case 'aborted':
      return t.network;
    case 'http':
      return t.http(error.status ?? 0);
    case 'timeout':
      return t.timeout;
    case 'decode':
      return t.data;
    case 'invalid-input':
      return t.input;
  }
}

/**
 * State of the swisstopo building import: progress with abort, error with retry, «only in Switzerland and
 * Liechtenstein», the result of the last import (with the border note), and the confirmation before a
 * re-import discards changes to imported buildings.
 */
export function BuildingImportStatus() {
  const t = useMessages(messages);
  const f = useFormat();
  const s = useBuildingImportStore();
  const { buildings, buildingImport } = useConfigSection('horizon');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // «Erneut versuchen» and «Abbrechen» unmount with their block: the focus moves to the status.
  const keepFocus = (): void => rootRef.current?.focus({ preventScroll: true });
  const edits = buildings.filter((b) => b.source === 'swisstopo' && (b.removed || b.edited)).length;
  const confirming = s.pendingConfirm !== null && s.status !== 'loading';

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  return (
    <div ref={rootRef} tabIndex={-1} className={styles.importStatus}>
      {s.status === 'loading' && s.progress && (
        <div className={styles.loading}>
          <div className={styles.loadingText}>
            <span className={styles.label} aria-hidden="true">
              {s.progress.phase === 'tiles'
                ? t.tiles(s.progress.done, s.progress.total, f.unit(s.progress.bytes / 1e6, 'MB', 1))
                : t.select(s.progress.done, s.progress.total)}
            </span>
            <ProgressBar
              label={t.progress}
              value={
                s.progress.total > 0
                  ? (s.progress.phase === 'tiles' ? 0 : 0.5) + (0.5 * s.progress.done) / s.progress.total
                  : 0
              }
              valueText={(pct) => f.pct(pct)}
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              abortBuildingImport();
              keepFocus();
            }}
          >
            {t.abort}
          </Button>
        </div>
      )}

      {s.status === 'error' && s.error && (
        <div className={styles.warn} role="alert">
          <p>{buildings.length > 0 ? t.errorKept : t.error}</p>
          <p className={styles.cause}>{causeText(s.error, t)}</p>
          <details className={styles.details}>
            <summary>{t.details}</summary>
            <code lang="en" translate="no">
              {s.error.message}
            </code>
          </details>
          <div>
            <Button
              size="sm"
              icon={<ResetIcon />}
              onClick={() => {
                retryBuildingImport();
                keepFocus();
              }}
            >
              {t.retry}
            </Button>
          </div>
        </div>
      )}

      {s.status === 'unavailable' && <p className={styles.note}>{t.unavailable}</p>}

      {s.status === 'ready' && s.summary && (
        <div className={styles.note}>
          <p>
            {t.result(
              f.int(s.summary.found),
              f.int(s.summary.stored),
              f.int(s.summary.horizon),
              f.unit(buildingImport?.radius ?? 0, 'm'),
            )}
          </p>
          {s.summary.coverage < 1 && <p>{t.coverage}</p>}
          {s.summary.droppedSetters > 0 && (
            <p>{t.dropped(s.summary.droppedSetters, f.deg(s.summary.maxDroppedScore, 1))}</p>
          )}
          {s.summary.droppedManual > 0 && <p>{t.droppedManual(s.summary.droppedManual)}</p>}
        </div>
      )}

      {confirming && (
        <div className={styles.confirm} role="group" aria-label={t.confirmTitle}>
          <p className={styles.confirmTitle}>{t.confirmTitle}</p>
          {s.pendingConfirm?.reason === 'address' && <p>{t.confirmAddress}</p>}
          <p>{t.confirmText(edits)}</p>
          <div className={styles.actions}>
            <Button ref={confirmRef} size="sm" variant="primary" onClick={() => confirmBuildingImport()}>
              {t.confirm}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissBuildingImport}>
              {t.keep}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({
  label,
  value,
  valueText,
}: {
  label: string;
  value: number;
  valueText: (pct: number) => string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={styles.bar}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={valueText(pct)}
      style={cssVars({ '--progress': pct / 100 })}
    >
      <span className={styles.fill} />
    </div>
  );
}
