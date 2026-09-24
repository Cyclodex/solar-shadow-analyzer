import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import { Canvas, flushSync as flushSceneSync, type RootState } from '@react-three/fiber';
import { PCFShadowMap } from 'three';
import { Button } from '../../components/Button';
import { Placeholder } from '../../components/Placeholder';
import { cssVars } from '../../components/cssVars';
import { ResetIcon } from '../../components/icons';
import { CANVAS_RENDER_EVENT, type CanvasRenderDetail } from '../../export/canvasRender';
import { useFormat, useLang, useMessages } from '../../i18n';
import { useCommon } from '../../i18n/common';
import type { ActivePreset, CameraApi } from './CameraRig';
import { renderForCapture } from './captureRender';
import { sceneMessages } from './messages';
import { floorToken, useScenePalette } from './palette';
import { SceneContent } from './SceneContent';
import { SceneErrorBoundary } from './SceneErrorBoundary';
import { DEFAULT_FOV, SUN_VIEW_MIN_ALTITUDE, type CameraPreset } from './sceneLayout';
import type { SceneData } from './useSceneData';
import styles from './Scene3D.module.css';

// ─────────────────────────────────────────────
// 3D STAGE: <Canvas> (render on demand while on screen, preserved drawing buffer for the PNG export),
// camera preset bar, per-floor model status and keyboard control (arrow keys orbit, +/− zoom,
// 0 = overview).
// ─────────────────────────────────────────────

const PRESET_BUTTONS: readonly CameraPreset[] = ['front', 'side', 'top', 'sun'];
const KEY_ORBIT_DEG = 10;
const KEY_POLAR_DEG = 5;
const KEY_ZOOM = 0.85;

/** Keyboard control of the focused scene. */
const KEY_ACTIONS: Partial<Record<string, ((api: CameraApi) => void) | 'reset'>> = {
  ArrowLeft: (api) => api.orbit(-KEY_ORBIT_DEG, 0),
  ArrowRight: (api) => api.orbit(KEY_ORBIT_DEG, 0),
  ArrowUp: (api) => api.orbit(0, KEY_POLAR_DEG),
  ArrowDown: (api) => api.orbit(0, -KEY_POLAR_DEG),
  '+': (api) => api.zoom(KEY_ZOOM),
  '=': (api) => api.zoom(KEY_ZOOM),
  '-': (api) => api.zoom(1 / KEY_ZOOM),
  _: (api) => api.zoom(1 / KEY_ZOOM),
  '0': 'reset',
  Home: 'reset',
};

/**
 * Whether the view card around `ref` is on screen (with a margin). Starts true, so the first paint is never
 * blank (and stays true where IntersectionObserver reports nothing, e.g. jsdom). The whole card is
 * observed, not the canvas: its header holds the PNG export, which reads the canvas.
 */
function useInView(ref: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setInView(last.isIntersecting);
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(el.closest('section') ?? el);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

export interface SceneStageProps {
  data: SceneData;
  showModelShade: boolean;
  castShadows: boolean;
  showSunPath: boolean;
}

export function SceneStage({ data, showModelShade, castShadows, showSunPath }: SceneStageProps) {
  const t = useMessages(sceneMessages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const palette = useScenePalette();
  // Re-renders this component, so the palette re-reads <html data-theme> (see the capture listener below).
  const [, refreshPalette] = useReducer((n: number) => n + 1, 0);
  const helpId = useId();
  const apiRef = useRef<CameraApi | null>(null);
  const [preset, setPreset] = useState<ActivePreset>('default');
  const [lost, setLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<RootState | null>(null);
  // Off screen the canvas does not render at all (time animation would otherwise re-render the scene and
  // its shadow map for nobody). Invalidations are dropped while frameloop is 'never', so the scene is
  // rendered once explicitly when it comes back (the Canvas has switched to 'demand' by then).
  const inView = useInView(stageRef);
  useEffect(() => {
    if (inView) rootRef.current?.invalidate();
  }, [inView]);

  const { instant, dims, labels } = data;
  const { sun } = instant;
  const sunAvailable = sun.altitude >= SUN_VIEW_MIN_ALTITUDE;
  // While the sun is down, "from the sun" behaves like a free camera (it resumes when the sun is up).
  const activePreset: ActivePreset = preset === 'sun' && !sunAvailable ? 'custom' : preset;

  const select = (p: CameraPreset): void => {
    if (apiRef.current?.apply(p, true)) setPreset(p);
  };
  const onUserMove = useCallback(() => setPreset('custom'), []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const api = apiRef.current;
    const action = KEY_ACTIONS[e.key];
    if (!api || !action || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (action === 'reset') {
      select('default');
    } else {
      action(api);
      setPreset('custom');
    }
  };

  const onCreated = useCallback((state: RootState) => {
    rootRef.current = state;
    const canvas = state.gl.domElement;
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      setLost(true);
    });
    // PNG export and print copy the canvas right after this event: draw the current state now.
    canvas.addEventListener(CANVAS_RENDER_EVENT, (event) => {
      const detail = (event as CustomEvent<CanvasRenderDetail>).detail;
      // Print has just switched <html data-theme> to light; the palette's observer would only fire after
      // the capture. Commit the scene with the new palette first, synchronously in both React roots (the
      // page and the canvas). Nothing here may be deferred or awaited.
      if (detail.reason === 'print') flushSceneSync(() => flushSync(refreshPalette));
      renderForCapture(state.get(), detail);
    });
  }, []);

  const reload = (): void => {
    setLost(false);
    setCanvasKey((k) => k + 1);
  };

  const floorStatus = instant.floors.map((fl) => {
    if (fl.state !== 'lit') return c.sunStates[fl.state];
    const pct = fl.shade.fraction * 100;
    if (pct <= 0) return t.sunlit;
    return t.shaded(pct < 0.5 ? `< ${f.pct(1)}` : f.pct(pct));
  });
  const sunText =
    sun.altitude > 0 ? t.sunSummary(f.deg(sun.altitude, 0), f.deg(sun.azimuth, 0)) : `${c.sunStates.night}.`;
  const floorsText = floorStatus
    .map((status, k) => `${labels[k] ?? ''}: ${status}`)
    .reverse()
    .join('; ');

  return (
    <div ref={stageRef} className={styles.stage}>
      <SceneErrorBoundary fallback={<Placeholder>{t.failed}</Placeholder>}>
        <Canvas
          key={canvasKey}
          className={styles.canvas}
          frameloop={inView ? 'demand' : 'never'}
          flat
          dpr={[1, 2]}
          shadows={{ enabled: true, type: PCFShadowMap }}
          gl={{ preserveDrawingBuffer: true, antialias: true, powerPreference: 'high-performance' }}
          camera={{ fov: DEFAULT_FOV, near: 0.1, far: 5000, position: [20, 15, 30] }}
          onCreated={onCreated}
          tabIndex={0}
          role="group"
          aria-roledescription={t.title}
          aria-label={t.sceneLabel(`${sunText} ${floorsText}.`)}
          aria-describedby={helpId}
          onKeyDown={onKeyDown}
        >
          <SceneContent
            palette={palette}
            dims={dims}
            instant={instant}
            sunDir={data.sunDir}
            sunBlocked={data.sunBlocked}
            segments={data.segments}
            hours={data.hours}
            farHorizon={data.farHorizon}
            observerHeight={data.observerHeight}
            obstacles={data.obstacles}
            labels={labels}
            lang={lang}
            format={f}
            showModelShade={showModelShade}
            castShadows={castShadows}
            showSunPath={showSunPath}
            preset={activePreset}
            onUserMove={onUserMove}
            apiRef={apiRef}
          />
        </Canvas>
      </SceneErrorBoundary>

      <div className={styles.status}>
        <p className={styles.statusTitle}>{t.shadeNow}</p>
        <ul className={styles.floorList}>
          {instant.floors
            .map((fl, k) => (
              <li key={fl.floor} className={styles.floorItem}>
                <span className={styles.dot} style={cssVars({ '--dot': `var(--${floorToken(k)})` })} />
                <span className={styles.floorName}>{labels[k]}</span>
                <span className={styles.floorValue}>{floorStatus[k]}</span>
              </li>
            ))
            .reverse()}
        </ul>
      </div>

      <div className={styles.cameraBar} role="toolbar" aria-label={t.camera}>
        <Button
          size="sm"
          variant="secondary"
          icon={<ResetIcon />}
          iconOnly
          title={t.resetView}
          onClick={() => select('default')}
        >
          {t.resetView}
        </Button>
        {PRESET_BUTTONS.map((p) => {
          const disabled = p === 'sun' && !sunAvailable;
          return (
            <Button
              key={p}
              size="sm"
              variant="secondary"
              pressed={activePreset === p}
              disabled={disabled}
              aria-label={t.presets[p]}
              title={disabled ? t.sunViewUnavailable : t.presetHints[p]}
              onClick={() => select(p)}
            >
              <span className={styles.long}>{t.presets[p]}</span>
              <span className={styles.short}>{t.presetsShort[p]}</span>
            </Button>
          );
        })}
      </div>

      {lost && (
        <div className={styles.lost} role="alert">
          <p>{t.contextLost}</p>
          <Button size="sm" variant="primary" onClick={reload}>
            {t.reload}
          </Button>
        </div>
      )}
      <p id={helpId} className="sr-only">
        {t.help}
      </p>
    </div>
  );
}
