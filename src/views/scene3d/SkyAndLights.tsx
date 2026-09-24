import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BackSide,
  Color,
  Vector3,
  type DirectionalLight,
  type Fog,
  type HemisphereLight,
  type ShaderMaterial,
} from 'three';
import type { Tuple3 } from './coords';
import type { ScenePalette } from './palette';
import { fitShadowCamera, skyState } from './sceneLayout';

// ─────────────────────────────────────────────
// SKY, FOG AND LIGHTS
// Sky dome (gradient + sun glow) coloured by sun altitude, hemisphere light, and the sun as a directional
// light whose orthographic shadow camera is re-fitted to the building for every sun direction.
// All updates are imperative (refs) and allocation-free except the small fit result.
// ─────────────────────────────────────────────

const SKY_RADIUS = 1500;
/** Directional light intensity at full daylight (physically based lights: ≈ π for albedo-true colours). */
const SUN_INTENSITY = 2.6;
const HEMI_DAY = 1.3;
const HEMI_NIGHT = 0.5;
/**
 * Neutral white of the lights (a light colour, not a design colour). Tinted with tokens: sunlight with
 * --sun when low, sky light with the sky colour, ground bounce with --ground.
 */
const WHITE = new Color(1, 1, 1);

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunDir;
uniform float uGlowStrength;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(h, 0.6));
  float s = max(dot(d, uSunDir), 0.0);
  col += uGlow * uGlowStrength * (0.55 * pow(s, 200.0) + 0.22 * pow(s, 12.0) + 0.08 * pow(s, 3.0));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export interface SkyAndLightsProps {
  palette: ScenePalette;
  altitude: number;
  sunDir: Tuple3;
  /** Sun hidden by the far horizon (terrain / manual points): no direct light. */
  sunBlocked: boolean;
  castShadows: boolean;
  target: Tuple3;
  /** Points the shadow camera is fitted to (light-space x/y). */
  fitPoints: readonly Tuple3[];
  /** Further casters that must lie between the light and the target (obstacles). */
  depthPoints: readonly Tuple3[];
}

export function SkyAndLights({
  palette,
  altitude,
  sunDir,
  sunBlocked,
  castShadows,
  target,
  fitPoints,
  depthPoints,
}: SkyAndLightsProps) {
  const invalidate = useThree((s) => s.invalidate);
  const maxTexture = useThree((s) => s.gl.capabilities.maxTextureSize);
  const [mapSize] = useState(() => {
    const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
    return maxTexture >= 8192 && !coarse ? 4096 : 2048;
  });
  const skyRef = useRef<ShaderMaterial>(null);
  const fogRef = useRef<Fog>(null);
  const hemiRef = useRef<HemisphereLight>(null);
  const sunRef = useRef<DirectionalLight>(null);

  const uniforms = useMemo(
    () => ({
      uTop: { value: new Color() },
      uHorizon: { value: new Color() },
      uGlow: { value: new Color() },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uGlowStrength: { value: 0 },
    }),
    [],
  );

  // Colours by altitude (sky, fog, hemisphere, sunlight).
  useLayoutEffect(() => {
    const sky = skyState(altitude);
    const mat = skyRef.current;
    const fog = fogRef.current;
    const hemi = hemiRef.current;
    const light = sunRef.current;
    if (!mat || !fog || !hemi || !light) return;
    const u = mat.uniforms;
    const top = u.uTop.value as Color;
    const horizon = u.uHorizon.value as Color;
    top.copy(palette.nightTop).lerp(palette.color('sky-top'), sky.day);
    horizon
      .copy(palette.nightHorizon)
      .lerp(palette.color('sky-bottom'), sky.day)
      .lerp(palette.color('sun'), 0.4 * sky.twilight);
    (u.uGlow.value as Color).copy(palette.color('sun'));
    (u.uSunDir.value as Vector3).set(sunDir[0], sunDir[1], sunDir[2]);
    u.uGlowStrength.value = altitude > -2 ? 0.35 + 0.65 * sky.day : 0;
    fog.color.copy(horizon);
    hemi.color.copy(WHITE).lerp(top, sky.day > 0.5 ? 0.3 : 0.7);
    hemi.groundColor.copy(WHITE).lerp(palette.color('ground'), 0.6);
    hemi.intensity = HEMI_NIGHT + (HEMI_DAY - HEMI_NIGHT) * sky.day;
    light.color.copy(WHITE).lerp(palette.color('sun'), 0.55 * sky.warmth);
    light.intensity = sunBlocked ? 0 : SUN_INTENSITY * sky.sunLight;
    invalidate();
  }, [altitude, sunDir, sunBlocked, palette, invalidate]);

  // Light position and a tightly fitted shadow camera for the current sun direction.
  useLayoutEffect(() => {
    const light = sunRef.current;
    if (!light) return;
    const fit = fitShadowCamera(fitPoints, depthPoints, target, sunDir, mapSize);
    light.position.set(fit.position[0], fit.position[1], fit.position[2]);
    light.target.position.set(target[0], target[1], target[2]);
    light.target.updateMatrixWorld();
    const cam = light.shadow.camera;
    cam.left = fit.left;
    cam.right = fit.right;
    cam.top = fit.top;
    cam.bottom = fit.bottom;
    cam.near = fit.near;
    cam.far = fit.far;
    cam.updateProjectionMatrix();
    // Bias in world units: ~1 mm in depth; closed meshes render their back faces into the map
    // (three.js default shadowSide), so lit faces do not self-shadow.
    light.shadow.bias = -0.001 / (fit.far - fit.near);
    light.shadow.normalBias = 0.25 * fit.texel;
    light.shadow.radius = 2;
    light.shadow.mapSize.set(mapSize, mapSize);
    invalidate();
  }, [fitPoints, depthPoints, target, sunDir, mapSize, invalidate]);

  return (
    <>
      <mesh renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[SKY_RADIUS, 48, 24]} />
        <shaderMaterial
          ref={skyRef}
          uniforms={uniforms}
          vertexShader={SKY_VERTEX}
          fragmentShader={SKY_FRAGMENT}
          side={BackSide}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
      <fog ref={fogRef} attach="fog" args={[palette.color('sky-bottom'), 220, 1400]} />
      <hemisphereLight ref={hemiRef} />
      {/* castShadow follows the layer toggle only: switching it recompiles every material. */}
      <directionalLight ref={sunRef} castShadow={castShadows} />
    </>
  );
}
