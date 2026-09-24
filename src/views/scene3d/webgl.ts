// ─────────────────────────────────────────────
// WEBGL DETECTION
// three.js (r163+) needs WebGL 2. Detected once per page with a throw-away canvas whose context is
// released right away. jsdom has no WebGL, so tests render the accessible fallback.
// ─────────────────────────────────────────────

let cached: boolean | null = null;

/** True if the browser can create a WebGL 2 context (cached after the first call). */
export function isWebGL2Available(): boolean {
  if (cached !== null) return cached;
  cached = probe();
  return cached;
}

function probe(): boolean {
  try {
    if (typeof document === 'undefined' || typeof WebGL2RenderingContext === 'undefined') return false;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Forgets the cached result (tests). */
export function resetWebGLDetection(): void {
  cached = null;
}
