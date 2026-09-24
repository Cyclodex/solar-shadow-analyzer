import type { Config, Lang } from '../model/types';
import { configFromJson, configToJson } from '../model/share';
import { downloadText } from './download';
import { exportFilename } from './filenames';

// ─────────────────────────────────────────────
// CONFIG AS JSON FILE (export / import)
// Export: model/share configToJson (full, sanitised config). Import: configFromJson validates and
// sanitises (v2 and flat v1 files); anything that does not look like a config is rejected.
// ─────────────────────────────────────────────

export const JSON_MIME = 'application/json;charset=utf-8';

/** Larger files are rejected before reading (a full config with 720 horizon points is ≈ 30 kB). */
export const CONFIG_FILE_MAX_BYTES = 2_000_000;

/** `accept` attribute for the file input. */
export const CONFIG_FILE_ACCEPT = 'application/json,.json';

export type ConfigImportError =
  /** Empty file. */
  | 'empty'
  /** Larger than CONFIG_FILE_MAX_BYTES. */
  | 'too-large'
  /** The file could not be read. */
  | 'unreadable'
  /** Not JSON, or JSON that is not a configuration. */
  | 'invalid';

export type ConfigImportResult = { ok: true; config: Config } | { ok: false; error: ConfigImportError };

/** File name of a config export, e.g. "verschattung-konfiguration-Bern.json". */
export function configFilename(config: Config, lang: Lang): string {
  return exportFilename('config', lang, [config.location.name], 'json');
}

/** Downloads `config` as pretty-printed JSON. */
export function downloadConfigJson(config: Config, lang: Lang): void {
  downloadText(`${configToJson(config)}\n`, configFilename(config, lang), JSON_MIME);
}

/** Validates the text of a config file. */
export function parseConfigText(text: string): ConfigImportResult {
  if (text.trim() === '') return { ok: false, error: 'empty' };
  const config = configFromJson(text);
  return config ? { ok: true, config } : { ok: false, error: 'invalid' };
}

function readAsText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

/** Reads and validates a config file chosen by the user (never rejects). */
export async function readConfigFile(file: Blob): Promise<ConfigImportResult> {
  if (file.size === 0) return { ok: false, error: 'empty' };
  if (file.size > CONFIG_FILE_MAX_BYTES) return { ok: false, error: 'too-large' };
  let text: string;
  try {
    text = await readAsText(file);
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  return parseConfigText(text);
}
