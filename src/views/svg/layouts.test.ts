import { describe, expect, it } from 'vitest';
import { getFormat } from '../../i18n';
import { DEFAULT_CONFIG } from '../../model/defaults';
import { floorPlacements, instantState, panelLayout } from '../../model/geometry';
import { solarPath } from '../../model/sun';
import { localToUtc } from '../../model/time';
import type { Config } from '../../model/types';
import { buildFacade, buildSky, floorValue } from './frontalLayout';
import { hitSubstrings, moduleGrid } from './panelShadowLayout';
import { buildScene } from './profileLayout';
import { makePolar } from './sunPathLayout';

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

  it('shows the shaded share only where the sun reaches the row', () => {
    const f = getFormat('de');
    const night = instantState(DEFAULT_CONFIG, localToUtc('2025-06-21', 0, timezone), []);
    expect(floorValue(night, 0, f)).toBe('–');
    const noon = instantState(DEFAULT_CONFIG, localToUtc('2025-06-21', 720, timezone), []);
    expect(floorValue(noon, 0, f)).toMatch(/^\d+\s%$/);
  });
});

describe('side view layout', () => {
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
});
