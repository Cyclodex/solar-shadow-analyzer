import { Color, ShaderMaterial } from 'three';
import type { ScenePalette } from './palette';

// ─────────────────────────────────────────────
// MODEL SHADE OVERLAY MATERIAL
// Translucent fill (--shade), diagonal hatch and a pixel-wide border (--sun) for the model's shade
// rectangles. Attributes (see writeOverlayRects): plane = panel-plane (u, v) in m, rect = (u0, v0, u1, v1).
// The hatch is in metres (stable on the panel), line widths never drop below ~1.2 px.
// ─────────────────────────────────────────────

const VERTEX = /* glsl */ `
attribute vec2 plane;
attribute vec4 rect;
varying vec2 vPlane;
varying vec4 vRect;
void main() {
  vPlane = plane;
  vRect = rect;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uFill;
uniform float uFillAlpha;
uniform vec3 uLine;
uniform float uSpacing;
uniform float uLineWidth;
uniform float uBorderPx;
varying vec2 vPlane;
varying vec4 vRect;
void main() {
  float d = (vPlane.x + vPlane.y) / uSpacing;
  float fd = max(fwidth(d), 1e-6);
  float dist = abs(fract(d) - 0.5);
  float halfW = max(0.5 * uLineWidth / uSpacing, 0.6 * fd);
  float stripe = 1.0 - smoothstep(halfW - fd, halfW + fd, dist);
  vec2 fw = max(fwidth(vPlane), vec2(1e-6));
  float bx = min(vPlane.x - vRect.x, vRect.z - vPlane.x) / fw.x;
  float by = min(vPlane.y - vRect.y, vRect.w - vPlane.y) / fw.y;
  float border = 1.0 - smoothstep(uBorderPx - 0.75, uBorderPx + 0.75, min(bx, by));
  float line = max(0.75 * stripe, border);
  gl_FragColor = vec4(mix(uFill, uLine, line), mix(uFillAlpha, 1.0, line));
  #include <colorspace_fragment>
}`;

/** Hatch spacing (m), hatch line width (m) and border width (px). */
const SPACING = 0.1;
const LINE_WIDTH = 0.012;
const BORDER_PX = 1.6;

export function createShadeMaterial(palette: ScenePalette): ShaderMaterial {
  const shade = palette.rgba.shade;
  return new ShaderMaterial({
    uniforms: {
      uFill: { value: new Color().copy(palette.color('shade')) },
      uFillAlpha: { value: Math.min(0.75, Math.max(0.35, shade.a)) },
      uLine: { value: new Color().copy(palette.color('sun')) },
      uSpacing: { value: SPACING },
      uLineWidth: { value: LINE_WIDTH },
      uBorderPx: { value: BORDER_PX },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    toneMapped: false,
  });
}
