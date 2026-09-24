// ─────────────────────────────────────────────
// CLIPBOARD
// Async Clipboard API first (secure contexts); falls back to a temporary <textarea> + the legacy
// copy command, which still works in plain-http pages and older WebViews.
// ─────────────────────────────────────────────

function legacyCopy(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  // Off-screen but selectable; fixed so the page does not scroll.
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  area.style.opacity = '0';
  document.body.append(area);
  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    active?.focus({ preventScroll: true });
  }
}

/** Copies `text` to the clipboard. Resolves true on success, false if no method worked (never rejects). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // permission denied, insecure context, document not focused … → legacy fallback
  }
  return legacyCopy(text);
}
