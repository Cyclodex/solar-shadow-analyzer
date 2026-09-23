import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { PerspectiveCamera, Spherical, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { SunPosition } from '../../model/types';
import { clamp, toRad } from '../../model/units';
import { DEFAULT_FOV, cameraPose, type CameraPose, type CameraPreset, type SceneDims } from './sceneLayout';

// ─────────────────────────────────────────────
// CAMERA: OrbitControls (damped, above the ground) + presets with a short spherical transition.
// Presets follow scene changes; 'sun' also follows the sun (time slider / animation) until the user
// orbits. Nothing is allocated per frame.
// ─────────────────────────────────────────────

/** 'custom' = the user moved the camera. */
export type ActivePreset = CameraPreset | 'custom';

export interface CameraApi {
  /** Moves to a preset; false if it is not available (sun below the horizon for 'sun'). */
  apply(preset: CameraPreset, animate: boolean): boolean;
  /** Rotates around the target (degrees; positive polar = camera goes up). */
  orbit(dAzimuthDeg: number, dPolarDeg: number): void;
  /** Multiplies the distance to the target. */
  zoom(factor: number): void;
}

const MIN_DISTANCE = 1.5;
const MAX_DISTANCE = 230;
/** Keeps the camera above the ground plane. */
const MAX_POLAR = Math.PI / 2 - 0.04;
const TRANSITION_MS = 700;

/** Scratch objects (module level: no allocation per call or frame; the rig never re-enters itself). */
const OFFSET = new Vector3();
const SPH = new Spherical();
const TARGET = new Vector3();

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

interface Tween {
  active: boolean;
  start: number;
  duration: number;
  from: Spherical;
  to: Spherical;
  fromTarget: Vector3;
  toTarget: Vector3;
  fromFov: number;
  toFov: number;
}

export interface CameraRigProps {
  dims: SceneDims;
  sun: SunPosition;
  preset: ActivePreset;
  onUserMove: () => void;
  apiRef: RefObject<CameraApi | null>;
}

export function CameraRig({ dims, sun, preset, onUserMove, apiRef }: CameraRigProps) {
  // The camera is read from the store inside callbacks: it is a mutable three.js object, not render state.
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(1, size.height);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const tween = useRef<Tween>({
    active: false,
    start: 0,
    duration: 0,
    from: new Spherical(),
    to: new Spherical(),
    fromTarget: new Vector3(),
    toTarget: new Vector3(),
    fromFov: DEFAULT_FOV,
    toFov: DEFAULT_FOV,
  });

  /** Near plane follows the viewing distance (depth precision for the overlay a few mm above the panels). */
  const updateNear = useCallback(
    (distance: number) => {
      const camera = get().camera;
      if (!(camera instanceof PerspectiveCamera)) return;
      camera.near = clamp(distance * 0.01, 0.05, 4);
      camera.far = 5000;
      camera.updateProjectionMatrix();
    },
    [get],
  );

  const setPose = useCallback(
    (pose: CameraPose, animate: boolean) => {
      const controls = controlsRef.current;
      const camera = get().camera;
      if (!controls || !(camera instanceof PerspectiveCamera)) return;
      const tw = tween.current;
      const target = TARGET.set(pose.target[0], pose.target[1], pose.target[2]);
      if (animate && !prefersReducedMotion()) {
        tw.from.setFromVector3(OFFSET.copy(camera.position).sub(controls.target));
        tw.to.setFromVector3(OFFSET.set(pose.position[0], pose.position[1], pose.position[2]).sub(target));
        // Shortest way around.
        const d = tw.to.theta - tw.from.theta;
        tw.to.theta = tw.from.theta + Math.atan2(Math.sin(d), Math.cos(d));
        tw.fromTarget.copy(controls.target);
        tw.toTarget.copy(target);
        tw.fromFov = camera.fov;
        tw.toFov = pose.fov;
        tw.start = performance.now();
        tw.duration = TRANSITION_MS;
        tw.active = true;
        controls.enabled = false;
      } else {
        tw.active = false;
        controls.enabled = true;
        controls.target.copy(target);
        camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
        camera.fov = pose.fov;
        camera.lookAt(target);
        updateNear(camera.position.distanceTo(target));
        controls.update();
      }
      invalidate();
    },
    [get, invalidate, updateNear],
  );

  const apply = useCallback(
    (p: CameraPreset, animate: boolean): boolean => {
      const pose = cameraPose(p, dims, sun, aspect);
      if (!pose) return false;
      setPose(pose, animate);
      return true;
    },
    [dims, sun, aspect, setPose],
  );

  const orbit = useCallback(
    (dAz: number, dPolar: number) => {
      const controls = controlsRef.current;
      const camera = get().camera;
      if (!controls) return;
      tween.current.active = false;
      controls.enabled = true;
      SPH.setFromVector3(OFFSET.copy(camera.position).sub(controls.target));
      SPH.theta += toRad(dAz);
      SPH.phi = clamp(SPH.phi - toRad(dPolar), 0.02, MAX_POLAR);
      camera.position.setFromSpherical(SPH).add(controls.target);
      camera.lookAt(controls.target);
      controls.update();
      invalidate();
    },
    [get, invalidate],
  );

  const zoom = useCallback(
    (factor: number) => {
      const controls = controlsRef.current;
      const camera = get().camera;
      if (!controls) return;
      tween.current.active = false;
      controls.enabled = true;
      SPH.setFromVector3(OFFSET.copy(camera.position).sub(controls.target));
      SPH.radius = clamp(SPH.radius * factor, MIN_DISTANCE, MAX_DISTANCE);
      camera.position.setFromSpherical(SPH).add(controls.target);
      updateNear(SPH.radius);
      controls.update();
      invalidate();
    },
    [get, invalidate, updateNear],
  );

  useEffect(() => {
    apiRef.current = { apply, orbit, zoom };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, apply, orbit, zoom]);

  // Initial pose, and re-apply the active preset when the scene or the canvas shape changes
  // (effect events read the current preset without re-running on every preset or sun change).
  const reapply = useEffectEvent(() => {
    if (preset !== 'custom') apply(preset, false);
  });
  useLayoutEffect(() => reapply(), [dims, aspect]);

  // "From the sun" follows the sun (time slider, animation) while it is above the horizon.
  const followSun = useEffectEvent(() => {
    if (preset === 'sun') apply('sun', false);
  });
  useLayoutEffect(() => followSun(), [sun]);

  useFrame(({ camera }) => {
    const tw = tween.current;
    const controls = controlsRef.current;
    if (!tw.active || !controls || !(camera instanceof PerspectiveCamera)) return;
    const t = clamp((performance.now() - tw.start) / tw.duration, 0, 1);
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    SPH.radius = tw.from.radius + (tw.to.radius - tw.from.radius) * k;
    SPH.phi = tw.from.phi + (tw.to.phi - tw.from.phi) * k;
    SPH.theta = tw.from.theta + (tw.to.theta - tw.from.theta) * k;
    controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
    camera.position.setFromSpherical(SPH).add(controls.target);
    camera.fov = tw.fromFov + (tw.toFov - tw.fromFov) * k;
    camera.lookAt(controls.target);
    updateNear(SPH.radius);
    if (t >= 1) {
      tw.active = false;
      controls.enabled = true;
      controls.update();
    }
    invalidate();
  });

  const onChange = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (controls.target.y < 0) controls.target.y = 0;
    updateNear(get().camera.position.distanceTo(controls.target));
  }, [get, updateNear]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      maxPolarAngle={MAX_POLAR}
      onStart={onUserMove}
      onChange={onChange}
    />
  );
}
