// ─────────────────────────────────────────────
// FILE DOWNLOADS (browser)
// ─────────────────────────────────────────────

/** Triggers a download of `blob` as `filename` (temporary object URL, revoked afterwards). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // Some browsers start the download asynchronously: keep the URL alive for a moment.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Downloads text as a file. `bom` prepends a UTF-8 byte order mark (lets Excel detect UTF-8 in CSV files).
 */
export function downloadText(
  text: string,
  filename: string,
  mime = 'text/plain;charset=utf-8',
  opts: { bom?: boolean } = {},
): void {
  const parts: BlobPart[] = opts.bom ? ['\uFEFF', text] : [text];
  downloadBlob(new Blob(parts, { type: mime }), filename);
}

/** File name safe on all platforms: "Bern · 2 OG/Test" → "Bern-2-OG-Test". */
export function safeFilename(name: string, fallback = 'export'): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return s.slice(0, 80) || fallback;
}
