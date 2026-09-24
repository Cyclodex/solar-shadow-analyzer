import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { Button } from '../components/Button';
import { DownloadIcon } from '../components/icons';
import { useDismissOnOutsidePointer, useKeepInViewport } from '../components/usePopover';
import { floorLabel, useLang, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import {
  useFloorPlacements,
  useHeatmap,
  useResultsReady,
  useTerrainPending,
  useSimulation,
  useTiltSweep,
} from '../hooks/useModel';
import type { Config } from '../model/types';
import {
  CONFIG_FILE_ACCEPT,
  downloadConfigJson,
  readConfigFile,
  type ConfigImportError,
} from '../export/configFile';
import { clearSkyParts, exportFilename } from '../export/filenames';
import {
  downloadCsv,
  heatmapCsv,
  monthlyResultsCsv,
  tiltSweepCsv,
  userCsvFormat,
} from '../export/resultsCsv';
import { printReport } from '../export/print';
import { useConfig, useConfigStore } from '../state/configStore';
import styles from './ExportMenu.module.css';

const de = {
  export: 'Export',
  menuLabel: 'Export und Import',
  configGroup: 'Konfiguration',
  saveConfig: 'Konfiguration speichern',
  loadConfig: 'Konfiguration laden …',
  resultsGroup: 'Ergebnisse',
  monthly: 'Monatsertrag je Stockwerk',
  tiltSweep: 'Neigungsvergleich',
  heatmap: (floor: string) => `Schatten-Heatmap ${floor}`,
  computing: 'wird berechnet …',
  print: 'Bericht drucken …',
  printHint: 'auch als PDF',
  imported: (name: string) => `Konfiguration «${name}» geladen.`,
  undo: 'Rückgängig',
  undone: 'Vorherige Konfiguration wiederhergestellt.',
  errors: {
    empty: 'Die Datei ist leer.',
    'too-large': 'Die Datei ist zu gross für eine Konfiguration.',
    unreadable: 'Die Datei konnte nicht gelesen werden.',
    invalid: 'Die Datei enthält keine gültige Konfiguration dieser App (JSON).',
  } satisfies Record<ConfigImportError, string>,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    export: 'Export',
    menuLabel: 'Export and import',
    configGroup: 'Configuration',
    saveConfig: 'Save configuration',
    loadConfig: 'Load configuration …',
    resultsGroup: 'Results',
    monthly: 'Monthly yield per floor',
    tiltSweep: 'Tilt comparison',
    heatmap: (floor) => `Shade heatmap ${floor}`,
    computing: 'computing …',
    print: 'Print report …',
    printHint: 'or save as PDF',
    imported: (name) => `Configuration “${name}” loaded.`,
    undo: 'Undo',
    undone: 'Previous configuration restored.',
    errors: {
      empty: 'The file is empty.',
      'too-large': 'The file is too large for a configuration.',
      unreadable: 'The file could not be read.',
      invalid: 'The file does not contain a valid configuration of this app (JSON).',
    },
  },
};

type MessageSet = typeof de;

interface MenuItem {
  id: string;
  label: string;
  /** Format tag shown on the right (part of the accessible name). */
  format?: string;
  /** Secondary text (e.g. why the item is unavailable). */
  detail?: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface MenuGroup {
  id: string;
  label?: string;
  items: MenuItem[];
}

type Notice =
  | { kind: 'imported'; text: string; previous: Config }
  | { kind: 'info'; text: string }
  | { kind: 'error'; text: string };

/** Success notices disappear after this time (unless focus is inside). */
const NOTICE_MS = 8000;

/** Menu entries; data-dependent entries are disabled until their results exist. */
function useMenuGroups(t: MessageSet, onLoadConfig: () => void): MenuGroup[] {
  const c = useCommon();
  const lang = useLang();
  const config = useConfig();
  // Provisional yield results are not offered (inputs still loading, weather of another site or year,
  // a tilt sweep being updated): they would be exported under the current labels.
  const resultsReady = useResultsReady();
  const simulation = useSimulation();
  // The tilt sweep may not be cached yet: compute it after the menu has painted (and not at all while
  // it could not be exported anyway).
  const ready = useDeferredValue(true, false);
  const sweep = useTiltSweep(ready && resultsReady);
  const monthlyReady = resultsReady && simulation !== null;
  const tiltReady = resultsReady && sweep !== null && !sweep.updating;
  // Same floor as the heatmap card (useShadedFloor): never the top floor, which is never shaded. The
  // heatmap needs no weather, but the terrain horizon: not offered while it is loading.
  const heatmap = useHeatmap();
  const heatmapReady = !useTerrainPending();
  const placements = useFloorPlacements();
  const name = config.location.name;
  const heatmapFloor = floorLabel(placements[heatmap.floor]?.storey ?? heatmap.floor, lang);

  return [
    {
      id: 'config',
      label: t.configGroup,
      items: [
        {
          id: 'config-save',
          label: t.saveConfig,
          format: 'JSON',
          onSelect: () => downloadConfigJson(useConfigStore.getState().config, lang),
        },
        { id: 'config-load', label: t.loadConfig, format: 'JSON', onSelect: onLoadConfig },
      ],
    },
    {
      id: 'results',
      label: t.resultsGroup,
      items: [
        {
          id: 'csv-monthly',
          label: t.monthly,
          format: c.exportCsv,
          disabled: !monthlyReady,
          detail: monthlyReady ? undefined : t.computing,
          onSelect: () => {
            if (!monthlyReady) return;
            const parts = [name, simulation.year, ...clearSkyParts(simulation.source, lang)];
            downloadCsv(
              monthlyResultsCsv(simulation, lang, userCsvFormat(lang)),
              exportFilename('monthly', lang, parts, 'csv'),
            );
          },
        },
        {
          id: 'csv-tilt',
          label: t.tiltSweep,
          format: c.exportCsv,
          disabled: !tiltReady,
          detail: tiltReady ? undefined : t.computing,
          onSelect: () => {
            if (!tiltReady) return;
            const storeys = placements.map((p) => p.storey);
            const parts = [name, sweep.year, ...clearSkyParts(sweep.source, lang)];
            downloadCsv(
              tiltSweepCsv(sweep.points, storeys, lang, userCsvFormat(lang)),
              exportFilename('tiltSweep', lang, parts, 'csv'),
            );
          },
        },
        {
          id: 'csv-heatmap',
          label: t.heatmap(heatmapFloor),
          format: c.exportCsv,
          disabled: !heatmapReady,
          detail: heatmapReady ? undefined : t.computing,
          onSelect: () => {
            if (!heatmapReady) return;
            downloadCsv(
              heatmapCsv(heatmap, lang, userCsvFormat(lang)),
              exportFilename('heatmap', lang, [name, heatmapFloor, heatmap.year], 'csv'),
            );
          },
        },
      ],
    },
    {
      id: 'report',
      items: [{ id: 'print', label: t.print, detail: t.printHint, onSelect: () => void printReport() }],
    },
  ];
}

interface MenuProps {
  id: string;
  label: string;
  t: MessageSet;
  onClose: (focusButton: boolean) => void;
  onLoadConfig: () => void;
}

/** The open menu (role="menu"); mounted only while open, so its data hooks cost nothing when closed. */
function Menu({ id, label, t, onClose, onLoadConfig }: MenuProps) {
  const groups = useMenuGroups(t, onLoadConfig);
  const menuRef = useRef<HTMLDivElement>(null);
  useKeepInViewport(menuRef, true);

  const itemEls = (): HTMLButtonElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const els = itemEls();
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (k: number): void => els[(k + els.length) % els.length]?.focus();
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose(true);
        return;
      case 'ArrowDown':
        e.preventDefault();
        focusAt(i + 1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(i - 1);
        return;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        return;
      case 'End':
        e.preventDefault();
        focusAt(els.length - 1);
        return;
      case 'Tab':
        onClose(false);
        return;
    }
    // Type-ahead: first item (after the current one) starting with the typed character.
    if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const key = e.key.toLocaleLowerCase();
      for (let k = 1; k <= els.length; k++) {
        const el = els[(i + k) % els.length];
        if (el.textContent?.trim().toLocaleLowerCase().startsWith(key)) {
          el.focus();
          break;
        }
      }
    }
  };

  return (
    <div ref={menuRef} id={id} role="menu" aria-label={label} className={styles.menu} onKeyDown={onKeyDown}>
      {groups.map((g, gi) => (
        <Fragment key={g.id}>
          {gi > 0 && <div role="separator" className={styles.separator} />}
          <div role="group" aria-label={g.label} className={styles.group}>
            {g.label && (
              <div className={styles.groupLabel} aria-hidden="true">
                {g.label}
              </div>
            )}
            {g.items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                className={styles.item}
                onClick={() => {
                  if (item.disabled) return;
                  onClose(true);
                  item.onSelect();
                }}
              >
                <span className={styles.itemText}>
                  {/* The spaces separate the parts in the accessible name (ignored by the flex layout). */}
                  <span className={styles.itemLabel}>{item.label}</span>
                  {item.detail && (
                    <>
                      {' '}
                      <span className={styles.itemDetail}>{item.detail}</span>
                    </>
                  )}
                </span>
                {item.format && (
                  <>
                    {' '}
                    <span className={styles.format}>{item.format}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/** Result of a config import (success with undo, or an error), anchored below the menu button. */
function ImportNotice({
  notice,
  t,
  onClose,
  onUndo,
}: {
  notice: Notice;
  t: MessageSet;
  /** focusButton: return focus to the menu button (the notice had focus). */
  onClose: (focusButton: boolean) => void;
  onUndo: () => void;
}) {
  const c = useCommon();
  const ref = useRef<HTMLDivElement>(null);
  useKeepInViewport(ref, true);

  useEffect(() => {
    if (notice.kind === 'error') return;
    const hide = (): void => {
      if (ref.current?.contains(document.activeElement)) timer = setTimeout(hide, NOTICE_MS);
      else onClose(false);
    };
    let timer = setTimeout(hide, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, onClose]);

  return (
    <div
      ref={ref}
      className={styles.notice}
      data-kind={notice.kind}
      data-print="hide"
      role={notice.kind === 'error' ? 'alert' : 'status'}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose(true);
      }}
    >
      <p className={styles.noticeText}>{notice.text}</p>
      <div className={styles.noticeActions}>
        {notice.kind === 'imported' && (
          <Button size="sm" onClick={onUndo}>
            {t.undo}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onClose(true)}>
          {c.close}
        </Button>
      </div>
    </div>
  );
}

/**
 * Export menu (menu button pattern): config JSON export/import, result tables as CSV, print report.
 * The button has aria-haspopup/aria-expanded; the menu takes focus, Arrow keys/Home/End/type-ahead
 * move, Escape closes and returns focus, Tab and outside clicks close. Unavailable entries stay
 * focusable with aria-disabled.
 */
export function ExportMenu() {
  const t = useMessages(messages);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Outside presses close the menu and notices, except an import notice (it offers the undo).
  useDismissOnOutsidePointer(rootRef, open || notice !== null, () => {
    setOpen(false);
    if (notice?.kind !== 'imported') setNotice(null);
  });

  const close = (focusButton: boolean): void => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const closeNotice = useCallback((focusButton: boolean): void => {
    setNotice(null);
    if (focusButton) buttonRef.current?.focus();
  }, []);

  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // the same file can be chosen again
    if (!file) return;
    const result = await readConfigFile(file);
    if (!result.ok) {
      setNotice({ kind: 'error', text: t.errors[result.error] });
      return;
    }
    const previous = useConfigStore.getState().config;
    useConfigStore.getState().replace(result.config);
    setNotice({ kind: 'imported', text: t.imported(result.config.location.name), previous });
  };

  const undo = (): void => {
    if (notice?.kind !== 'imported') return;
    useConfigStore.getState().replace(notice.previous);
    setNotice({ kind: 'info', text: t.undone });
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <Button
        ref={buttonRef}
        icon={<DownloadIcon />}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={t.menuLabel}
        onClick={() => {
          setNotice(null);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault();
            setNotice(null);
            setOpen(true);
          }
        }}
      >
        <span className="sr-only-narrow">{t.export}</span>
      </Button>
      {open && (
        <Menu
          id={menuId}
          label={t.menuLabel}
          t={t}
          onClose={close}
          onLoadConfig={() => fileRef.current?.click()}
        />
      )}
      {notice && <ImportNotice notice={notice} t={t} onClose={closeNotice} onUndo={undo} />}
      <input ref={fileRef} type="file" accept={CONFIG_FILE_ACCEPT} hidden onChange={(e) => void onFile(e)} />
    </div>
  );
}
