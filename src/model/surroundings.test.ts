import { describe, expect, it } from 'vitest';
import type { Building } from './types';
import { enuToLonLat } from './enu';
import {
  OWN_BUILDING_EXCLUSION,
  dsmMaskPolygons,
  isOwnBuildingCell,
  ownBuildingIds,
  ownExclusionZone,
  prismBuildings,
} from './surroundings';

const sq = (e: number, n: number, s: number): [number, number][] => [
  [e, n],
  [e + s, n],
  [e + s, n + s],
  [e, n + s],
];

const b = (id: string, over: Partial<Building> = {}): Building => ({
  id,
  name: '',
  footprint: sq(0, 20, 10),
  base: 0,
  height: 12,
  source: 'swisstopo',
  ...over,
});

const buildings: Building[] = [
  b('imported'),
  b('removed', { removed: true }),
  b('edited', { edited: true, height: 20 }),
  b('removedEdited', { removed: true, edited: true }),
  b('manual', { source: 'manual' }),
];

describe('prismBuildings', () => {
  it('without the laser scan: every building that is not removed', () => {
    expect(prismBuildings(buildings, false).map((x) => x.id)).toEqual(['imported', 'edited', 'manual']);
  });

  it('with the laser scan: only buildings it cannot know (manual, edited), never removed ones', () => {
    expect(prismBuildings(buildings, true).map((x) => x.id)).toEqual(['edited', 'manual']);
  });

  it('never the own building', () => {
    expect(prismBuildings(buildings, false, ['imported', 'manual']).map((x) => x.id)).toEqual(['edited']);
  });
});

describe('dsmMaskPolygons', () => {
  it('masks imported buildings that are removed or edited (their scan cells become ground)', () => {
    const masks = dsmMaskPolygons([...buildings, b('manualFlags', { source: 'manual', removed: true })]);
    expect(masks).toHaveLength(3);
    expect(masks[0]).toEqual(sq(0, 20, 10));
    expect(masks[0]).not.toBe(buildings[1]!.footprint);
  });
});

describe('own-building exclusion', () => {
  it('zone: behind the facade everywhere, balcony depth + 0.5 m within the own extent', () => {
    expect(OWN_BUILDING_EXCLUSION).toEqual({
      behindFacadeN: 0.5,
      balconyMarginN: 0.5,
      fallbackSideMarginM: 2,
      probeN: -0.5,
    });
    // Unknown footprint: ± (rowWidth / 2 + 2 m).
    const z = ownExclusionZone(1.5, 3.6);
    expect(z).toEqual({ behindN: 0.5, balconyN: 2, u0: -3.8, u1: 3.8 });
    expect(isOwnBuildingCell(50, 0.4, z)).toBe(true); // behind the facade plane: anywhere along it
    expect(isOwnBuildingCell(0, 1.9, z)).toBe(true); // own balcony
    expect(isOwnBuildingCell(3.8, 2, z)).toBe(true);
    expect(isOwnBuildingCell(4, 1, z)).toBe(false); // neighbour's balcony beyond the extent
    expect(isOwnBuildingCell(0, 2.1, z)).toBe(false); // in front of the balcony
    // Known footprint (facade frame): its extent along the facade.
    const own: [number, number][] = [
      [-6, 0],
      [9, 0],
      [9, -12],
      [-6, -12],
    ];
    expect(ownExclusionZone(1.2, 3.6, own)).toMatchObject({ u0: -6, u1: 9, balconyN: 1.7 });
  });

  it('own building = the stored footprints containing the point 0.5 m behind the facade origin', () => {
    const anchor = { latitude: 46.947849, longitude: 7.449978 };
    // Location 20 m south-east of the anchor, facade facing south (γ = 180°): "behind" is north.
    const location = enuToLonLat(anchor, 20, -20);
    const own = b('own', { footprint: sq(15, -20.2, 10) }); // facade line n = −20.2 + … contains (20, −19.5)
    const front = b('front', { footprint: sq(15, -40, 10) });
    const wing = b('wing', { footprint: sq(25.5, -25, 5) }); // next to the probe point, not containing it
    expect(ownBuildingIds([own, front, wing], anchor, location, 180)).toEqual(['own']);
    expect(ownBuildingIds([own], null, location, 180)).toEqual([]);
    // East facade (γ = 90°): behind is west.
    const west = b('west', { footprint: sq(10, -25, 9.8) });
    expect(ownBuildingIds([west, own], anchor, location, 90)).toEqual(['west', 'own']);
  });
});
