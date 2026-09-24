import { createPortal } from 'react-dom';
import { PrintReport } from './PrintReport';
import { usePrintMode } from './print';

/**
 * Print mode for the whole app (light theme, re-rendered canvases, inputs appendix) — for the
 * "print report" menu item and the browser's own print command alike. Render exactly once, in an
 * always-mounted place.
 */
export function PrintRoot() {
  const printedAt = usePrintMode();
  return printedAt !== null ? createPortal(<PrintReport printedAt={printedAt} />, document.body) : null;
}
