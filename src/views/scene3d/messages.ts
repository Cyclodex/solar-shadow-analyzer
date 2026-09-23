import type { Messages } from '../../i18n';
import type { CameraPreset } from './sceneLayout';

// ─────────────────────────────────────────────
// TEXTS OF THE 3D VIEW (German first, Swiss orthography)
// ─────────────────────────────────────────────

const de = {
  title: '3D-Ansicht',
  subtitle: (when: string) => `${when} · ziehen zum Drehen`,
  camera: 'Kamera',
  presets: {
    default: 'Übersicht',
    front: 'Front',
    side: 'Seite',
    top: 'Oben',
    sun: 'Aus Sonnenrichtung',
  } satisfies Record<CameraPreset, string>,
  /** Visible labels on narrow screens (the full label stays the accessible name). */
  presetsShort: {
    default: 'Übersicht',
    front: 'Front',
    side: 'Seite',
    top: 'Oben',
    sun: 'Sonne',
  } satisfies Record<CameraPreset, string>,
  presetHints: {
    default: 'Schräg von vorne auf Fassade und Panels',
    front: 'Frontal auf die Panelreihen',
    side: 'Seitlich entlang der Fassade: Neigung und Abstand der Panelreihen',
    top: 'Von oben, Norden oben',
    sun: 'Blick entlang der Sonnenstrahlen: Sichtbar ist genau, was die Sonne trifft',
  } satisfies Record<CameraPreset, string>,
  resetView: 'Ansicht zurücksetzen',
  sunViewUnavailable: 'Nicht verfügbar, solange die Sonne unter dem Horizont steht',
  layers: 'Ebenen',
  modelShade: 'Modell-Schatten',
  castShadows: 'Schattenwurf',
  sunPath: 'Sonnenbahn',
  horizon: 'Horizont',
  legendModel:
    'Schraffiert: Flächen ohne direkte Sonne laut Modell – der Schatten des Stockwerks darüber; die ganze Reihe, wenn die Sonne hinter der Fassade oder unter dem Horizont des Stockwerks steht.',
  legendCast: 'Von der 3D-Grafik gerendert (Shadow-Mapping), zum Vergleich mit dem Modell.',
  legendPath: (date: string) =>
    `${date}, mit Stundenmarken (Ortszeit); blass, wo die Sonne hinter der Fassade steht.`,
  legendHorizon: (distance: string) =>
    `Gelände und manuelle Punkte als Silhouette in ${distance} Entfernung.`,
  shadeNow: 'Jetzt laut Modell',
  sunlit: 'besonnt',
  shaded: (pct: string) => `${pct} verschattet`,
  help: 'Maus: ziehen dreht, rechte Taste verschiebt, Mausrad zoomt. Touch: waagrecht wischen dreht, zwei Finger zoomen. Tastatur: Pfeiltasten drehen, Plus und Minus zoomen, 0 stellt die Übersicht ein.',
  sceneLabel: (parts: string) => `3D-Modell von Gebäude und Panels. ${parts}`,
  sunSummary: (alt: string, az: string) => `Sonne ${alt} hoch, Azimut ${az}.`,
  unavailable: '3D-Ansicht nicht verfügbar',
  unavailableDetail:
    'Dieser Browser stellt kein WebGL 2 bereit, oder es ist deaktiviert. Die 2D-Ansichten zeigen dieselben Modellergebnisse.',
  failed: 'Die 3D-Ansicht konnte nicht gestartet werden.',
  contextLost: 'Die 3D-Grafik wurde vom Browser zurückgesetzt.',
  reload: '3D-Ansicht neu laden',
};

export type SceneMessages = typeof de;

export const sceneMessages: Messages<SceneMessages> = {
  de,
  en: {
    title: '3D view',
    subtitle: (when) => `${when} · drag to rotate`,
    camera: 'Camera',
    presets: {
      default: 'Overview',
      front: 'Front',
      side: 'Side',
      top: 'Top',
      sun: 'From the sun',
    },
    presetsShort: {
      default: 'Overview',
      front: 'Front',
      side: 'Side',
      top: 'Top',
      sun: 'Sun',
    },
    presetHints: {
      default: 'Oblique view of the facade and panels',
      front: 'Straight at the panel rows',
      side: 'Along the facade: tilt and spacing of the panel rows',
      top: 'From above, north up',
      sun: 'Looking along the sun rays: exactly what the sun reaches is visible',
    },
    resetView: 'Reset view',
    sunViewUnavailable: 'Not available while the sun is below the horizon',
    layers: 'Layers',
    modelShade: 'Model shade',
    castShadows: 'Cast shadows',
    sunPath: 'Sun path',
    horizon: 'Horizon',
    legendModel:
      'Hatched: areas without direct sun according to the model – the shade of the floor above; the whole row when the sun is behind the facade or below that floor’s horizon.',
    legendCast: 'Rendered by the 3D graphics (shadow mapping), for comparison with the model.',
    legendPath: (date) => `${date}, with hour marks (local time); faded where the sun is behind the facade.`,
    legendHorizon: (distance) => `Terrain and manual points as a silhouette ${distance} away.`,
    shadeNow: 'Now, according to the model',
    sunlit: 'sunlit',
    shaded: (pct) => `${pct} shaded`,
    help: 'Mouse: drag to rotate, right button to pan, wheel to zoom. Touch: swipe sideways to rotate, two fingers to zoom. Keyboard: arrow keys rotate, plus and minus zoom, 0 shows the overview.',
    sceneLabel: (parts) => `3D model of the building and panels. ${parts}`,
    sunSummary: (alt, az) => `Sun ${alt} high, azimuth ${az}.`,
    unavailable: '3D view not available',
    unavailableDetail:
      'This browser does not provide WebGL 2, or it is disabled. The 2D views show the same model results.',
    failed: 'The 3D view could not be started.',
    contextLost: 'The browser reset the 3D graphics.',
    reload: 'Reload 3D view',
  },
};
