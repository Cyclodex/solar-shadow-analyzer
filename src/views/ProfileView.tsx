import { memo, useMemo } from 'react';
import { ViewCard } from '../components/ViewCard';
import { cssVars } from '../components/cssVars';
import { HatchPattern } from '../components/svg/HatchPattern';
import { floorLabel, useFormat, useLang, useMessages, type Format, type Lang, type Messages } from '../i18n';
import { useCommon, type CommonMessages } from '../i18n/common';
import { useFloorPlacements, useFocusFloor, useInstant, useLayout, useSelectedUtc } from '../hooks/useModel';
import { panelsOverlap } from '../model/geometry';
import type { InstantState, PanelLayout } from '../model/types';
import { toRad } from '../model/units';
import { useConfig } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { floorColor } from '../styles/tokens';
import { pathD, px, stripD, textWidth, wrapText } from './svg/geometry2d';
import { useSvgId } from '../components/svg/useSvgId';
import { layoutLegend, type LegendItem } from './svg/legend';
import { SvgLegend } from './svg/Legend';
import { useViewText } from './svg/messages';
import { AngleArc, DimensionLine, SunGlyph, TextLines } from './svg/primitives';
import { FONT, HATCH, LINE, PAD, VIEW_WIDTH } from './svg/constants';
import {
  INTERIOR,
  REACH_DIM_DY,
  WALL_T,
  buildBuilding,
  buildPair,
  buildScene,
  criticalLabel,
  fitLabel,
  sunRay,
  thetaLabel,
  type Building,
  type PairGeometry,
  type Scene,
} from './svg/profileLayout';
import { SvgFigure } from './svg/SvgFigure';
import { useElementWidth } from '../components/svg/useElementWidth';
import { GeometryNotices } from './svg/ViewNotice';
import s from './svg/svg.module.css';
import styles from './ProfileView.module.css';

// ─────────────────────────────────────────────
// SIDE VIEW (section perpendicular to the facade)
// World axes: n = distance from the facade wall (right), z = height (up), metres, one uniform scale.
// The critical-angle ray and the sun ray at the profile angle are explanatory (2D); whether and how
// much a row is shaded comes from the exact 3D model (useInstant → shade rects / fraction).
// ─────────────────────────────────────────────

const de = {
  title: 'Seitenansicht',
  subtitle: 'Schnitt durch die Balkone, senkrecht zur Fassade',
  figTitle: (time: string) => `Seitenansicht um ${time}`,
  desc: (floors: string, theta: string, beta: string, h: string, gap: string, reach: string) =>
    `Schnitt durch ${floors}. Neigung θ ${theta} ab Senkrechte (β ${beta} ab Horizontal), Stockwerkhöhe ${h}, ${gap}, Auskragung ${reach}.`,
  critical: (v: string) => `kritisch ${v}`,
  criticalDesc: (v: string) => `Kritischer Profilwinkel ${v}.`,
  noCritical: 'Senkrechte Panels (θ = 0°) verschatten sich nicht gegenseitig.',
  profile: (v: string) => `Profilwinkel ${v}`,
  gap: (v: string) => `Abstand ${v}`,
  gapDesc: (v: string) => `vertikaler Abstand ${v}`,
  overlap: (v: string) => `Überlappung ${v}`,
  reach: (v: string) => `Auskragung ${v}`,
  height: (v: string) => `Stockwerkhöhe ${v}`,
  theta: (v: string) => `θ ${v}`,
  beta: (v: string) => `β ${v}`,
  legendRay: 'Sonnenstrahl (Profilwinkel)',
  legendCritical: 'Kritischer Winkel (2D)',
  legendShade: 'Schatten (3D-Modell)',
  shadeNow: (floor: string, pct: string) => `${floor}: ${pct} verschattet (exaktes 3D-Modell).`,
  noShadeNow: (floor: string) => `${floor}: kein Schatten der oberen Reihe.`,
  lateral:
    'Der Profilwinkel liegt über dem kritischen Winkel, der Schatten fällt aber seitlich neben die Reihe.',
  singleFloor: 'Nur ein Stockwerk: keine Panelreihe darüber.',
  onlyPair: (a: string, b: string) => `Gezeigt: ${a} und ${b}.`,
};
type ProfileText = typeof de;

const messages: Messages<ProfileText> = {
  de,
  en: {
    title: 'Side view',
    subtitle: 'Section through the balconies, perpendicular to the facade',
    figTitle: (time) => `Side view at ${time}`,
    desc: (floors, theta, beta, h, gap, reach) =>
      `Section through ${floors}. Tilt θ ${theta} from vertical (β ${beta} from horizontal), floor height ${h}, ${gap}, reach ${reach}.`,
    critical: (v) => `critical ${v}`,
    criticalDesc: (v) => `Critical profile angle ${v}.`,
    noCritical: 'Vertical panels (θ = 0°) never shade each other.',
    profile: (v) => `Profile angle ${v}`,
    gap: (v) => `Gap ${v}`,
    gapDesc: (v) => `vertical gap ${v}`,
    overlap: (v) => `Overlap ${v}`,
    reach: (v) => `Reach ${v}`,
    height: (v) => `Floor height ${v}`,
    theta: (v) => `θ ${v}`,
    beta: (v) => `β ${v}`,
    legendRay: 'Sun ray (profile angle)',
    legendCritical: 'Critical angle (2D)',
    legendShade: 'Shadow (3D model)',
    shadeNow: (floor, pct) => `${floor}: ${pct} shaded (exact 3D model).`,
    noShadeNow: (floor) => `${floor}: no shadow from the row above.`,
    lateral: 'The profile angle exceeds the critical angle, but the shadow falls beside the row.',
    singleFloor: 'Single floor: no panel row above.',
    onlyPair: (a, b) => `Shown: ${a} and ${b}.`,
  },
};

function statusLines(
  instant: InstantState,
  layout: PanelLayout,
  scene: Scene,
  t: ProfileText,
  c: CommonMessages,
  f: Format,
  lang: Lang,
): string[] {
  const { sun, profileAngle } = instant;
  const out: string[] = [];
  if (sun.altitude <= 0) out.push(c.sunStates.night);
  else if (profileAngle === null) out.push(c.sunStates.behind);
  else {
    const showCritical = scene.upper && layout.reach > 1e-6 && layout.verticalGap >= 0;
    const crit = showCritical ? ` (${t.critical(f.deg(layout.criticalProfileAngle, 1))})` : '';
    out.push(`${t.profile(f.deg(profileAngle, 1))}${crit}`);
  }
  if (!scene.upper) {
    out.push(t.singleFloor);
    return out;
  }
  const fl = instant.floors[scene.lower.floor];
  const name = floorLabel(scene.lower.storey, lang);
  if (fl?.state === 'horizon') out.push(`${name}: ${c.sunStates.horizon}.`);
  else if (fl?.state === 'lit' && fl.shade.fraction > 0)
    out.push(t.shadeNow(name, f.pct(fl.shade.fraction * 100)));
  else if (fl?.state === 'lit') {
    out.push(t.noShadeNow(name));
    const exceeds =
      profileAngle !== null && layout.reach > 1e-6 && profileAngle > layout.criticalProfileAngle;
    if (exceeds && layout.verticalGap >= 0) out.push(t.lateral);
  }
  if (layout.reach <= 1e-6) out.push(t.noCritical);
  return out;
}

interface SectionDrawingProps {
  scene: Scene;
  building: Building;
  pair: PairGeometry;
  layout: PanelLayout;
  labels: readonly string[];
  t: ProfileText;
  f: Format;
}

/** Static part of the section: building, panels, floor labels, critical angle, dimensions and angles. */
const SectionDrawing = memo(function SectionDrawing({
  scene,
  building,
  pair,
  layout,
  labels,
  t,
  f,
}: SectionDrawingProps) {
  const { fit, lower, upper } = scene;
  const { x, y } = fit;
  const L = layout.length;
  const theta = layout.tiltFromVertical;
  const thetaRad = toRad(theta);
  const cm = (m: number): string => f.unit(m * 100, 'cm');
  const overlap = upper !== null && layout.verticalGap < 0;
  const gapPx = Math.abs(layout.verticalGap) * fit.k;
  const { pivot, tip, arcR } = pair;
  const critical = f.deg(layout.criticalProfileAngle, 1);
  const critLabel = criticalLabel(scene, pair, layout, t.critical(critical), critical);
  const thetaText = t.theta(f.deg(theta));
  return (
    <g>
      <path d={building.interior} className={styles.interior} />
      {building.ground && <path d={building.ground} className={s.ground} />}
      <path d={building.slabs} className={s.slab} />
      <path d={building.wall} className={s.wall} />
      <path d={building.railings} className={s.railTop} />
      {/* Panels: front face = sun side, thickness drawn towards the railing */}
      {scene.shown.map((p) => (
        <path key={p.floor} d={stripD(pair.P(p, 0), pair.P(p, L), pair.back)} className={s.panel} />
      ))}
      {scene.shown.map((p) => {
        const yl = y(p.slabZ) - 6;
        return (
          <g key={p.floor}>
            <circle
              cx={px(scene.labelX - textWidth(labels[p.floor], FONT) - 8)}
              cy={px(yl - 4)}
              r={4}
              className={s.swatchFloor}
              style={cssVars({ '--c': floorColor(p.floor) })}
            />
            <text x={px(scene.labelX)} y={px(yl)} textAnchor="end" className={s.label}>
              {labels[p.floor]}
            </text>
          </g>
        );
      })}

      {/* Critical angle: 2D onset of shading (explanatory) */}
      {pair.criticalEnd && critLabel && (
        <g>
          <path d={pathD([pair.lowerTop, pair.criticalEnd])} className={s.criticalRay} />
          <AngleArc
            c={pair.lowerTop}
            r={arcR + 8}
            a0={-toRad(layout.criticalProfileAngle)}
            a1={0}
            label={critLabel.text}
            labelAt={critLabel}
            className={styles.criticalArc}
            textClassName={s.criticalText}
          />
        </g>
      )}

      {/* Dimensions of the analysed pair */}
      {upper && (
        <DimensionLine
          a={{ x: x(-WALL_T - INTERIOR / 2), y: y(lower.slabZ) }}
          b={{ x: x(-WALL_T - INTERIOR / 2), y: y(upper.slabZ) }}
          label={fitLabel(
            t.height(cm(layout.floorHeight)),
            cm(layout.floorHeight),
            layout.floorHeight * fit.k,
          )}
          side="left"
          rotate
        />
      )}
      {upper && (
        <DimensionLine
          a={{ x: pair.gapX, y: y(lower.railTopZ) }}
          b={{ x: pair.gapX, y: y(upper.railTopZ - layout.drop) }}
          from={[
            { x: pair.lowerTop.x, y: y(lower.railTopZ) },
            pair.upperBottom ?? { x: pair.gapX, y: y(upper.railTopZ - layout.drop) },
          ]}
          label={
            overlap
              ? t.overlap(cm(-layout.verticalGap))
              : fitLabel(t.gap(cm(layout.verticalGap)), cm(layout.verticalGap), gapPx)
          }
          side="right"
          rotate
          tone={overlap ? 'bad' : 'default'}
        />
      )}
      {pair.showReach && (
        <DimensionLine
          a={{ x: x(lower.railN), y: tip.y + REACH_DIM_DY }}
          b={{ x: tip.x, y: tip.y + REACH_DIM_DY }}
          label={
            upper !== null || pair.panelPx >= 90
              ? fitLabel(t.reach(cm(layout.reach)), cm(layout.reach), layout.reach * fit.k + 60)
              : cm(layout.reach)
          }
          side="below"
        />
      )}

      {/* Angles: θ from vertical at the pivot, β from horizontal at the tip */}
      {theta >= 2 && (
        <g>
          <path d={pathD([pivot, { x: pivot.x, y: pivot.y + arcR + 8 }])} className={s.guide} />
          <AngleArc
            c={pivot}
            r={arcR}
            a0={Math.PI / 2 - thetaRad}
            a1={Math.PI / 2}
            label={thetaText}
            labelAt={thetaLabel(scene, pair, layout, thetaText)}
          />
        </g>
      )}
      {pair.showBeta && (
        <g>
          <path d={pathD([tip, { x: tip.x - arcR - 8, y: tip.y }])} className={s.guide} />
          <AngleArc
            c={tip}
            r={arcR * 0.8}
            a0={-Math.PI}
            a1={-(Math.PI / 2 + thetaRad)}
            label={t.beta(f.deg(layout.tiltFromHorizontal))}
            labelR={arcR * 0.8 + 12}
          />
        </g>
      )}
    </g>
  );
});

interface SunLayerProps {
  instant: InstantState;
  scene: Scene;
  pair: PairGeometry;
  hatchId: string;
  f: Format;
}

/** Time-dependent part: exact shaded slope band per floor and the sun ray at the profile angle. */
function SunLayer({ instant, scene, pair, hatchId, f }: SunLayerProps) {
  const { sun, profileAngle } = instant;
  const { lower } = scene;
  const bands = scene.shown.flatMap((p) => {
    const fl = instant.floors[p.floor];
    if (!fl || fl.state !== 'lit' || fl.shade.rects.length === 0) return [];
    // The v-interval is the same for all shade rects of a floor (model: row shifted by −dv).
    const r = fl.shade.rects[0];
    return [{ floor: p.floor, a: pair.P(p, r.v0), b: pair.P(p, r.v1), fraction: fl.shade.fraction }];
  });
  const ray =
    sun.altitude > 0 && profileAngle !== null
      ? sunRay(pair.rayOrigin, profileAngle, scene.box, scene.fit.x(0), pair.rayObstacles)
      : null;
  const lit = instant.floors.some((fl) => fl.state === 'lit');
  const lowerBlocked = instant.floors[lower.floor]?.state === 'horizon';
  const { front } = pair;
  return (
    <g>
      {bands.map((b) => (
        <g key={b.floor}>
          <path d={stripD(b.a, b.b, front)} className={styles.shadeBand} />
          <path d={stripD(b.a, b.b, front)} fill={`url(#${hatchId})`} />
        </g>
      ))}
      {ray && (
        <g>
          <path d={pathD([ray.to, ray.origin, ray.from])} className={lit ? s.ray : s.rayDim} />
          <SunGlyph x={ray.sun.x} y={ray.sun.y} r={8} dim={!lit || lowerBlocked} />
        </g>
      )}
      {bands
        .filter((b) => b.floor === lower.floor)
        .map((b) => (
          <text
            key={b.floor}
            x={px((b.a.x + b.b.x) / 2 - front.x * 1.6)}
            y={px((b.a.y + b.b.y) / 2 - front.y * 1.6 + 4)}
            textAnchor={front.x > 5 ? 'end' : 'middle'}
            className={`${s.label} ${s.num} ${s.strong} ${s.halo}`}
          >
            {f.pct(b.fraction * 100)}
          </text>
        ))}
    </g>
  );
}

/** Section perpendicular to the facade: balconies, tilted panels, critical angle and current sun ray. */
export function ProfileView() {
  const t = useMessages(messages);
  const vt = useViewText();
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const tz = useConfig().location.timezone;
  const layout = useLayout();
  const placements = useFloorPlacements();
  const instant = useInstant();
  const focus = useFocusFloor();
  const utcMs = useSelectedUtc();
  const minutes = useTimeStore((st) => st.minutes);
  const [frameRef, width] = useElementWidth<HTMLDivElement>(VIEW_WIDTH);
  const hatchId = `${useSvgId('v')}-hatch`;

  const labels = useMemo(() => placements.map((p) => floorLabel(p.storey, lang)), [placements, lang]);
  const labelWidth = Math.max(...labels.map((l) => textWidth(l, FONT))) + 12;
  const scene = useMemo(
    () => buildScene(width, layout, placements, focus, labelWidth),
    [width, layout, placements, focus, labelWidth],
  );
  const building = useMemo(() => buildBuilding(scene, layout), [scene, layout]);
  const pair = useMemo(() => buildPair(scene, layout), [scene, layout]);
  const { lower, upper } = scene;
  const overlap = upper !== null && panelsOverlap(layout);
  const cm = (m: number): string => f.unit(m * 100, 'cm');

  // Status (reserved line count so the figure keeps its height while the time animates).
  const lines = statusLines(instant, layout, scene, t, c, f, lang).flatMap((l) =>
    wrapText(l, width - 2 * PAD, FONT),
  );
  const partial = scene.shown.length < placements.length && upper !== null;
  if (partial) lines.push(t.onlyPair(floorLabel(lower.storey, lang), floorLabel(upper.storey, lang)));
  const reserved = Math.max(lines.length, (width < 440 ? 4 : 3) + (partial ? 1 : 0));
  // Below the reach dimension's label (baseline 2·REACH_DIM_DY under the tip) with room for its descent and
  // the status text's cap height.
  const statusTop = Math.max(scene.bottom + 22, pair.showReach ? pair.tip.y + 2 * REACH_DIM_DY + 16 : 0);

  const legendItems: LegendItem[] = [];
  if (pair.criticalEnd) {
    legendItems.push({ key: 'crit', label: t.legendCritical, kind: 'line', className: s.criticalRay });
  }
  legendItems.push({ key: 'ray', label: t.legendRay, kind: 'line', className: s.ray });
  if (upper) {
    legendItems.push({
      key: 'shade',
      label: t.legendShade,
      kind: 'area',
      className: styles.shadeBand,
      patternId: hatchId,
    });
  }
  const legendTop = statusTop + (reserved - 1) * LINE + 12;
  const legend = layoutLegend(legendItems, PAD, width - PAD, legendTop);
  const height = legendTop + legend.height + PAD;

  const time = vt.at(f.time(minutes), f.tzName(tz, utcMs));
  const desc = [
    `${time}.`,
    t.desc(
      upper ? `${labels[lower.floor]} / ${labels[upper.floor]}` : labels[lower.floor],
      f.deg(layout.tiltFromVertical),
      f.deg(layout.tiltFromHorizontal),
      cm(layout.floorHeight),
      overlap ? t.overlap(cm(-layout.verticalGap)) : t.gapDesc(cm(layout.verticalGap)),
      cm(layout.reach),
    ),
    pair.criticalEnd ? t.criticalDesc(f.deg(layout.criticalProfileAngle, 1)) : '',
    ...lines,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ViewCard title={t.title} subtitle={t.subtitle} exportName="seitenansicht" minHeight={280}>
      <GeometryNotices />
      <div ref={frameRef} className={s.frame}>
        <SvgFigure width={width} height={height} title={t.figTitle(time)} desc={desc}>
          <defs>
            <HatchPattern id={hatchId} {...HATCH} />
          </defs>
          <SectionDrawing
            scene={scene}
            building={building}
            pair={pair}
            layout={layout}
            labels={labels}
            t={t}
            f={f}
          />
          <SunLayer instant={instant} scene={scene} pair={pair} hatchId={hatchId} f={f} />
          <TextLines x={PAD} y={statusTop} lines={lines} className={`${s.label} ${s.num}`} />
          <SvgLegend layout={legend} />
        </SvgFigure>
      </div>
    </ViewCard>
  );
}
