import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { PerspectiveCamera, Spherical, Vector3, type Camera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { SunPosition } from '../../model/types';
import { clamp, toRad } from '../../model/units';
import {
  DEFAULT_FOV,
  MAX_CAMERA_DISTANCE,
  MAX_POLAR,
  MIN_CAMERA_DISTANCE,
  cameraPose,
  equivalentDistance,
  type CameraPose,
  type CameraPreset,
  type SceneDims,
} from './sceneLayout';

// ─────────────────────────────────────────────
// CAMERA: OrbitControls (damped, above the ground) + presets with a short spherical transition.
// Presets follow scene changes; 'sun' also follows the sun (time slider / animation) until the user
// orbits: only a camera change made by the controls during a pointer interaction counts as a user move,
// so a click or tap that focuses the scene keeps the preset. Leaving the narrow "from the sun" view
// restores the default field of view. Nothing is allocated per frame.
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

const TRANSITION_MS = 700;

/** Scratch objects (module level: no allocation per call or frame; the rig never re-enters itself). */
const OFFSET = new Vector3();
const SPH = new Spherical();
const TARGET = new Vector3();
const SAVED_POS = new Vector3();
const SAVED_TARGET = new Vector3();

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

  /** Pointer interaction with the controls in progress (between their 'start' and 'end' events). */
  const interacting = useRef(false);
  /** A programmatic controls.update() is running: its 'change' event is not a user move. */
  const programmatic = useRef(false);
  const updateControls = useCallback((controls: OrbitControlsImpl) => {
    programmatic.current = true;
    try {
      controls.update();
    } finally {
      programmatic.current = false;
    }
  }, []);

  /**
   * Drops the damping momentum left over from a drag without moving the camera (an undamped update zeroes
   * three-stdlib's sphericalDelta/panOffset). Otherwise it would play out after a preset or key step.
   */
  const stopMomentum = useCallback(
    (controls: OrbitControlsImpl, camera: Camera) => {
      SAVED_POS.copy(camera.position);
      SAVED_TARGET.copy(controls.target);
      controls.enableDamping = false;
      updateControls(controls);
      controls.enableDamping = true;
      camera.position.copy(SAVED_POS);
      controls.target.copy(SAVED_TARGET);
      camera.lookAt(controls.target);
    },
    [updateControls],
  );

  /**
   * Leaves a narrow field of view (the "from the sun" telephoto) for the default one, moving the camera
   * along its view ray so that the view at the target keeps its size. Free orbiting and zooming then work
   * with normal perspective and overlay sizes.
   */
  const leaveTelephoto = useCallback(() => {
    const controls = controlsRef.current;
    const camera = get().camera;
    if (!controls || !(camera instanceof PerspectiveCamera) || tween.current.active) return;
    if (Math.abs(camera.fov - DEFAULT_FOV) < 0.01) return;
    OFFSET.copy(camera.position).sub(controls.target);
    const distance = clamp(
      equivalentDistance(OFFSET.length(), camera.fov, DEFAULT_FOV),
      MIN_CAMERA_DISTANCE,
      MAX_CAMERA_DISTANCE,
    );
    camera.position.copy(controls.target).addScaledVector(OFFSET.normalize(), distance);
    camera.fov = DEFAULT_FOV;
    camera.lookAt(controls.target);
    updateNear(distance);
  }, [get, updateNear]);

  const setPose = useCallback(
    (pose: CameraPose, animate: boolean) => {
      const controls = controlsRef.current;
      const camera = get().camera;
      if (!controls || !(camera instanceof PerspectiveCamera)) return;
      stopMomentum(controls, camera);
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
        updateControls(controls);
      }
      invalidate();
    },
    [get, invalidate, updateNear, stopMomentum, updateControls],
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
      stopMomentum(controls, camera);
      leaveTelephoto();
      SPH.setFromVector3(OFFSET.copy(camera.position).sub(controls.target));
      SPH.theta += toRad(dAz);
      SPH.phi = clamp(SPH.phi - toRad(dPolar), 0.02, MAX_POLAR);
      camera.position.setFromSpherical(SPH).add(controls.target);
      camera.lookAt(controls.target);
      updateControls(controls);
      invalidate();
    },
    [get, invalidate, stopMomentum, leaveTelephoto, updateControls],
  );

  const zoom = useCallback(
    (factor: number) => {
      const controls = controlsRef.current;
      const camera = get().camera;
      if (!controls) return;
      tween.current.active = false;
      controls.enabled = true;
      stopMomentum(controls, camera);
      leaveTelephoto();
      SPH.setFromVector3(OFFSET.copy(camera.position).sub(controls.target));
      SPH.radius = clamp(SPH.radius * factor, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
      camera.position.setFromSpherical(SPH).add(controls.target);
      updateNear(SPH.radius);
      updateControls(controls);
      invalidate();
    },
    [get, invalidate, updateNear, stopMomentum, leaveTelephoto, updateControls],
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
      updateControls(controls);
    }
    invalidate();
  });

  const onStart = useCallback(() => {
    interacting.current = true;
  }, []);
  const onEnd = useCallback(() => {
    interacting.current = false;
  }, []);
  // A pointer press alone ('start') is no move: only an actual camera change while the pointer is down
  // (drag, wheel, pinch) leaves the preset.
  const onChange = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (controls.target.y < 0) controls.target.y = 0;
    if (interacting.current && !programmatic.current) {
      leaveTelephoto();
      onUserMove();
    }
    updateNear(get().camera.position.distanceTo(controls.target));
  }, [get, updateNear, leaveTelephoto, onUserMove]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={MIN_CAMERA_DISTANCE}
      maxDistance={MAX_CAMERA_DISTANCE}
      maxPolarAngle={MAX_POLAR}
      onStart={onStart}
      onEnd={onEnd}
      onChange={onChange}
    />
  );
}
