import { useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '../../components/Button';
import { compassPoint, useFormat, useLang, useMessages, type Messages } from '../../i18n';
import { pvgisHorizonUrl } from '../../model/pvgis';
import { MAX_HORIZON_POINTS } from '../../model/share';
import { useConfigSection, useConfigStore, usePatch } from '../../state/configStore';
import {
  MAX_IMPORT_BYTES,
  importHorizonText,
  pointsPeak,
  readFileText,
  type HorizonFormat,
} from './horizonData';
import { TrashIcon, UploadIcon } from '../icons';
import styles from './ManualHorizon.module.css';

type Result = { kind: 'ok' | 'error'; text: string };

const de = {
  heading: 'Eigener Horizont',
  none: 'Keine eigenen Horizontpunkte.',
  current: (n: number, el: string, az: string) => `${n} Punkte, höchster Wert ${el} bei ${az}`,
  clear: 'Punkte entfernen',
  cleared: 'Eigene Horizontpunkte entfernt.',
  file: 'Datei importieren …',
  fileInput: 'Horizontdatei',
  paste: 'Oder Daten einfügen',
  placeholder: 'azimut,höhe\n0,2.5\n45,4\n90,3.5',
  apply: 'Eingefügte Daten übernehmen',
  imported: (n: number, format: string) => `${n} Punkte aus ${format} übernommen.`,
  resampled: (n: number) => ` Auf ein Raster mit ${n} Punkten umgerechnet.`,
  noPoints: 'Keine gültigen Horizontpunkte gefunden.',
  tooLarge: 'Die Datei ist zu gross (max. 1 MB).',
  readError: 'Die Datei konnte nicht gelesen werden.',
  formatPvgis: 'PVGIS-Daten',
  formatCsv: 'CSV-Daten',
  formats:
    'Formate: PVGIS-Horizont (JSON, CSV oder «basic») oder eine Zeile «Azimut, Höhe» pro Punkt (Azimut ab Nord im Uhrzeigersinn, Grad). Ein Import ersetzt die bisherigen Punkte.',
  combine: 'Gelände, eigene Punkte und Hindernisse werden kombiniert; es zählt jeweils der höchste Wert.',
  pvgisLink: 'PVGIS-Horizont für diesen Standort öffnen',
  pvgisHint:
    'Die Seite zeigt JSON-Daten: speichern oder kopieren und hier einfügen. PVGIS erlaubt keinen direkten Abruf aus dem Browser.',
  newTab: '(neuer Tab)',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    heading: 'Custom horizon',
    none: 'No custom horizon points.',
    current: (n, el, az) => `${n} points, highest ${el} at ${az}`,
    clear: 'Remove points',
    cleared: 'Custom horizon points removed.',
    file: 'Import file …',
    fileInput: 'Horizon file',
    paste: 'Or paste data',
    placeholder: 'azimuth,elevation\n0,2.5\n45,4\n90,3.5',
    apply: 'Apply pasted data',
    imported: (n, format) => `${n} points imported from ${format}.`,
    resampled: (n) => ` Resampled to a grid of ${n} points.`,
    noPoints: 'No valid horizon points found.',
    tooLarge: 'The file is too large (max. 1 MB).',
    readError: 'The file could not be read.',
    formatPvgis: 'PVGIS data',
    formatCsv: 'CSV data',
    formats:
      'Formats: PVGIS horizon (JSON, CSV or “basic”) or one line “azimuth, elevation” per point (azimuth from north, clockwise, degrees). An import replaces the existing points.',
    combine: 'Terrain, custom points and obstacles are combined; the highest value counts.',
    pvgisLink: 'Open the PVGIS horizon for this location',
    pvgisHint:
      'The page shows JSON data: save or copy it and paste it here. PVGIS does not allow direct requests from the browser.',
    newTab: '(new tab)',
  },
};

/**
 * Manual horizon points: summary, clear, import from a file or pasted text (PVGIS output is detected
 * automatically, otherwise "azimuth,elevation" CSV) and a link to the PVGIS horizon of the site.
 */
export function ManualHorizon() {
  const t = useMessages(messages);
  const f = useFormat();
  const lang = useLang();
  const id = useId();
  const { manual } = useConfigSection('horizon');
  const { latitude, longitude } = useConfigSection('location');
  const patch = usePatch();
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const peak = useMemo(() => pointsPeak(manual), [manual]);

  const formatName = (format: HorizonFormat): string => (format === 'pvgis' ? t.formatPvgis : t.formatCsv);

  const apply = (raw: string): boolean => {
    const parsed = importHorizonText(raw);
    if (!parsed) {
      setResult({ kind: 'error', text: t.noPoints });
      return false;
    }
    patch('horizon', { manual: parsed.points });
    // Report what was stored (sanitizeConfig merges duplicate azimuths).
    const stored = useConfigStore.getState().config.horizon.manual.length;
    setResult({
      kind: 'ok',
      text:
        t.imported(stored, formatName(parsed.format)) +
        (parsed.resampled ? t.resampled(MAX_HORIZON_POINTS) : ''),
    });
    return true;
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // the same file can be chosen again
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setResult({ kind: 'error', text: t.tooLarge });
      return;
    }
    try {
      apply(await readFileText(file));
    } catch {
      setResult({ kind: 'error', text: t.readError });
    }
  };

  const azText = (az: number): string => `${f.deg(az, 1)} (${compassPoint(az, lang)})`;

  return (
    <div className={styles.root}>
      <h4 className={styles.heading}>{t.heading}</h4>
      <div className={styles.current}>
        <p className={styles.summary}>
          {peak ? t.current(manual.length, f.deg(peak.elevation, 1), azText(peak.azimuth)) : t.none}
        </p>
        {manual.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={<TrashIcon />}
            onClick={() => {
              patch('horizon', { manual: [] });
              setResult({ kind: 'ok', text: t.cleared });
            }}
          >
            {t.clear}
          </Button>
        )}
      </div>

      <div className={styles.import}>
        <Button size="sm" icon={<UploadIcon />} onClick={() => fileRef.current?.click()}>
          {t.file}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.json,text/csv,text/plain,application/json"
          aria-label={t.fileInput}
          hidden
          onChange={(e) => void onFile(e)}
        />
        <label htmlFor={`${id}-paste`} className={styles.label}>
          {t.paste}
        </label>
        <textarea
          id={`${id}-paste`}
          className={styles.textarea}
          rows={4}
          spellCheck={false}
          placeholder={t.placeholder}
          value={text}
          aria-describedby={`${id}-formats`}
          onChange={(e) => setText(e.target.value)}
        />
        <div>
          <Button
            size="sm"
            disabled={text.trim() === ''}
            onClick={() => {
              if (apply(text)) setText('');
            }}
          >
            {t.apply}
          </Button>
        </div>
        <p className={result?.kind === 'error' ? styles.error : styles.ok} role="status">
          {result?.text}
        </p>
      </div>

      <p id={`${id}-formats`} className={styles.hint}>
        {t.formats} {t.combine}
      </p>
      <p className={styles.hint}>
        <a href={pvgisHorizonUrl(latitude, longitude)} target="_blank" rel="noopener noreferrer">
          {t.pvgisLink}
          <span className="sr-only"> {t.newTab}</span>
        </a>
        . {t.pvgisHint}
      </p>
    </div>
  );
}
