import { memo, useMemo } from 'react';
import { ViewCard } from '../components/ViewCard';
import { HatchPattern } from '../components/svg/HatchPattern';
import {
  compassPoint,
  floorLabel,
  useFormat,
  useLang,
  useMessages,
  type Format,
  type Messages,
} from '../i18n';
import { useCommon } from '../i18n/common';
import {
  useFloorPlacements,
  useFocusFloor,
  useHorizons,
  useInstant,
  useLayout,
  useSelectedUtc,
  useSolarPath,
  useSunTimes,
} from '../hooks/useModel';
import { useConfig } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { pathD, px, wrapText } from './svg/geometry2d';
import { useSvgId } from '../components/svg/useSvgId';
import { layoutLegend, type LegendItem } from './svg/legend';
import { SvgLegend } from './svg/Legend';
import { useViewText } from './svg/messages';
import { SUN_GLYPH_EXTENT, SunGlyph, TextLines } from './svg/primitives';
import { FONT, HATCH, LINE, PAD, VIEW_WIDTH } from './svg/constants';
import { RIM, RING_ALTITUDES, buildDiagram, hourLabels, type Diagram } from './svg/sunPathLayout';
import { SvgFigure } from './svg/SvgFigure';
import { useElementWidth } from '../components/svg/useElementWidth';
import s from './svg/svg.module.css';
import styles from './SunPathView.module.css';

// ─────────────────────────────────────────────
// SUN PATH (plan view, polar diagram)
// Zenith at the centre, radius ∝ 90° − altitude (horizon = outer ring), north up, azimuth clockwise.
// Sun paths of the solstices, the equinox and the selected date (local clock hours), the facade line
// with the half-plane in front of the facade, the horizon profile of the analysed floor and a small
// plan of the building with the panel row.
// ─────────────────────────────────────────────

const de = {
  title: 'Sonnenbahn',
  subtitle: 'Draufsicht, Norden oben – Zenit in der Mitte, Horizont am Rand',
  figTitle: (date: string) => `Sonnenbahndiagramm für den ${date}`,
  desc: (facade: string) =>
    `Polardiagramm des Himmels: Zenit in der Mitte, Horizont am äusseren Ring, Norden oben. Die Fassade schaut nach ${facade}.`,
  refDays: 'Sonnenwenden, Tagundnachtgleiche',
  selected: (date: string) => `Sonnenbahn ${date}`,
  sunNow: (alt: string, az: string) => `Sonne ${alt} hoch, Azimut ${az}`,
  front: (ranges: string) => `Sonne vor der Fassade: ${ranges} (10-Minuten-Raster)`,
  neverFront: 'Die Sonne steht an diesem Tag nie vor der Fassade.',
  maxAlt: (alt: string, time: string) => `Höchststand ${alt} um ${time}`,
  facade: 'Fassade',
};
type SunPathText = typeof de;

/** Core radius of the current sun's glyph, px. */
const SUN_R = 7;

const messages: Messages<SunPathText> = {
  de,
  en: {
    title: 'Sun path',
    subtitle: 'Plan view, north up – zenith in the centre, horizon at the edge',
    figTitle: (date) => `Sun path diagram for ${date}`,
    desc: (facade) =>
      `Polar diagram of the sky: zenith in the centre, horizon at the outer ring, north up. The facade faces ${facade}.`,
    refDays: 'Solstices, equinox',
    selected: (date) => `Sun path ${date}`,
    sunNow: (alt, az) => `Sun ${alt} high, azimuth ${az}`,
    front: (ranges) => `Sun in front of the facade: ${ranges} (10-minute steps)`,
    neverFront: 'The sun is never in front of the facade on this day.',
    maxAlt: (alt, time) => `Highest ${alt} at ${time}`,
    facade: 'Facade',
  },
};

interface PolarDiagramProps {
  diagram: Diagram;
  hatchId: string;
  f: Format;
}

/** Static drawing: sky disc, behind-the-facade half, horizon, grid, compass, building plan, sun paths. */
const PolarDiagram = memo(function PolarDiagram({ diagram, hatchId, f }: PolarDiagramProps) {
  const { polar, footprint: fp } = diagram;
  const { cx, cy, R, pos } = polar;
  const spokes = Array.from({ length: 12 }, (_, i) => pathD([{ x: cx, y: cy }, pos(i * 30, 0)])).join('');
  return (
    <g>
      <circle cx={px(cx)} cy={px(cy)} r={px(R)} className={styles.disc} />
      <path d={diagram.frontHalf} className={styles.frontHalf} />
      <path d={diagram.backHalf} className={styles.behindZone} />
      <path d={diagram.backHalf} fill={`url(#${hatchId})`} />
      {diagram.horizon && <path d={diagram.horizon} className={styles.horizonFill} fillRule="evenodd" />}

      {/* Grid: altitude rings 30° / 60°, azimuth spokes every 30° */}
      {[30, 60].map((alt) => (
        <circle key={alt} cx={px(cx)} cy={px(cy)} r={px((R * (90 - alt)) / 90)} className={s.grid} />
      ))}
      <path d={spokes} className={`${s.grid} ${s.gridDash}`} />
      <circle cx={px(cx)} cy={px(cy)} r={px(R)} className={s.axis} />
      {RING_ALTITUDES.map((alt) => {
        const p = pos(diagram.ringAz, alt);
        return (
          <text
            key={alt}
            x={px(p.x)}
            y={px(p.y + 4)}
            textAnchor="middle"
            className={`${s.small} ${s.num} ${s.halo}`}
          >
            {f.deg(alt)}
          </text>
        );
      })}
      {diagram.compass.map((cp) => (
        <text
          key={cp.az}
          x={px(cp.x)}
          y={px(cp.y)}
          textAnchor="middle"
          className={`${s.label} ${cp.az === 0 ? s.strong : ''}`}
        >
          {cp.label}
        </text>
      ))}

      {/* Facade line, orientation and building plan */}
      <path d={diagram.facadeLine} className={styles.facadeLine} />
      <path d={diagram.normal} className={styles.normal} />
      <text
        x={px(diagram.facadeLabel.x)}
        y={px(diagram.facadeLabel.y)}
        textAnchor={diagram.facadeLabel.anchor}
        className={`${s.label} ${s.strong} ${s.num} ${s.halo}`}
      >
        {diagram.facadeLabel.text}
      </text>
      <path d={fp.building} className={s.wall} />
      {fp.balcony && <path d={fp.balcony} className={s.slab} />}
      <path d={fp.panels} className={s.panel} />

      {/* Sun paths: reference days (direct labels), selected day with local clock hours */}
      {diagram.refs.map((r) => (
        <path key={r.date} d={r.d} className={s.refPath} />
      ))}
      <path d={diagram.selected} className={s.sunPath} />
      {diagram.refs.map((r) =>
        r.label ? (
          <text
            key={r.date}
            x={px(r.label.x)}
            y={px(r.label.y)}
            textAnchor={r.label.anchor}
            className={`${s.small} ${s.halo}`}
          >
            {r.label.text}
          </text>
        ) : null,
      )}
      {diagram.hours.map((h, i) => (
        <circle key={i} cx={px(h.x)} cy={px(h.y)} r={2.5} className={s.hourDot} />
      ))}
    </g>
  );
});

/** Polar sun-path diagram with facade orientation, horizon and the current sun. */
export function SunPathView() {
  const t = useMessages(messages);
  const vt = useViewText();
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const { building, location } = useConfig();
  const layout = useLayout();
  const placements = useFloorPlacements();
  const horizons = useHorizons();
  const focus = useFocusFloor();
  const instant = useInstant();
  const utcMs = useSelectedUtc();
  const date = useTimeStore((st) => st.date);
  const minutes = useTimeStore((st) => st.minutes);
  const year = date.slice(0, 4);
  const refDates = useMemo(() => [`${year}-12-21`, `${year}-03-20`, `${year}-06-21`] as const, [year]);
  const dec = useSolarPath(refDates[0]);
  const mar = useSolarPath(refDates[1]);
  const jun = useSolarPath(refDates[2]);
  const selected = useSolarPath();
  const times = useSunTimes();
  const [frameRef, width] = useElementWidth<HTMLDivElement>(VIEW_WIDTH);
  const hatchId = `${useSvgId('v')}-hatch`;
  const facadeAz = building.facadeAzimuth;
  const placement = placements[focus] ?? placements[0];

  const diagram = useMemo(
    () =>
      buildDiagram({
        width,
        latitude: location.latitude,
        facadeAz,
        selectedDate: date,
        refDates,
        refPaths: [dec, mar, jun],
        selected,
        horizon: horizons[focus],
        layout,
        placement,
        lang,
        facadeText: `${t.facade} ${f.deg(facadeAz)}`,
        refLabels: refDates.map((d) => f.dateShort(d)),
      }),
    [
      width,
      location.latitude,
      facadeAz,
      date,
      refDates,
      dec,
      mar,
      jun,
      selected,
      horizons,
      focus,
      layout,
      placement,
      lang,
      t,
      f,
    ],
  );
  const { cx, cy, R, pos } = diagram.polar;

  // Current sun (colour from the exact state of the analysed floor); hour labels step aside for it.
  const { sun } = instant;
  const sunUp = sun.altitude > 0;
  const lit = instant.floors[focus]?.state === 'lit';
  const sunAt = sunUp ? pos(sun.azimuth, sun.altitude) : null;
  const hours = hourLabels(
    diagram.hours,
    diagram.polar,
    sunAt,
    SUN_R * SUN_GLYPH_EXTENT,
    diagram.fixedLabels,
  );

  // Status (reserved line count so the figure keeps its height while the time animates).
  const tz = f.tzName(location.timezone, utcMs);
  const now = sunUp
    ? t.sunNow(f.deg(sun.altitude), `${f.deg(sun.azimuth)} ${compassPoint(sun.azimuth, lang)}`)
    : c.sunStates.night;
  const statusA = `${vt.at(f.time(minutes), tz)} · ${now}`;
  let statusB: string;
  if (times.polar === 'night') statusB = c.polarNight;
  else if (diagram.front.length === 0) statusB = t.neverFront;
  else statusB = t.front(diagram.front.map(([a, b]) => `${f.time(a)}–${f.time(b)}`).join(', '));
  const statusC = diagram.peak
    ? t.maxAlt(f.deg(diagram.peak.sun.altitude), f.time(diagram.peak.minutes))
    : '';
  const lines = [statusA, statusB, statusC]
    .filter(Boolean)
    .flatMap((l) => wrapText(l, width - 2 * PAD, FONT));
  const statusTop = cy + R + RIM + 8;
  const reserved = Math.max(lines.length, width < 440 ? 4 : 3);

  const legendItems: LegendItem[] = [
    { key: 'sel', label: t.selected(f.dateShort(date)), kind: 'line', className: s.sunPath },
    { key: 'ref', label: t.refDays, kind: 'line', className: s.refPath },
    { key: 'hours', label: vt.hoursLegend(tz), kind: 'dot', className: s.hourDot },
    { key: 'front', label: vt.inFront, kind: 'area', className: styles.frontHalf },
    { key: 'behind', label: vt.behindFacade, kind: 'area', className: styles.behindZone, patternId: hatchId },
  ];
  if (diagram.horizon) {
    const label = vt.horizonLegend(floorLabel(placement.storey, lang));
    legendItems.push({ key: 'horizon', label, kind: 'area', className: styles.horizonFill });
  }
  const legendTop = statusTop + (reserved - 1) * LINE + 12;
  const legend = layoutLegend(legendItems, PAD, width - PAD, legendTop);
  const height = legendTop + legend.height + PAD;

  const desc = [t.desc(`${f.deg(facadeAz)} ${compassPoint(facadeAz, lang)}`), statusA, statusB, statusC]
    .filter(Boolean)
    .map((l) => (/[.!?]$/.test(l) ? l : `${l}.`))
    .join(' ');

  return (
    <ViewCard title={t.title} subtitle={t.subtitle} exportName="sonnenbahn" minHeight={280}>
      <div ref={frameRef} className={s.frame}>
        <SvgFigure width={width} height={height} title={t.figTitle(f.date(date))} desc={desc}>
          <defs>
            <HatchPattern id={hatchId} {...HATCH} />
          </defs>
          <PolarDiagram diagram={diagram} hatchId={hatchId} f={f} />
          {sunAt && (
            <g>
              <path d={pathD([{ x: cx, y: cy }, pos(sun.azimuth, 0)])} className={styles.azimuthLine} />
              <SunGlyph {...sunAt} r={SUN_R} dim={!lit} />
            </g>
          )}
          {/* Hour labels over the sun glyph and azimuth line (their halo keeps them legible) */}
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
          <TextLines x={PAD} y={statusTop} lines={lines} className={`${s.label} ${s.num}`} />
          <SvgLegend layout={legend} />
        </SvgFigure>
      </div>
    </ViewCard>
  );
}
