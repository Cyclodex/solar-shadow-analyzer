import { useMessages, type Format, type Messages } from '../../i18n';

// ─────────────────────────────────────────────
// TEXTS SHARED BY THE 2D VIEWS
// "Left/right" always means as seen from outside, looking at the facade (the facade frame's u axis).
// ─────────────────────────────────────────────

const de = {
  sunHigh: (alt: string) => `Sonne ${alt} hoch`,
  relSide: (deg: string, side: 'left' | 'right') =>
    `${deg} ${side === 'left' ? 'links' : 'rechts'} der Fassadennormalen`,
  relCenter: 'genau vor der Fassade',
  shaded: (pct: string) => `${pct} der Fläche verschattet`,
  unshaded: 'unverschattet',
  noFloorAbove: 'keine Panels darüber',
  behindFacade: 'hinter der Fassade',
  inFront: 'vor der Fassade',
  shadeLegend: 'Schatten der oberen Reihe',
  horizonLegend: (floor: string) => `Horizont (${floor})`,
  hoursLegend: (tz: string) => `Uhrzeit (${tz})`,
  overlap: (cm: string) => `Die Panelreihen überlappen sich um ${cm} – physisch nicht möglich.`,
  belowGround: (cm: string, floor: string) =>
    `Die Panels der untersten Reihe (${floor}) reichen ${cm} unter das Terrain – physisch nicht möglich.`,
  at: (time: string, tz: string) => `${time} ${tz}`,
};

export type ViewText = typeof de;

export const viewMessages: Messages<ViewText> = {
  de,
  en: {
    sunHigh: (alt) => `Sun ${alt} high`,
    relSide: (deg, side) => `${deg} ${side} of the facade normal`,
    relCenter: 'straight in front of the facade',
    shaded: (pct) => `${pct} of the area shaded`,
    unshaded: 'unshaded',
    noFloorAbove: 'no panels above',
    behindFacade: 'behind the facade',
    inFront: 'in front of the facade',
    shadeLegend: 'Shadow of the row above',
    horizonLegend: (floor) => `Horizon (${floor})`,
    hoursLegend: (tz) => `Clock time (${tz})`,
    overlap: (cm) => `The panel rows overlap by ${cm} – physically impossible.`,
    belowGround: (cm, floor) =>
      `The panels of the lowest row (${floor}) reach ${cm} below ground level – physically impossible.`,
    at: (time, tz) => `${time} ${tz}`,
  },
};

/** Shared view texts in the current language. */
export function useViewText(): ViewText {
  return useMessages(viewMessages);
}

/**
 * Sun direction relative to the facade normal, e.g. "22° rechts der Fassadennormalen".
 * `rel` = angleDiff(sun azimuth, facade azimuth) in (−180, 180]; rel > 0 = left seen from outside.
 */
export function relativeDirection(rel: number, t: ViewText, f: Format): string {
  if (Math.abs(rel) < 0.5) return t.relCenter;
  return t.relSide(f.deg(Math.abs(rel)), rel > 0 ? 'left' : 'right');
}
