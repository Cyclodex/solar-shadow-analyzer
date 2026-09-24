import { describe, expect, it } from 'vitest';
import { getFormat } from '../../i18n';
import { DEFAULT_CONFIG } from '../../model/defaults';
import { floorPlacements, instantState, panelLayout } from '../../model/geometry';
import { solarPath } from '../../model/sun';
import { localToUtc } from '../../model/time';
import type { Config } from '../../model/types';
import { angleDiff } from '../../model/units';
import { PAD } from './constants';
import { SUN_R, buildFacade, buildSky, floorValue, hourLabels } from './frontalLayout';
import {
  boxHitsCircle,
  boxesOverlap,
  clipSegment,
  labelBox,
  raySegment,
  textWidth,
  type Box,
  type Pt,
} from './geometry2d';
import { panelDepthBelowGround } from './geometryChecks';
import { buildRow, clippedBox, hitSubstrings, moduleGrid, railLabel } from './panelShadowLayout';
import { SUN_GLYPH_EXTENT } from './primitives';
import {
  INTERIOR,
  SLAB_T,
  WALL_T,
  buildPair,
  buildScene,
  criticalLabel,
  placedBox,
  sunRay,
  thetaLabel,
} from './profileLayout';
import {
  RING_ALTITUDES,
  buildDiagram,
  facadeLabelBox,
  hourLabels as sunPathHourLabels,
  hourMarks,
  makePolar,
  smallLabelBox,
} from './sunPathLayout';

const config = (patch: Partial<Config['building']> = {}, panels: Partial<Config['panels']> = {}): Config => ({
  ...DEFAULT_CONFIG,
  building: { ...DEFAULT_CONFIG.building, ...patch },
  panels: { ...DEFAULT_CONFIG.panels, ...panels },
});
const { latitude, longitude, timezone } = DEFAULT_CONFIG.location;

describe('sun path layout', () => {
  it('draws north up, east right, zenith in the centre and r ∝ 90° − altitude', () => {
    const p = makePolar(500);
    const north = p.pos(0, 0);
    const east = p.pos(90, 0);
    expect(north.x).toBeCloseTo(p.cx);
    expect(north.y).toBeCloseTo(p.cy - p.R);
    expect(east.x).toBeCloseTo(p.cx + p.R);
    expect(p.pos(123, 90)).toEqual({ x: p.cx, y: p.cy });
    expect(p.cy - p.pos(0, 30).y).toBeCloseTo((p.R * 2) / 3);
    // Below-horizon altitudes are clamped onto the ring.
    expect(p.pos(180, -10).y).toBeCloseTo(p.cy + p.R);
  });

  const paths = new Map<string, ReturnType<typeof solarPath>>();
  const pathOf = (date: string, lat: number, lon: number, tz: string) => {
    const key = `${date} ${lat}`;
    if (!paths.has(key)) paths.set(key, solarPath(date, lat, lon, tz));
    return paths.get(key) ?? [];
  };
  const diagram = (
    width: number,
    facadeAz: number,
    site: { lat: number; lon: number; tz: string } = { lat: latitude, lon: longitude, tz: timezone },
    date = '2025-06-21',
    facadeWord = 'Fassade',
  ) => {
    const f = getFormat('de');
    const refDates = ['2025-12-21', '2025-03-20', '2025-06-21'];
    return buildDiagram({
      width,
      latitude: site.lat,
      facadeAz,
      selectedDate: date,
      refDates,
      refPaths: refDates.map((d) => pathOf(d, site.lat, site.lon, site.tz)),
      selected: pathOf(date, site.lat, site.lon, site.tz),
      horizon: undefined,
      layout: panelLayout(DEFAULT_CONFIG),
      placement: floorPlacements(DEFAULT_CONFIG)[0],
      lang: 'de',
      facadeText: `${facadeWord} ${f.deg(facadeAz)}`,
      refLabels: refDates.map((d) => f.dateShort(d)),
    });
  };

  it('keeps the facade label inside the figure and off the hour and date labels', () => {
    for (const width of [302, 332, 472]) {
      for (let az = 0; az < 360; az += 10) {
        for (const word of ['Fassade', 'Facade']) {
          const d = diagram(width, az, undefined, undefined, word);
          const b = facadeLabelBox(d.facadeLabel);
          expect(b.x0, `${width} px, ${az}°`).toBeGreaterThanOrEqual(PAD - 0.01);
          expect(b.x1, `${width} px, ${az}°`).toBeLessThanOrEqual(width - PAD + 0.01);
          if (width < 472) continue;
          const labels = [
            ...d.hours.flatMap((h) => (h.label ? [smallLabelBox(h.lx, h.ly, h.label)] : [])),
            ...d.refs.flatMap((r) => (r.label ? [smallLabelBox(r.label.x, r.label.y, r.label.text)] : [])),
          ];
          for (const l of labels) expect(boxesOverlap(b, l), `${width} px, ${az}°`).toBe(false);
        }
      }
    }
  });

  it('labels the altitude rings clear of the hour and date labels', () => {
    const sites = [
      { lat: 47.1, lon: longitude, tz: timezone },
      { lat: -33.87, lon: 151.21, tz: 'Australia/Sydney' },
      { lat: 10, lon: 0, tz: 'UTC' },
      { lat: 0, lon: 0, tz: 'UTC' },
      { lat: 60, lon: 10.75, tz: 'Europe/Oslo' },
      { lat: 78.2, lon: 15.6, tz: 'Arctic/Longyearbyen' },
    ];
    for (const site of sites) {
      for (const date of ['2025-06-21', '2025-03-20', '2025-12-21']) {
        for (const width of [302, 472]) {
          for (let az = 0; az < 360; az += 10) {
            const d = diagram(width, az, site, date);
            const labels = [
              ...d.hours.flatMap((h) => (h.label ? [smallLabelBox(h.lx, h.ly, h.label)] : [])),
              ...d.refs.flatMap((r) => (r.label ? [smallLabelBox(r.label.x, r.label.y, r.label.text)] : [])),
            ];
            for (const alt of RING_ALTITUDES) {
              const p = d.polar.pos(d.ringAz, alt);
              const ring = smallLabelBox(p.x, p.y + 4, `${alt}°`);
              const at = `${site.lat}°, ${date}, ${width} px, facade ${az}°: ${alt}° ring`;
              for (const b of labels) expect(boxesOverlap(ring, b), at).toBe(false);
            }
          }
        }
      }
    }
  });

  it('does not label 24:00 on top of 0:00 on a polar day', () => {
    const path = solarPath('2025-06-21', 69.65, 18.96, 'Europe/Oslo');
    const marks = hourMarks(path, makePolar(472)).filter((h) => h.label !== null);
    expect(marks[0].label).toBe('0');
    expect(marks.map((h) => h.label)).not.toContain('24');
    for (let i = 0; i < marks.length; i++) {
      for (let j = i + 1; j < marks.length; j++) {
        expect(Math.hypot(marks[i].lx - marks[j].lx, marks[i].ly - marks[j].ly)).toBeGreaterThan(10);
      }
    }
  });

  it('moves the hour label that the current sun would cover, and only that one', () => {
    const d = diagram(472, 202);
    const noon = pathOf('2025-06-21', latitude, longitude, timezone).find((p) => p.minutes === 720);
    if (!noon) throw new Error('no 12:00 point');
    const sun = d.polar.pos(noon.sun.azimuth, noon.sun.altitude);
    const ext = 7 * SUN_GLYPH_EXTENT;
    const labels = sunPathHourLabels(d.hours, d.polar, sun, ext);
    const twelve = labels.find((l) => l.label === '12');
    const eight = labels.find((l) => l.label === '8');
    const eightMark = d.hours.find((h) => h.label === '8');
    if (!twelve || !eight || !eightMark) throw new Error('labels missing');
    const before = d.hours.find((h) => h.label === '12');
    if (!before) throw new Error('no 12 mark');
    expect(boxHitsCircle(smallLabelBox(before.lx, before.ly, '12'), sun, ext)).toBe(true);
    expect(boxHitsCircle(smallLabelBox(twelve.x, twelve.y, '12'), sun, ext)).toBe(false);
    expect(eight).toEqual({ x: eightMark.lx, y: eightMark.ly, label: '8' });
  });

  it('never moves a hour label onto another label', () => {
    for (const width of [302, 472]) {
      for (const az of [90, 202, 270]) {
        const d = diagram(width, az);
        const others = (label: string): Box[] => [
          ...d.fixedLabels,
          ...d.hours.flatMap((h) =>
            h.label && h.label !== label ? [smallLabelBox(h.lx, h.ly, h.label)] : [],
          ),
        ];
        for (const p of pathOf('2025-06-21', latitude, longitude, timezone)) {
          if (p.minutes % 10 !== 0 || p.sun.altitude <= 0) continue;
          const sun = d.polar.pos(p.sun.azimuth, p.sun.altitude);
          for (const l of sunPathHourLabels(d.hours, d.polar, sun, 7 * SUN_GLYPH_EXTENT, d.fixedLabels)) {
            const mark = d.hours.find((h) => h.label === l.label);
            if (mark?.lx === l.x && mark.ly === l.y) continue;
            const b = smallLabelBox(l.x, l.y, l.label);
            const at = `${width} px, facade ${az}°, minute ${p.minutes}: ${l.label}`;
            expect(boxHitsCircle(b, sun, 7 * SUN_GLYPH_EXTENT), at).toBe(false);
            for (const o of others(l.label)) expect(boxesOverlap(b, o), at).toBe(false);
          }
        }
      }
    }
  });
});

describe('front view layout', () => {
  const path = solarPath('2025-06-21', latitude, longitude, timezone);

  it('mirrors the relative azimuth so that "left" matches a viewer outside the facade', () => {
    const sky = buildSky(480, 180, path, [], undefined, undefined, 'de');
    // Facade facing south, seen from outside (looking north): east (rel −90°) is on the right.
    expect(sky.x(-90)).toBeGreaterThan(sky.x(0));
    expect(sky.x(90)).toBeLessThan(sky.x(0));
    expect(sky.y(0)).toBeGreaterThan(sky.y(30));
    // Same px-per-degree scale on both axes.
    expect(sky.x(0) - sky.x(30)).toBeCloseTo(sky.y(0) - sky.y(30));
    const labels = sky.compass.map((c) => c.label);
    expect(labels).toEqual(['O', 'SO', 'S 180°', 'SW', 'W']);
    expect(sky.compass[0].x).toBeGreaterThan(sky.compass[4].x);
  });

  it('stacks the floors bottom-up and fits every row inside the given width', () => {
    const c = config({ numFloors: 8 }, { count: 8, width: 250 });
    const f = buildFacade(360, 200, panelLayout(c), floorPlacements(c), 'en');
    expect(f.floors.map((fl) => fl.label)).toEqual([
      'Floor 1',
      'Floor 2',
      'Floor 3',
      'Floor 4',
      'Floor 5',
      'Floor 6',
      'Floor 7',
      'Floor 8',
    ]);
    for (let i = 1; i < f.floors.length; i++) expect(f.floors[i].yMid).toBeLessThan(f.floors[i - 1].yMid);
    expect(f.fit.box.x0).toBeGreaterThanOrEqual(0);
    expect(f.fit.box.x1).toBeLessThanOrEqual(360);
  });

  it('does not label 24:00 on top of 0:00 on a polar day', () => {
    const tromso = solarPath('2025-06-21', 69.65, 18.96, 'Europe/Oslo');
    const labelled = buildSky(472, 0, tromso, [], undefined, undefined, 'de').hours.filter((h) => h.label);
    expect(labelled.map((h) => h.label)).toContain('0');
    expect(labelled.map((h) => h.label)).not.toContain('24');
  });

  it('keeps the hour labels clear of the current sun', () => {
    const sky = buildSky(480, 202, path, [], undefined, undefined, 'de');
    const noon = path.find((p) => p.minutes === 720);
    if (!noon) throw new Error('no 12:00 point');
    const sun = { x: sky.x(angleDiff(noon.sun.azimuth, 202)), y: sky.y(noon.sun.altitude) };
    const ext = SUN_R * SUN_GLYPH_EXTENT;
    const labels = hourLabels(sky, sun, ext);
    for (const l of labels) {
      expect(boxHitsCircle(labelBox(l.x, l.y, textWidth(l.label, 10), 'middle', 10), sun, ext), l.label).toBe(
        false,
      );
    }
    // Far from the sun the labels stay above their dots.
    const far = sky.hours.filter((h) => h.label && Math.hypot(h.x - sun.x, h.y - sun.y) > 40);
    expect(far.length).toBeGreaterThan(3);
    for (const h of far)
      expect(labels.find((l) => l.label === h.label)).toEqual({ x: h.x, y: h.y - 7, label: h.label });
    // Without a sun nothing moves.
    const twelve = sky.hours.find((h) => h.label === '12');
    expect(hourLabels(sky, null, ext).find((l) => l.label === '12')?.y).toBe((twelve?.y ?? 0) - 7);
  });

  it('measures how far ground-floor panels would reach into the ground', () => {
    const depth = (c: Config): number => panelDepthBelowGround(panelLayout(c), floorPlacements(c));
    expect(depth(DEFAULT_CONFIG)).toBe(0);
    // 113.4 cm module at θ 20°: drop 106.6 cm against a 100 cm railing.
    expect(depth(config({ lowestFloor: 0 }, { tiltFromVertical: 20 }))).toBeCloseTo(0.0656, 4);
    // Portrait 176.2 cm at θ 45°: drop 124.6 cm.
    expect(depth(config({ lowestFloor: 0 }, { width: 113.4, length: 176.2 }))).toBeCloseTo(0.2459, 4);
    expect(depth(config({ lowestFloor: 0 }))).toBe(0);
  });

  it('shows the shaded share only where the sun reaches the row', () => {
    const f = getFormat('de');
    const night = instantState(DEFAULT_CONFIG, localToUtc('2025-06-21', 0, timezone), []);
    expect(floorValue(night, 0, f)).toBe('–');
    const noon = instantState(DEFAULT_CONFIG, localToUtc('2025-06-21', 720, timezone), []);
    expect(floorValue(noon, 0, f)).toMatch(/^\d+\s%$/);
  });
});

describe('side view layout', () => {
  const sideView = (c: Config, width = 640, focus = 0) => {
    const layout = panelLayout(c);
    const scene = buildScene(width, layout, floorPlacements(c), focus, 50);
    return { layout, scene, pair: buildPair(scene, layout) };
  };
  const ray = ({ scene, pair }: ReturnType<typeof sideView>, profileDeg: number) => {
    const r = sunRay(pair.rayOrigin, profileDeg, scene.box, scene.fit.x(0), pair.rayObstacles);
    if (!r) throw new Error(`no ray at ${profileDeg}°`);
    return r;
  };

  it('ends the sun ray on the first slab, railing, panel or wall it meets', () => {
    const v = sideView(config());
    const { fit, lower, upper } = v.scene;
    if (!upper) throw new Error('two floors expected');
    // 21 June 15:00: passes above the lower row and lands on the lower balcony floor.
    const summer = ray(v, 62.4).to;
    expect(summer.y).toBeCloseTo(fit.y(lower.slabZ), 6);
    expect(summer.x).toBeGreaterThan(fit.x(0));
    expect(summer.x).toBeLessThan(fit.x(lower.railN));
    // 21 December 12:00: stopped by the front of the upper balcony slab.
    const winter = ray(v, 21.7).to;
    expect(winter.x).toBeCloseTo(fit.x(upper.railN), 6);
    expect(winter.y).toBeGreaterThan(fit.y(upper.slabZ));
    expect(winter.y).toBeLessThan(fit.y(upper.slabZ - SLAB_T));
    // Over the lower railing onto the facade wall.
    expect(ray(v, 40).to.x).toBeCloseTo(fit.x(0), 6);
    // Above the critical angle: on the lower panel.
    const onPanel = ray(v, 70).to;
    const [a, b] = v.pair.lowerSeg;
    expect((onPanel.x - a.x) * (b.y - a.y) - (onPanel.y - a.y) * (b.x - a.x)).toBeCloseTo(0, 3);
    expect(onPanel.x).toBeGreaterThan(a.x);
    expect(onPanel.x).toBeLessThan(b.x);
  });

  it('ends the sun ray on the single panel it lights', () => {
    const v = sideView(config({ numFloors: 1 }));
    for (const deg of [21.7, 45, 70.7]) {
      const r = ray(v, deg);
      expect(r.to).toEqual(r.origin);
      expect(r.origin).toEqual(v.pair.P(v.scene.lower, v.layout.length / 2));
    }
  });

  it.each([
    { name: 'default', c: config(), focus: 0 },
    { name: 'vertical panels', c: config({}, { tiltFromVertical: 0 }), focus: 0 },
    { name: 'flat panels', c: config({}, { tiltFromVertical: 90 }), focus: 0 },
    { name: '4 floors, focus 2. OG', c: config({ numFloors: 4 }), focus: 1 },
    { name: 'deep balcony, low railing', c: config({ balconyDepth: 400, railingHeight: 50 }), focus: 0 },
  ])('never draws the sun ray through a slab or railing: $name', ({ c, focus }) => {
    const v = sideView(c, 640, focus);
    const { fit, shown } = v.scene;
    const nMin = -WALL_T - INTERIOR;
    const slabs = shown.map((p) => ({
      x0: fit.x(nMin) + 0.5,
      y0: fit.y(p.slabZ) + 0.5,
      x1: fit.x(p.railN) - 0.5,
      y1: fit.y(p.slabZ - SLAB_T) - 0.5,
    }));
    const railings = shown.map((p) => [fit.p(p.railN, p.slabZ), fit.p(p.railN, p.railTopZ)] as const);
    for (let deg = 1; deg <= 89; deg++) {
      const r = ray(v, deg);
      const len = Math.hypot(r.to.x - r.origin.x, r.to.y - r.origin.y);
      for (const s of slabs) expect(clipSegment(r.origin, r.to, s), `${deg}° through a slab`).toBeNull();
      if (len < 0.5) continue;
      const dir = { x: (r.to.x - r.origin.x) / len, y: (r.to.y - r.origin.y) / len };
      for (const [a, b] of railings) {
        const hit = raySegment(r.origin, dir, a, b);
        expect(hit === null || hit.t >= len - 0.5, `${deg}° through a railing`).toBe(true);
      }
      expect(r.to.x).toBeGreaterThanOrEqual(fit.x(0) - 0.5);
    }
  });

  const labelCases: { name: string; c: Config; focus?: number }[] = [
    { name: 'default', c: config() },
    { name: 'portrait modules', c: config({}, { width: 113.4, length: 176.2 }) },
    { name: 'shallow balcony', c: config({ balconyDepth: 60 }) },
    { name: 'deep balcony', c: config({ balconyDepth: 400 }) },
    { name: 'no balcony', c: config({ balconyDepth: 0 }) },
    { name: 'tilt 20°', c: config({}, { tiltFromVertical: 20 }) },
    { name: 'tilt 70°', c: config({}, { tiltFromVertical: 70 }) },
    { name: 'floor height 250', c: config({ floorHeight: 250 }) },
    { name: 'floor height 500', c: config({ floorHeight: 500 }) },
    { name: 'low railing', c: config({ railingHeight: 50 }) },
    { name: '4 floors', c: config({ numFloors: 4 }), focus: 1 },
  ];
  const overlaps = (b: Box, o: Box): boolean => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1;

  it.each(labelCases)('keeps the critical-angle label clear of the gap dimension: $name', ({ c, focus }) => {
    for (const width of [302, 332, 472, 900]) {
      for (const word of ['kritisch', 'critical']) {
        const v = sideView(c, width, focus ?? 0);
        const { fit, box } = v.scene;
        const deg = `${v.layout.criticalProfileAngle.toFixed(1)}°`;
        const l = criticalLabel(v.scene, v.pair, v.layout, `${word} ${deg}`, deg);
        const up = v.pair.upperBottom;
        if (!l || !up) throw new Error('critical label expected');
        const b = placedBox(l);
        const gap = { x0: v.pair.gapX - 6, y0: up.y, x1: v.pair.gapX + 18, y1: v.pair.lowerTop.y };
        const at = `${width} px, "${l.text}"`;
        expect(overlaps(b, gap), at).toBe(false);
        expect(b.x0, at).toBeGreaterThanOrEqual(fit.x(0));
        expect(b.x0, at).toBeGreaterThanOrEqual(box.x0);
        expect(b.x1, at).toBeLessThanOrEqual(box.x1);
        const theta = placedBox(thetaLabel(v.scene, v.pair, v.layout, 'θ 45°'));
        expect(overlaps(b, theta), at).toBe(false);
      }
    }
  });

  it.each([1, 2])('draws the θ label clear of the panel, guide and railing (%i floors)', (numFloors) => {
    for (const theta of [2, 10, 20, 30, 45, 60, 75, 90]) {
      for (const balconyDepth of [0, 60, 150, 400]) {
        for (const width of [302, 472, 900]) {
          const v = sideView(config({ numFloors, balconyDepth }, { tiltFromVertical: theta }), width);
          const { pivot, arcR, back } = v.pair;
          const floor = v.scene.upper ?? v.scene.lower;
          const end = v.pair.P(floor, v.layout.length);
          const b = placedBox(thetaLabel(v.scene, v.pair, v.layout, `θ ${theta}°`));
          const at = `θ ${theta}°, depth ${balconyDepth}, ${width} px`;
          const lines: [Pt, Pt][] = [
            [pivot, end],
            [
              { x: pivot.x + back.x, y: pivot.y + back.y },
              { x: end.x + back.x, y: end.y + back.y },
            ],
            [pivot, { x: pivot.x, y: pivot.y + arcR + 8 }],
            [v.scene.fit.p(floor.railN, floor.slabZ), v.scene.fit.p(floor.railN, floor.railTopZ)],
          ];
          for (const [a, c] of lines) expect(clipSegment(a, c, b), at).toBeNull();
          expect(b.y1, at).toBeLessThan(v.scene.fit.y(floor.slabZ));
        }
      }
    }
  });

  it('shows all floors when they fit, else the analysed pair', () => {
    const two = config();
    const a = buildScene(480, panelLayout(two), floorPlacements(two), 0, 40);
    expect(a.shown).toHaveLength(2);
    const eight = config({ numFloors: 8, floorHeight: 500 });
    const b = buildScene(480, panelLayout(eight), floorPlacements(eight), 7, 40);
    expect(b.shown.map((p) => p.floor)).toEqual([6, 7]);
    expect(b.lower.floor).toBe(6);
    expect(b.upper?.floor).toBe(7);
    const one = config({ numFloors: 1 });
    expect(buildScene(480, panelLayout(one), floorPlacements(one), 0, 40).upper).toBeNull();
  });
});

describe('panel shadow layout', () => {
  it('draws substrings parallel to the long side', () => {
    const landscape = panelLayout(config({}, { width: 176, length: 113 }));
    const g = moduleGrid(landscape, 0);
    expect(g.subs).toHaveLength(2);
    for (const [a, b] of g.subs) expect(a.y).toBeCloseTo(b.y); // horizontal bands
    const portrait = panelLayout(config({}, { width: 60, length: 180 }));
    for (const [a, b] of moduleGrid(portrait, 0).subs) expect(a.x).toBeCloseTo(b.x); // vertical bands
  });

  it('marks exactly the substrings touched by a shade rectangle', () => {
    const layout = panelLayout(config({}, { width: 176, length: 113, count: 1 }));
    const m = layout.modules[0];
    const top = hitSubstrings(layout, [{ u0: m.u0, u1: m.u1, v0: 0, v1: 0.2 }]);
    expect(top).toHaveLength(1);
    expect(top[0].v0).toBe(0);
    expect(hitSubstrings(layout, [{ u0: m.u0, u1: m.u1, v0: 0, v1: 0.5 }])).toHaveLength(2);
    expect(hitSubstrings(layout, [])).toHaveLength(0);
  });

  it('keeps the railing label clear of the cast shadow of the row above', () => {
    const layout = panelLayout(DEFAULT_CONFIG);
    const L = layout.length;
    const text = 'Oberkante am Geländer';
    for (const width of [302, 472, 900]) {
      const row = buildRow(width, layout);
      const castOf = (du: number, dv: number): Box[] =>
        layout.modules.flatMap((m) => clippedBox(row, m.u0 - du, m.u1 - du, -dv, L - dv) ?? []);
      const boxOf = (l: ReturnType<typeof railLabel>): Box =>
        labelBox(l.x, l.y, textWidth(text, 10) + 4, l.anchor, 10);
      const cases = [
        { du: 0.3, dv: 0.3 }, // small sideways shift: the shadow covers both corners
        { du: -0.3, dv: 0.3 },
        { du: 0.05, dv: L + 0.1 }, // shadow above the row, over the label band
        { du: -0.05, dv: L + 0.1 },
        { du: 2.5, dv: 0.3 }, // far to the left: the right corner is free
      ];
      for (const { du, dv } of cases) {
        const cast = castOf(du, dv);
        const l = railLabel(row, layout.rowWidth, text, cast, du > 0);
        const at = `${width} px, du ${du}, dv ${dv}`;
        for (const c of cast) expect(boxesOverlap(boxOf(l), c), at).toBe(false);
        expect(boxOf(l).y0, at).toBeGreaterThanOrEqual(PAD);
      }
      // Free corner: on the rail line, on the side the shadow leaves.
      const free = railLabel(row, layout.rowWidth, text, castOf(2.5, 0.3), true);
      expect(free).toMatchObject({ y: row.railY - 8, anchor: 'end', leader: null });
      // Both corners covered: above the plot area with a leader down to the rail.
      const lifted = railLabel(row, layout.rowWidth, text, castOf(0.3, 0.3), true);
      expect(lifted.y).toBeLessThan(row.box.y0);
      expect(lifted.leader?.[1].y).toBeCloseTo(row.railY - 2);
      // No cast shadow: left corner on the rail line.
      expect(railLabel(row, layout.rowWidth, text, [], false)).toMatchObject({
        anchor: 'start',
        leader: null,
      });
    }
  });
});
