import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../components/Button';
import { DownloadIcon } from '../components/icons';
import { useMessages, type Messages } from '../i18n';
import { configToJson } from '../model/share';
import { downloadText, safeFilename } from '../export/download';
import { useConfigStore } from '../state/configStore';
import styles from './ExportMenu.module.css';

const de = {
  export: 'Export',
  configJson: 'Konfiguration (JSON)',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    export: 'Export',
    configJson: 'Configuration (JSON)',
  },
};

interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
}

/** Downloads the current config as JSON (model/share configToJson). */
function downloadConfigJson(): void {
  const config = useConfigStore.getState().config;
  const name = safeFilename(`verschattung-${config.location.name}`, 'verschattung-config');
  downloadText(configToJson(config), `${name}.json`, 'application/json;charset=utf-8');
}

/**
 * Export menu (menu button pattern): button with aria-haspopup/aria-expanded, role="menu" with
 * role="menuitem" entries; Arrow keys move, Escape closes and returns focus, outside click closes.
 */
export function ExportMenu() {
  const t = useMessages(messages);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const items: MenuItem[] = [{ id: 'config-json', label: t.configJson, onSelect: downloadConfigJson }];

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (focusButton: boolean): void => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const els = itemRefs.current.filter((x): x is HTMLButtonElement => x !== null);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <Button
        ref={buttonRef}
        icon={<DownloadIcon />}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={styles.text}>{t.export}</span>
      </Button>
      {open && (
        <div id={menuId} role="menu" aria-label={t.export} className={styles.menu} onKeyDown={onMenuKeyDown}>
          {items.map((item, i) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={styles.item}
              onClick={() => {
                item.onSelect();
                close(true);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
