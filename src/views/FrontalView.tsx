import { memo, useMemo } from 'react';
import { ViewCard } from '../components/ViewCard';
import { cssVars } from '../components/cssVars';
import { HatchPattern } from '../components/svg/HatchPattern';
import { useElementWidth } from '../components/svg/useElementWidth';
import { useSvgId } from '../components/svg/useSvgId';
import {
  compassPoint,
  floorLabel,
  useFormat,
  useLang,
  useMessages,
  type Format,
  type Lang,
  type Messages,
} from '../i18n';
import { useCommon, type CommonMessages } from '../i18n/common';
import {
  useFloorPlacements,
  useHorizons,
  useInstant,
  useLayout,
  useSelectedUtc,
  useSolarPath,
} from '../hooks/useModel';
import type { FloorPlacement, InstantState, PanelLayout } from '../model/types';
import { angleDiff } from '../model/units';
import { useConfig } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { floorColor } from '../styles/tokens';
import { FONT, HATCH, HATCH_LIGHT, LINE, PAD, VIEW_WIDTH } from './svg/constants';
import {
  REL_MAX,
  SUN_R,
  buildFacade,
  buildSky,
  floorValue,
  hourLabels,
  shadeRects,
  type Facade,
  type Sky,
} from './svg/frontalLayout';
import { clampLabelX, pathD, px, rectD, textWidth, wrapText } from './svg/geometry2d';
import { layoutLegend, type LegendItem } from './svg/legend';
import { SvgLegend } from './svg/Legend';
import { relativeDirection, useViewText, type ViewText } from './svg/messages';
import { SUN_GLYPH_EXTENT, SunGlyph, TextLines } from './svg/primitives';
import { SvgFigure } from './svg/SvgFigure';
import { GeometryNotices } from './svg/ViewNotice';
import s from './svg/svg.module.css';
import styles from './FrontalView.module.css';

// ─────────────────────────────────────────────
// FRONT VIEW
// Top: the sky seen from the facade (x = azimuth relative to the facade normal, mirrored so that
// "left/right" matches a viewer outside looking at the facade; y = altitude; one px-per-degree scale).
// Bottom: the facade to scale (metres) with slabs, railings, panel rows (visible height = drop) and the
// exact shade of the row above (model shade rects projected onto the facade plane).
// ─────────────────────────────────────────────

const de = {
  title: 'Frontalansicht',
  subtitle: (az: string) => `Blick von aussen auf die Fassade (${az})`,
  figTitle: (date: string, time: string) => `Frontalansicht am ${date} um ${time}`,
  desc: (facade: string, floors: string, modules: string) =>
    `Fassade ${facade}: ${floors}, je ${modules}. Oben die Sonnenbahn relativ zur Fassade, unten die Panelreihen mit dem Schatten der jeweils oberen Reihe.`,
  solstices: 'Sonnenwenden',
  sunPath: (date: string) => `Sonnenbahn ${date}`,
  lowHorizon: (floor: string) => `Horizont (${floor})`,
  floorStates: (list: string) => `Stockwerke: ${list}.`,
  flat: 'liegend: von vorne nur als Kante sichtbar',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Front view',
    subtitle: (az) => `Looking at the facade from outside (${az})`,
    figTitle: (date, time) => `Front view on ${date} at ${time}`,
    desc: (facade, floors, modules) =>
      `Facade ${facade}: ${floors}, ${modules} each. Top: the sun path relative to the facade; bottom: the panel rows with the shadow of the row above.`,
    solstices: 'Solstices',
    sunPath: (date) => `Sun path ${date}`,
    lowHorizon: (floor) => `Horizon (${floor})`,
    floorStates: (list) => `Floors: ${list}.`,
    flat: 'lying flat: seen edge-on from the front',
  },
};

// ── Layers ───────────────────────────────────

interface SkyWindowProps {
  sky: Sky;
  width: number;
  skyId: string;
  hatchId: string;
  f: Format;
}

/** Static part of the sky window (depends on date and config, not on the time of day). */
const SkyWindow = memo(function SkyWindow({ sky, width, skyId, hatchId, f }: SkyWindowProps) {
  const { box } = sky;
  const behind =
    rectD(box.x0, box.y0, sky.x(90) - box.x0, box.y1 - box.y0) +
    rectD(sky.x(-90), box.y0, box.x1 - sky.x(-90), box.y1 - box.y0);
  const facadePlane = [-90, 90]
    .map((r) =>
      pathD([
        { x: sky.x(r), y: box.y0 },
        { x: sky.x(r), y: box.y1 },
      ]),
    )
    .join('');
  return (
    <g>
      <path d={rectD(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0)} fill={`url(#${skyId})`} />
      <path d={behind} className={styles.behindZone} />
      <path d={behind} fill={`url(#${hatchId})`} />
      {sky.altTicks.map((a) => (
        <g key={a}>
          <path
            d={pathD([
              { x: box.x0, y: sky.y(a) },
              { x: box.x1, y: sky.y(a) },
            ])}
            className={styles.skyGrid}
          />
          <text x={px(box.x0 - 5)} y={px(sky.y(a) + 4)} textAnchor="end" className={`${s.small} ${s.num}`}>
            {f.deg(a)}
          </text>
        </g>
      ))}
      <path d={facadePlane} className={`${s.axis} ${s.axisDash}`} />
      {sky.horizon && <path d={sky.horizon} className={styles.horizonFill} />}
      {sky.lowHorizon && <path d={sky.lowHorizon} className={styles.lowHorizon} />}
      <path d={sky.refs} className={s.refPath} />
      <path d={sky.selected} className={s.sunPath} />
      {sky.hours.map((h, i) => (
        <circle key={i} cx={px(h.x)} cy={px(h.y)} r={2.5} className={s.hourDot} />
      ))}
      <path
        d={pathD([
          { x: box.x0, y: box.y1 },
          { x: box.x1, y: box.y1 },
        ])}
        className={s.axis}
      />
      <text x={px(box.x0 - 5)} y={px(box.y1 + 4)} textAnchor="end" className={`${s.small} ${s.num}`}>
        {f.deg(0)}
      </text>
      {sky.compass.map((cp) => (
        <text
          key={cp.label}
          x={px(clampLabelX(cp.x, textWidth(cp.label, FONT), 'middle', PAD, width - PAD))}
          y={px(box.y1 + 14)}
          textAnchor="middle"
          className={`${s.label} ${cp.strong ? s.strong : ''}`}
        >
          {cp.label}
        </text>
      ))}
    </g>
  );
});

/** Static part of the facade: wall, glazing, slabs, railings, panel rows and floor labels. */
const FacadeDrawing = memo(function FacadeDrawing({ facade, width }: { facade: Facade; width: number }) {
  return (
    <g>
      {facade.ground && <path d={rectD(PAD, facade.ground.y, width - 2 * PAD, 6)} className={s.ground} />}
      <path d={facade.wall} className={s.wall} />
      {facade.cut && <path d={facade.cut} className={s.wallCut} />}
      <path d={facade.openings} className={s.opening} />
      <path d={facade.mullions} className={s.mullion} />
      <path d={facade.slabs} className={s.slab} />
      <path d={facade.balusters} className={s.railing} />
      <path d={facade.railTops} className={s.railTop} />
      {facade.floors.map((fl) => (
        <path key={fl.floor} d={fl.modules} className={s.panel} />
      ))}
      {facade.ground && (
        <path
          d={pathD([
            { x: PAD, y: facade.ground.y },
            { x: width - PAD, y: facade.ground.y },
          ])}
          className={s.groundLine}
        />
      )}
      {facade.floors.map((fl) => (
        <g key={fl.floor}>
          <circle
            cx={px(facade.leftX - textWidth(fl.label, FONT) - 8)}
            cy={px(fl.yMid)}
            r={4}
            className={s.swatchFloor}
            style={cssVars({ '--c': floorColor(fl.floor) })}
          />
          <text x={px(facade.leftX)} y={px(fl.yMid + 4)} textAnchor="end" className={s.label}>
            {fl.label}
          </text>
        </g>
      ))}
    </g>
  );
});

interface ShadeLayerProps {
  instant: InstantState;
  layout: PanelLayout;
  placements: readonly FloorPlacement[];
  facade: Facade;
  hatchId: string;
  f: Format;
}

/**
 * Time-dependent part of the facade: exact shade of the row above on each floor (model shade rects
 * projected onto the facade), overlap marks and the shaded share per floor.
 */
function ShadeLayer({ instant, layout, placements, facade, hatchId, f }: ShadeLayerProps) {
  const d = shadeRects(instant, layout, placements, facade.fit);
  return (
    <g>
      {d && <path d={d} className={s.shade} />}
      {d && <path d={d} fill={`url(#${hatchId})`} />}
      {facade.overlap && <path d={facade.overlap} className={s.badFill} />}
      {facade.overlap && <path d={facade.overlap} className={s.bad} />}
      {facade.floors.map((fl) => (
        <text
          key={fl.floor}
          x={px(facade.rightX)}
          y={px(fl.yMid + 4)}
          className={`${s.label} ${s.num} ${s.strong}`}
        >
          {floorValue(instant, fl.floor, f)}
        </text>
      ))}
    </g>
  );
}

// ── Texts ────────────────────────────────────

/** One-line state of the sun for the status line. */
function sunStatus(
  instant: InstantState,
  facadeAz: number,
  placements: readonly FloorPlacement[],
  vt: ViewText,
  c: CommonMessages,
  f: Format,
  lang: Lang,
): string {
  const { sun } = instant;
  if (sun.altitude <= 0) return c.sunStates.night;
  const rel = angleDiff(sun.azimuth, facadeAz);
  const states = new Set(instant.floors.map((fl) => fl.state));
  if (states.has('behind')) return `${c.sunStates.behind} (${relativeDirection(rel, vt, f)})`;
  let text = `${vt.sunHigh(f.deg(sun.altitude))}, ${relativeDirection(rel, vt, f)}`;
  if (states.has('horizon')) {
    const blocked = instant.floors
      .filter((fl) => fl.state === 'horizon')
      .map((fl) => floorLabel(placements[fl.floor]?.storey ?? fl.floor, lang));
    text += ` · ${blocked.join(', ')}: ${c.sunStates.horizon}`;
  }
  return text;
}

/** Per-floor state for the text alternative, top floor first. */
function floorStatesText(
  instant: InstantState,
  placements: readonly FloorPlacement[],
  vt: ViewText,
  c: CommonMessages,
  f: Format,
  lang: Lang,
): string {
  const n = placements.length;
  return placements
    .map((p) => {
      const fl = instant.floors[p.floor];
      let value: string;
      if (!fl || fl.state !== 'lit') value = c.sunStates[fl?.state ?? 'night'];
      else if (p.floor === n - 1 && n > 1) value = `${vt.unshaded} (${vt.noFloorAbove})`;
      else value = fl.shade.fraction > 0 ? vt.shaded(f.pct(fl.shade.fraction * 100)) : vt.unshaded;
      return `${floorLabel(p.storey, lang)} ${value}`;
    })
    .reverse()
    .join('; ');
}

// ── Component ────────────────────────────────

/** Facade seen from outside with the panel rows, the sun path relative to the facade and the current shade. */
export function FrontalView() {
  const t = useMessages(messages);
  const vt = useViewText();
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const { building, location } = useConfig();
  const layout = useLayout();
  const placements = useFloorPlacements();
  const instant = useInstant();
  const horizons = useHorizons();
  const utcMs = useSelectedUtc();
  const date = useTimeStore((st) => st.date);
  const minutes = useTimeStore((st) => st.minutes);
  const year = date.slice(0, 4);
  const path = useSolarPath();
  const june = useSolarPath(`${year}-06-21`);
  const december = useSolarPath(`${year}-12-21`);
  const [frameRef, width] = useElementWidth<HTMLDivElement>(VIEW_WIDTH);
  const id = useSvgId('v');
  const hatchId = `${id}-hatch`;
  const shadeHatchId = `${id}-shade`;
  const skyId = `${id}-sky`;
  const facadeAz = building.facadeAzimuth;
  const n = placements.length;

  const sky = useMemo(
    () => buildSky(width, facadeAz, path, [june, december], horizons[n - 1], horizons[0], lang),
    [width, facadeAz, path, june, december, horizons, n, lang],
  );
  const facade = useMemo(
    () => buildFacade(width, sky.bottom, layout, placements, lang),
    [width, sky.bottom, layout, placements, lang],
  );

  // Status line (fixed number of lines so the figure does not jump while the time animates).
  const tz = f.tzName(location.timezone, utcMs);
  const time = vt.at(f.time(minutes), tz);
  const status = `${time} · ${sunStatus(instant, facadeAz, placements, vt, c, f, lang)}`;
  const statusLines = wrapText(status, width - 2 * PAD, FONT);
  if (layout.drop < 0.02) statusLines.push(t.flat);
  const reserved = Math.max(statusLines.length, width < 440 ? 3 : 2);
  const statusTop = facade.bottom + 16;

  const legendItems: LegendItem[] = [
    { key: 'path', label: t.sunPath(f.dateShort(date)), kind: 'line', className: s.sunPath },
    { key: 'ref', label: t.solstices, kind: 'line', className: s.refPath },
    { key: 'hours', label: vt.hoursLegend(tz), kind: 'dot', className: s.hourDot },
  ];
  if (sky.horizon) {
    const label = vt.horizonLegend(floorLabel(placements[n - 1].storey, lang));
    legendItems.push({ key: 'horizon', label, kind: 'area', className: styles.horizonFill });
  }
  if (sky.lowHorizon) {
    const label = t.lowHorizon(floorLabel(placements[0].storey, lang));
    legendItems.push({ key: 'lowHorizon', label, kind: 'line', className: styles.lowHorizon });
  }
  legendItems.push({
    key: 'behind',
    label: vt.behindFacade,
    kind: 'area',
    className: styles.behindZone,
    patternId: hatchId,
  });
  if (n > 1) {
    legendItems.push({
      key: 'shade',
      label: vt.shadeLegend,
      kind: 'area',
      baseClassName: s.panel,
      className: s.shade,
      patternId: shadeHatchId,
    });
  }
  const legendTop = statusTop + (reserved - 1) * LINE + 12;
  const legend = layoutLegend(legendItems, PAD, width - PAD, legendTop);
  const height = legendTop + legend.height + PAD;

  // Current sun: in the window, or parked (small, dimmed) at the edge when it is further round.
  const { sun } = instant;
  const rel = angleDiff(sun.azimuth, facadeAz);
  const inWindow = Math.abs(rel) <= REL_MAX;
  const lit = instant.floors.some((fl) => fl.state === 'lit');
  const sunX = inWindow ? sky.x(rel) : rel > 0 ? sky.box.x0 + SUN_R : sky.box.x1 - SUN_R;
  const sunY = Math.max(sky.box.y0, sky.y(sun.altitude));
  const sunR = inWindow ? SUN_R : 5;
  const hours = hourLabels(sky, sun.altitude > 0 ? { x: sunX, y: sunY } : null, sunR * SUN_GLYPH_EXTENT);

  const facadeText = `${f.deg(facadeAz)} ${compassPoint(facadeAz, lang)}`;
  const desc = [
    t.desc(facadeText, c.floorsCount(n), c.modulesCount(layout.count)),
    `${status}.`,
    t.floorStates(floorStatesText(instant, placements, vt, c, f, lang)),
  ].join(' ');

  return (
    <ViewCard title={t.title} subtitle={t.subtitle(facadeText)} exportName="frontalansicht" minHeight={280}>
      <GeometryNotices />
      <div ref={frameRef} className={s.frame}>
        <SvgFigure width={width} height={height} title={t.figTitle(f.date(date), time)} desc={desc}>
          <defs>
            <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className={s.skyTop} />
              <stop offset="1" className={s.skyBottom} />
            </linearGradient>
            <HatchPattern id={hatchId} {...HATCH} />
            <HatchPattern id={shadeHatchId} {...HATCH_LIGHT} />
          </defs>
          <SkyWindow sky={sky} width={width} skyId={skyId} hatchId={hatchId} f={f} />
          {sun.altitude > 0 && <SunGlyph x={sunX} y={sunY} r={sunR} dim={!lit || !inWindow} />}
          {/* Hour labels over the sun glyph (their halo keeps them legible) */}
          {hours.map((h) => (
            <text
              key={h.label}
              x={px(h.x)}
              y={px(h.y)}
              textAnchor="middle"
              className={`${s.small} ${s.num} ${s.halo}`}
            >
              {h.label}
            </text>
          ))}
          <FacadeDrawing facade={facade} width={width} />
          <ShadeLayer
            instant={instant}
            layout={layout}
            placements={placements}
            facade={facade}
            hatchId={shadeHatchId}
            f={f}
          />
          <TextLines x={PAD} y={statusTop} lines={statusLines} className={`${s.label} ${s.num}`} />
          <SvgLegend layout={legend} />
        </SvgFigure>
      </div>
    </ViewCard>
  );
}
