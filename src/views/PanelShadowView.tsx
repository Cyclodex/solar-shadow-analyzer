import { memo, useId, useMemo } from 'react';
import { Segmented } from '../components/Segmented';
import { ViewCard } from '../components/ViewCard';
import { floorLabel, useFormat, useLang, useMessages, type Format, type Messages } from '../i18n';
import { useCommon, type CommonMessages } from '../i18n/common';
import { useFloorPlacements, useFocusFloor, useInstant, useLayout, useSelectedUtc } from '../hooks/useModel';
import { SUBSTRINGS_PER_MODULE, panelsOverlap, substringBeamLoss } from '../model/geometry';
import type { FacadeVector, InstantState } from '../model/types';
import { angleDiff } from '../model/units';
import { useConfig } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { pathD, px, rectD, textWidth, wrapText } from './svg/geometry2d';
import { useSvgId } from './svg/ids';
import { layoutLegend, type LegendItem } from './svg/legend';
import { SvgLegend } from './svg/Legend';
import { relativeDirection, useViewText, type ViewText } from './svg/messages';
import { FONT, LINE, PAD } from './svg/constants';
import { INSET, buildRow, clippedRect, hitSubstrings, type RowGeometry } from './svg/panelShadowLayout';
import { Arrow, HatchPattern, SUN_GLYPH_EXTENT, SunGlyph, TextLines } from './svg/primitives';
import { SvgFigure } from './svg/SvgFigure';
import { useElementWidth } from './svg/useElementWidth';
import { ViewNotice } from './svg/ViewNotice';
import s from './svg/svg.module.css';
import styles from './PanelShadowView.module.css';

// ─────────────────────────────────────────────
// PANEL SHADOW (detail of the analysed floor)
// The panel row seen perpendicular to its plane: u to the right (as seen from outside), v down the
// slope from the railing (top edge). Modules with gaps, cell grid and bypass substrings, the exact shade
// rectangles of the model, and — faintly — the whole shadow of the row above (row shifted by −du, −dv).
// ─────────────────────────────────────────────

const de = {
  title: 'Panel-Schatten',
  subtitle: (floor: string) => `${floor}: Panelreihe senkrecht zur Modulebene gesehen`,
  figTitle: (floor: string, time: string) => `Schatten auf der Panelreihe ${floor} um ${time}`,
  desc: (count: string, w: string, l: string, subs: number) =>
    `${count} von ${w} × ${l}, oben die Kante am Geländer. Je Modul ${subs} Bypass-Teilstränge.`,
  floorSelect: 'Stockwerk für die Detailansicht',
  railing: 'Oberkante am Geländer',
  loss: (pct: string) => `Verlust ${pct}`,
  moduleList: (list: string) => `Je Modul von links: ${list}.`,
  lossNote: 'Verlust = Anteil der Direktstrahlung, der wegen verschatteter Teilstränge verloren geht.',
  legendModule: 'Modul mit Zellen',
  legendShade: 'Verschatteter Bereich',
  legendCast: 'Ganzer Schattenwurf der oberen Reihe',
  legendHit: 'betroffener Teilstrang',
  topFloor: 'Oberstes Stockwerk: keine Panels darüber, kein Schatten.',
  shadedLinear: (pct: string) => `${pct} der Reihe verschattet.`,
  shadedSubstring: (pct: string, loss: string) =>
    `${pct} der Reihe verschattet, ${loss} Verlust der Direktstrahlung (Teilstrang-Modell).`,
  noShade: 'Kein Schatten der oberen Reihe.',
  besideRow: 'Kein Schatten: Der Schatten der oberen Reihe fällt seitlich neben die Reihe.',
  aboveRow: 'Kein Schatten: Der Schatten der oberen Reihe fällt oberhalb der Reihe.',
  shift: (du: string, dv: string) => `Schattenversatz ${du} seitlich, ${dv} entlang der Neigung.`,
  sunDir: 'Draufsicht',
  facade: 'Fassade',
};
type PanelShadowText = typeof de;

const messages: Messages<PanelShadowText> = {
  de,
  en: {
    title: 'Panel shadow',
    subtitle: (floor) => `${floor}: panel row seen perpendicular to the module plane`,
    figTitle: (floor, time) => `Shadow on the panel row of ${floor} at ${time}`,
    desc: (count, w, l, subs) =>
      `${count} of ${w} × ${l}, top edge at the railing. ${subs} bypass substrings per module.`,
    floorSelect: 'Floor for the detail view',
    railing: 'Top edge at the railing',
    loss: (pct) => `loss ${pct}`,
    moduleList: (list) => `Per module from the left: ${list}.`,
    lossNote: 'Loss = share of the direct irradiance lost because of shaded substrings.',
    legendModule: 'Module with cells',
    legendShade: 'Shaded area',
    legendCast: 'Full shadow of the row above',
    legendHit: 'affected substring',
    topFloor: 'Top floor: no panels above, no shadow.',
    shadedLinear: (pct) => `${pct} of the row shaded.`,
    shadedSubstring: (pct, loss) =>
      `${pct} of the row shaded, ${loss} loss of direct irradiance (substring model).`,
    noShade: 'No shadow from the row above.',
    besideRow: 'No shadow: the shadow of the row above falls beside the row.',
    aboveRow: 'No shadow: the shadow of the row above falls above the row.',
    shift: (du, dv) => `Shadow offset ${du} sideways, ${dv} along the slope.`,
    sunDir: 'Plan view',
    facade: 'Facade',
  },
};

/** Up to this many floors the selector is a segmented control, above that a compact <select>. */
const MAX_SEGMENTS = 4;

/** Selector for the analysed floor (uiStore.focusFloor), top floor first. */
function FloorSelector() {
  const t = useMessages(messages);
  const lang = useLang();
  const placements = useFloorPlacements();
  const focus = useFocusFloor();
  const setFocusFloor = useUiStore((st) => st.setFocusFloor);
  const selectId = useId();
  if (placements.length < 2) return null;
  const options = [...placements]
    .reverse()
    .map((p) => ({ value: p.floor, label: floorLabel(p.storey, lang) }));
  if (options.length <= MAX_SEGMENTS) {
    return (
      <Segmented label={t.floorSelect} options={options} value={focus} onChange={setFocusFloor} size="sm" />
    );
  }
  return (
    <>
      <label htmlFor={selectId} className="sr-only">
        {t.floorSelect}
      </label>
      <select
        id={selectId}
        className={styles.select}
        value={focus}
        onChange={(e) => setFocusFloor(Number(e.target.value))}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}

/** Static drawing of the row: modules, cell grid, substring boundaries, railing edge. */
const RowDrawing = memo(function RowDrawing({ row, rowWidth }: { row: RowGeometry; rowWidth: number }) {
  return (
    <g>
      <path d={row.modules} className={s.panel} />
      {row.cells && <path d={row.cells} className={s.panelCell} />}
      <path d={row.substrings} className={s.substring} />
      <path
        d={pathD([
          { x: row.ux(-rowWidth / 2) - 4, y: row.railY },
          { x: row.ux(rowWidth / 2) + 4, y: row.railY },
        ])}
        className={s.railTop}
      />
    </g>
  );
});

interface SunInsetProps {
  x: number;
  y: number;
  /** Sun direction in the facade frame (u right seen from outside, n outward); null at night. */
  sun: FacadeVector | null;
  dim: boolean;
  t: PanelShadowText;
}

/** Plan-view inset: facade on top, outward normal pointing down, sun direction relative to the facade. */
function SunInset({ x, y, sun, dim, t }: SunInsetProps) {
  const c = { x: x + INSET / 2, y: y + INSET / 2 + 4 };
  const r = INSET / 2 - 12;
  const horiz = sun ? Math.hypot(sun.u, sun.n) : 0;
  const dir = sun && horiz > 1e-6 ? { x: sun.u / horiz, y: sun.n / horiz } : null;
  const glyphR = 5;
  return (
    <g>
      <path d={rectD(x, y, INSET, INSET)} className={s.frameRect} />
      <path d={rectD(x + 6, y + 2, INSET - 12, c.y - 8 - y - 2)} className={styles.insetWall} />
      <path
        d={pathD([
          { x: x + 6, y: c.y - 8 },
          { x: x + INSET - 6, y: c.y - 8 },
        ])}
        className={s.railTop}
      />
      <text x={px(c.x)} y={px(y + 13)} textAnchor="middle" className={s.small}>
        {t.facade}
      </text>
      <text x={px(x + INSET / 2)} y={px(y + INSET + 13)} textAnchor="middle" className={s.small}>
        {t.sunDir}
      </text>
      {dir && (
        <>
          <Arrow
            from={{
              x: c.x + dir.x * (r - glyphR * SUN_GLYPH_EXTENT),
              y: c.y + dir.y * (r - glyphR * SUN_GLYPH_EXTENT),
            }}
            to={{ x: c.x + dir.x * 6, y: c.y + dir.y * 6 }}
            head={6}
          />
          <SunGlyph x={c.x + dir.x * r} y={c.y + dir.y * r} r={glyphR} dim={dim} />
        </>
      )}
    </g>
  );
}

/** Status lines: time and floor, sun state, shaded share (and substring loss), shadow offset, sun direction. */
function statusLines(
  instant: InstantState,
  floor: number,
  isTop: boolean,
  losses: number[] | null,
  facadeAz: number,
  slopeLength: number,
  t: PanelShadowText,
  vt: ViewText,
  c: CommonMessages,
  f: Format,
): string[] {
  const fl = instant.floors[floor];
  const state = fl?.state ?? 'night';
  const shade = fl?.shade;
  const pct = (v: number): string => f.pct(v * 100);
  const lines: string[] = [];
  if (state !== 'lit') lines.push(`${c.sunStates[state]}.`);
  else if (isTop) lines.push(instant.floors.length > 1 ? t.topFloor : `${c.sunStates.lit}.`);
  else if (shade && shade.fraction > 0) {
    const meanLoss = losses ? losses.reduce((a, b) => a + b, 0) / Math.max(1, losses.length) : 0;
    lines.push(
      losses ? t.shadedSubstring(pct(shade.fraction), pct(meanLoss)) : t.shadedLinear(pct(shade.fraction)),
    );
    lines.push(t.shift(f.unit(Math.abs(shade.du) * 100, 'cm'), f.unit(shade.dv * 100, 'cm')));
  } else if (shade && (shade.du !== 0 || shade.dv !== 0)) {
    // Model: shade = row shifted by (−du, −dv); dv ≥ L puts it above the row, |du| ≥ row width beside it.
    lines.push(shade.dv >= slopeLength ? t.aboveRow : t.besideRow);
  } else lines.push(t.noShade);
  const { sun } = instant;
  if (sun.altitude > 0) {
    lines.push(
      `${vt.sunHigh(f.deg(sun.altitude))}, ${relativeDirection(angleDiff(sun.azimuth, facadeAz), vt, f)}.`,
    );
  }
  return lines;
}

/** Exact shade of the row above on the analysed floor's panel row, per module and substring. */
export function PanelShadowView() {
  const t = useMessages(messages);
  const vt = useViewText();
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const { building, system, location } = useConfig();
  const layout = useLayout();
  const placements = useFloorPlacements();
  const focus = useFocusFloor();
  const instant = useInstant();
  const utcMs = useSelectedUtc();
  const minutes = useTimeStore((st) => st.minutes);
  const [frameRef, width] = useElementWidth<HTMLDivElement>();
  const hatchId = `${useSvgId()}-hatch`;
  const n = placements.length;
  const placement = placements[focus] ?? placements[0];
  const floorName = floorLabel(placement.storey, lang);
  const isTop = focus === n - 1;
  const substringModel = system.shadingModel === 'substring';
  const row = useMemo(() => buildRow(width, layout), [width, layout]);

  // Exact shade of the analysed floor (model), substring losses and the affected substrings.
  const fl = instant.floors[focus];
  const shade = fl?.shade;
  const rects = shade?.rects ?? [];
  const perModule = shade?.perModule ?? [];
  const losses = shade && substringModel ? substringBeamLoss(shade, layout) : null;
  const toRect = (b: { u0: number; u1: number; v0: number; v1: number }): string =>
    rectD(row.ux(b.u0), row.vy(b.v0), (b.u1 - b.u0) * row.k, (b.v1 - b.v0) * row.k);
  const shadeD = rects.map(toRect).join('');
  const hitD = substringModel ? hitSubstrings(layout, rects).map(toRect).join('') : '';
  // Whole shadow of the row above (row translated by −du, −dv), clipped to the plot area.
  const cast =
    fl?.state === 'lit' && !isTop && shade && (shade.du !== 0 || shade.dv !== 0)
      ? layout.modules
          .map((m) => clippedRect(row, m.u0 - shade.du, m.u1 - shade.du, -shade.dv, layout.length - shade.dv))
          .join('')
      : '';
  // Railing label on the side the cast shadow does not cover (the shadow shifts by −du).
  const railLabelRight = cast !== '' && (shade?.du ?? 0) > 0;

  // Per-module labels below the row (two lines with the substring loss when there is room); "–" when the
  // sun does not reach the row (night, behind the facade, below the horizon profile).
  const lit = fl?.state === 'lit';
  const pct = (v: number): string => f.pct(v * 100);
  const twoLines = substringModel && row.colW >= Math.max(textWidth(t.loss('100 %'), FONT), 44) + 4;
  const oneLine = row.colW >= textWidth('100 %', FONT) + 4;
  const labelsTop = row.bottom + 16;
  const stripTop = labelsTop + (oneLine ? (twoLines ? 2 : 1) : 0) * 14 + 8;

  // Status next to the inset (reserved line count so the figure keeps its height while animating).
  const tz = f.tzName(location.timezone, utcMs);
  const time = vt.at(f.time(minutes), tz);
  const lines = [
    `${time} · ${floorName}`,
    ...statusLines(instant, focus, isTop, losses, building.facadeAzimuth, layout.length, t, vt, c, f),
  ];
  if (lit && !oneLine && !isTop && perModule.length > 0)
    lines.push(t.moduleList(perModule.map(pct).join(' · ')));
  const textX = PAD + INSET + 14;
  const wrapped = lines.flatMap((l) => wrapText(l, width - textX - PAD, FONT));
  const reserved = Math.max(wrapped.length, width < 440 ? 7 : 5);
  const stripH = Math.max(INSET + 16, reserved * LINE + 4);

  const legendItems: LegendItem[] = [
    { key: 'module', label: t.legendModule, kind: 'area', className: s.panel },
    {
      key: 'shade',
      label: t.legendShade,
      kind: 'area',
      baseClassName: s.panel,
      className: s.shade,
      patternId: hatchId,
    },
    { key: 'cast', label: t.legendCast, kind: 'area', className: styles.cast },
  ];
  if (substringModel)
    legendItems.push({ key: 'hit', label: t.legendHit, kind: 'area', className: styles.hitSwatch });
  const legendTop = stripTop + stripH + 6;
  const legend = layoutLegend(legendItems, PAD, width - PAD, legendTop);
  const noteLines = substringModel ? wrapText(t.lossNote, width - 2 * PAD, 10) : [];
  const height = legendTop + legend.height + (noteLines.length ? noteLines.length * 13 + 2 : 0) + PAD;

  /** Metres → "176.2 cm" (one decimal only when needed). */
  const cmText = (m: number): string => {
    const v = Math.round(m * 1000) / 10;
    return f.unit(v, 'cm', Number.isInteger(v) ? 0 : 1);
  };
  const moduleText = perModule
    .map((v, i) => (losses ? `${pct(v)} (${t.loss(pct(losses[i]))})` : pct(v)))
    .join(' · ');
  const desc = [
    t.desc(
      c.modulesCount(layout.count),
      cmText(layout.moduleWidth),
      cmText(layout.length),
      SUBSTRINGS_PER_MODULE,
    ),
    ...lines.slice(1),
    lit && !isTop && perModule.length > 0 ? t.moduleList(moduleText) : '',
  ]
    .filter(Boolean)
    .join(' ');
  const overlap = n > 1 && panelsOverlap(layout);

  return (
    <ViewCard
      title={t.title}
      subtitle={t.subtitle(floorName)}
      toolbar={<FloorSelector />}
      exportName="panel-schatten"
      minHeight={260}
    >
      {overlap && (
        <ViewNotice>{vt.overlap(f.unit((layout.drop - layout.floorHeight) * 100, 'cm'))}</ViewNotice>
      )}
      <div ref={frameRef} className={s.frame}>
        <SvgFigure width={width} height={height} title={t.figTitle(floorName, time)} desc={desc}>
          <defs>
            <HatchPattern id={hatchId} tone="light" />
          </defs>
          {cast && <path d={cast} className={styles.cast} />}
          <RowDrawing row={row} rowWidth={layout.rowWidth} />
          {shadeD && <path d={shadeD} className={s.shade} />}
          {shadeD && <path d={shadeD} fill={`url(#${hatchId})`} />}
          {hitD && <path d={hitD} className={styles.hit} />}
          <text
            x={px(row.ux(((railLabelRight ? 1 : -1) * layout.rowWidth) / 2))}
            y={px(row.railY - 8)}
            textAnchor={railLabelRight ? 'end' : 'start'}
            className={`${s.small} ${s.halo}`}
          >
            {t.railing}
          </text>
          {oneLine &&
            !isTop &&
            layout.modules.map((m, i) => {
              const cx = row.ux((m.u0 + m.u1) / 2);
              return (
                <text
                  key={i}
                  x={px(cx)}
                  y={px(labelsTop)}
                  textAnchor="middle"
                  className={`${s.label} ${s.num}`}
                >
                  <tspan className={s.strong}>{lit ? pct(perModule[i] ?? 0) : '–'}</tspan>
                  {twoLines && losses && lit && (
                    <tspan x={px(cx)} dy={14} className={s.small}>
                      {t.loss(pct(losses[i] ?? 0))}
                    </tspan>
                  )}
                </text>
              );
            })}
          <SunInset
            x={PAD}
            y={stripTop}
            sun={instant.sun.altitude > 0 ? instant.sunFacade : null}
            dim={!lit}
            t={t}
          />
          <TextLines x={textX} y={stripTop + 12} lines={wrapped} className={`${s.label} ${s.num}`} />
          <SvgLegend layout={legend} />
          {noteLines.length > 0 && (
            <TextLines
              x={PAD}
              y={legendTop + legend.height + 12}
              lines={noteLines}
              lineHeight={13}
              className={s.small}
            />
          )}
        </SvgFigure>
      </div>
    </ViewCard>
  );
}
