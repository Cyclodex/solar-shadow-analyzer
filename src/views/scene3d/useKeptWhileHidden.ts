import { useState } from 'react';

/**
 * `value` while `live`; otherwise the value it had when it was last live (same object, so memoised
 * consumers skip their work). Catches up in the render in which `live` turns true again.
 */
export function useKeptWhileHidden<T>(value: T, live: boolean): T {
  const [kept, setKept] = useState(value);
  // Adjusting state while rendering (React: "storing information from previous renders").
  if (live && kept !== value) setKept(value);
  return live ? value : kept;
}
