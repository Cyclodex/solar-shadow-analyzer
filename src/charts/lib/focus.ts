/**
 * True when `el` got focus in a way the browser shows a focus ring for (keyboard), false after a mouse or
 * touch press. Used to show a chart's keyboard cursor only for keyboard users. Environments without
 * :focus-visible support count as keyboard focus.
 */
export function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}
