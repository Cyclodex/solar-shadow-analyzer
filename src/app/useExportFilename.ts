import { exportFilename, type ExportKind } from '../export/filenames';
import { useLang } from '../i18n';
import { useConfigSection } from '../state/configStore';

/**
 * Localised export file name for the current location — the scheme of the Export menu
 * ("<app>-<kind>-<location>-<parts…>.<ext>"), e.g. for the PNG export of a view or chart:
 * `<ViewCard exportFilename={useExportFilename('monthly', [year])} …>`.
 */
export function useExportFilename(
  kind: ExportKind,
  parts: readonly (string | number)[] = [],
  extension: 'json' | 'csv' | 'png' = 'png',
): string {
  const lang = useLang();
  const location = useConfigSection('location').name;
  return exportFilename(kind, lang, [location, ...parts], extension);
}
