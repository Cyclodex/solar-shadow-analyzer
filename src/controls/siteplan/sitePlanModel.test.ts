import { describe, expect, it } from 'vitest';
import { facadeEdges } from '../../model/buildings';
import { facadeToEnu, lonLatToEnu } from '../../model/enu';
import type { Vertex } from '../../model/polygon';
import { ownBuildingIds } from '../../model/surroundings';
import type { Building } from '../../model/types';
import { angleDiff, toRad } from '../../model/units';
import {
  ALONG_INSET,
  alongRange,
  clampAlong,
  currentPlacement,
  fitView,
  FIT_MIN_SPAN,
  MAX_SPAN,
  MIN_SPAN,
  ownBuildingChoices,
  ownFacadeEdges,
  OWN_CHOICE_MAX,
  placementAt,
  placementConfig,
  placementPoint,
  probeAlongRange,
  probePoint,
  PROBE_MARGIN,
  samePlacement,
  scaleBarLength,
  sitePlanOwnBuilding,
  suggestedPlacement,
  zoomView,
} from './sitePlanModel';

const ANCHOR = { latitude: 46.958474, longitude: 7.45363 };

const b = (id: string, footprint: Vertex[], over: Partial<Building> = {}): Building => ({
  id,
  name: '',
  footprint,
  base: 0,
  height: 15,
  source: 'swisstopo',
  ...over,
});

const rect = (e0: number, n0: number, e1: number, n1: number): Vertex[] => [
  [e0, n0],
  [e1, n0],
  [e1, n1],
  [e0, n1],
];

/** Row houses: own (b1) between two neighbours (party walls east and west), one across the street. */
const ROW: Building[] = [
  b('b1', rect(-5, 0, 5, 12)),
  b('b2', rect(-15, 0, -5, 12)),
  b('b3', rect(5, 0, 15, 10)),
  b('b4', rect(-20, -40, 20, -25), { height: 20 }),
];

describe('sitePlanOwnBuilding', () => {
  it('prefers a chosen id, then the part behind the facade origin, the import, the address, the nearest', () => {
    // The address point (0, 6) lies in b1; facade south (180°): the probe behind (0, 0.5) too.
    expect(sitePlanOwnBuilding(ROW, [0, 6], 180)?.id).toBe('b1');
    expect(sitePlanOwnBuilding(ROW, [0, 6], 180, 'b3', 'b2')?.id).toBe('b2');
    // On b1's south wall facing south: the probe 0.5 m north lies in b1 even with another import id.
    expect(sitePlanOwnBuilding(ROW, [0, 0], 180, 'b3')?.id).toBe('b1');
    // Facing north from the same point: the probe (0, −0.5) is in the street; the import's own part wins.
    expect(sitePlanOwnBuilding(ROW, [0, 0], 0, 'b3')?.id).toBe('b3');
    // Without it, the part containing the location, else the nearest within 25 m.
    expect(sitePlanOwnBuilding(ROW, [-10, 5], 0)?.id).toBe('b2');
    expect(sitePlanOwnBuilding(ROW, [0, -8], 0)?.id).toBe('b1'); // 8 m from b1, 17 m from b4
    expect(sitePlanOwnBuilding(ROW, [0, -70], 0)).toBeNull();
  });

  it('picks or guesses only imported buildings; one entered by hand only with the probe inside (as the model)', () => {
    // Outside Switzerland: only a building entered by hand, 20 m in front of a south facade at the location.
    const manual = [b('b1', rect(-7.5, -30, 7.5, -20), { source: 'manual' })];
    expect(sitePlanOwnBuilding(manual, [0, 0], 180)).toBeNull();
    expect(sitePlanOwnBuilding(manual, [0, 0], 180, null, 'b1')).toBeNull(); // not even when chosen
    expect(sitePlanOwnBuilding(manual, [0, -19.7], 180)).toBeNull(); // 0.3 m from it, probe outside
    // With the probe behind the facade origin inside it, the prisms treat it as the own building: so does the plan.
    expect(sitePlanOwnBuilding(manual, [0, -20], 0)?.id).toBe('b1');
    // Next to imported buildings the nearest imported one is guessed, not the nearer manual one.
    const mixed = [...manual, b('b2', rect(-5, 10, 5, 20))];
    expect(sitePlanOwnBuilding(mixed, [0, -8], 0)?.id).toBe('b2'); // 12 m from the manual one, 18 m from b2
  });

  it('never picks a removed building', () => {
    const removed = ROW.map((x) => (x.id === 'b1' ? { ...x, removed: true } : x));
    expect(sitePlanOwnBuilding(removed, [0, 6], 180, 'b1', 'b1')?.id).not.toBe('b1');
  });

  it('probePoint is the point 0.5 m behind the facade origin', () => {
    const [e, n] = probePoint([10, 20], 90);
    expect(e).toBeCloseTo(9.5, 12);
    expect(n).toBeCloseTo(20, 12);
  });
});

describe('ownBuildingChoices', () => {
  it('imported buildings within 25 m of the location or adjoining the own one, nearest first', () => {
    const withManual = [...ROW, b('b5', rect(-2, -12, 2, -9), { source: 'manual' })];
    const at = (origin: Vertex | null, ownId: string | null) =>
      ownBuildingChoices(withManual, origin, withManual.find((x) => x.id === ownId) ?? null).map(
        (c) => c.building.id,
      );
    // From the street (0, −8): b1 8 m, b2 and b3 9.4 m, b4 17 m; b5 (by hand) never.
    expect(at([0, -8], 'b1')).toEqual(['b1', 'b2', 'b3', 'b4']);
    // Far away: the current own building and the parts adjoining it.
    expect(at([0, 200], 'b1')).toEqual(['b1', 'b2', 'b3']);
    expect(at(null, null)).toEqual([]);
    const choices = ownBuildingChoices(ROW, [0, -8], ROW[0]);
    expect(choices[0].bearing?.distance).toBeCloseTo(8, 9);
    expect(choices[3].bearing?.azimuth).toBeCloseTo(180, 0);
  });

  it('at most OWN_CHOICE_MAX, always with the current own building', () => {
    const many = Array.from({ length: 30 }, (_, k) => b(`b${k + 1}`, rect(k * 0.7, 0, k * 0.7 + 0.5, 5)));
    const own = many[29];
    const ids = ownBuildingChoices(many, [0, -1], own).map((c) => c.building.id);
    expect(ids).toHaveLength(OWN_CHOICE_MAX + 1);
    expect(ids).toContain('b30');
  });
});

describe('placements', () => {
  const edges = ownFacadeEdges(ROW[0], ROW);
  const south = edges.find((e) => e.azimuth === 180)!;
  const north = edges.find((e) => e.azimuth === 0)!;

  it('ownFacadeEdges: party walls with the neighbours, removed neighbours do not count', () => {
    expect(edges.filter((e) => e.selectable).map((e) => e.azimuth)).toEqual([180, 0]);
    expect(edges.filter((e) => e.party).map((e) => e.azimuth)).toEqual([90, 270]);
    const withoutWest = ROW.map((x) => (x.id === 'b2' ? { ...x, removed: true } : x));
    expect(
      ownFacadeEdges(ROW[0], withoutWest)
        .filter((e) => e.selectable)
        .map((e) => e.azimuth),
    ).toEqual([180, 0, 270]);
    // b3 is 2 m shorter than b1: the east wall adjoins it on 10 of 12 m (a party wall).
    expect(edges.find((e) => e.azimuth === 90)!.shared).toBeCloseTo(10 / 12, 1);
  });

  it('currentPlacement: on a selectable edge with the facade azimuth (whole degrees)', () => {
    const p = currentPlacement(edges, [1.5, 0.04], 180);
    expect(p?.edge.index).toBe(south.index);
    // Edge a → b runs along +u (east for a south facade): 6.5 m from the west corner.
    expect(p?.along).toBeCloseTo(6.5, 9);
    expect(currentPlacement(edges, [1.5, 0.04], 181)).toBeNull(); // the azimuth does not match
    expect(currentPlacement(edges, [1.5, 0.5], 180)).toBeNull(); // not on the wall
    expect(currentPlacement(edges, [5, 6], 90)).toBeNull(); // a party wall
  });

  it('suggestedPlacement: the edge facing closest to the configured azimuth, at the projection', () => {
    const p = suggestedPlacement(edges, [2, 6], 200)!;
    expect(p.edge.azimuth).toBe(180);
    expect(p.along).toBeCloseTo(7, 9);
    expect(suggestedPlacement(edges, [2, 6], 20)!.edge.azimuth).toBe(0);
    // The projection beyond an end: the middle of the edge.
    expect(suggestedPlacement(edges, [30, 6], 180)!.along).toBe(5);
    expect(suggestedPlacement([], [0, 0], 180)).toBeNull();
  });

  it('alongRange / clampAlong keep the balcony 0.5 m from the ends, on the 0.1 m grid', () => {
    expect(alongRange(south)).toEqual({ min: ALONG_INSET, max: 9.5 });
    expect(clampAlong(south, 0)).toBe(0.5);
    expect(clampAlong(south, 3.04)).toBe(3);
    expect(clampAlong(south, 3.06)).toBe(3.1);
    expect(clampAlong(south, 12)).toBe(9.5);
    expect(alongRange({ length: 0.6 })).toEqual({ min: 0.3, max: 0.3 });
    const odd = { length: 7.37 };
    expect(alongRange(odd)).toEqual({ min: 0.5, max: 6.8 });
    // Exact grid values (no 0.30000000000000004).
    expect(clampAlong(south, 0.3 + 3 * 0.1)).toBe(0.6);
  });

  it('acute corners: the range keeps the probe inside the own footprint, so the model finds it', () => {
    // Wedge with a 21.8° corner at (20, 0): its north facade runs from (20, 0) to (0, 0).
    const wedge = b('b1', [
      [0, 0],
      [0, -8],
      [20, 0],
    ]);
    const facade = ownFacadeEdges(wedge, [wedge]).find((e) => e.azimuth === 0)!;
    expect(facade.range).toBeDefined();
    const range = alongRange(facade);
    // 0.5 m from the right-angled corner; at the acute one (0.1 + 0.5 cos α) / sin α = 1.52 m, on the grid.
    expect(range.min).toBe(1.6);
    expect(range.max).toBe(19.5);
    expect(probeAlongRange(facade, wedge.footprint)).toEqual(range);
    const anchor = { ...ANCHOR, radius: 300, date: '2026-09-25' };
    const owns = (along: number): string[] => {
      const next = placementConfig(ANCHOR, { edge: facade, along });
      return ownBuildingIds([wedge], anchor, next, next.facadeAzimuth);
    };
    // Without the range (0.5 m from both ends) the probe fell outside next to the acute corner.
    expect(owns(0.5)).toEqual([]);
    for (let along = range.min; along <= range.max + 1e-9; along += 0.1) expect(owns(along)).toEqual(['b1']);
    expect(clampAlong(facade, 0)).toBe(1.6);
    expect(placementAt(facade, [19.9, 0]).along).toBe(1.6);
    expect(PROBE_MARGIN).toBeGreaterThan(0.07); // the rounding of «Übernehmen»
  });

  it('a sliver without any position whose probe fits: the middle of the edge', () => {
    const sliver = b('b1', rect(0, 0, 10, 0.4));
    const south = ownFacadeEdges(sliver, [sliver]).find((e) => e.azimuth === 180)!;
    expect(alongRange(south)).toEqual({ min: 5, max: 5 });
  });

  it('placementAt projects a point onto the edge; samePlacement compares edge and position', () => {
    const p = placementAt(north, [0, 30]);
    expect(p.edge).toBe(north);
    expect(placementPoint(p)[0]).toBeCloseTo(0, 9);
    expect(placementPoint(p)[1]).toBeCloseTo(12, 9);
    expect(samePlacement(p, { edge: north, along: p.along + 0.04 })).toBe(true);
    expect(samePlacement(p, { edge: north, along: p.along + 0.1 })).toBe(false);
    expect(samePlacement(p, { edge: south, along: p.along })).toBe(false);
    expect(samePlacement(null, null)).toBe(true);
    expect(samePlacement(p, null)).toBe(false);
  });
});

describe('placementConfig', () => {
  it('rounds to 1e-6° and whole degrees, and the result is found again as the placement', () => {
    // A rotated block: its south-east facade faces 153.4°.
    const g = toRad(153.4);
    const n: Vertex = [Math.sin(g), Math.cos(g)];
    const u: Vertex = [-Math.cos(g), Math.sin(g)];
    const at = (du: number, dn: number): Vertex => [
      Math.round((40 + du * u[0] + dn * n[0]) * 10) / 10,
      Math.round((-20 + du * u[1] + dn * n[1]) * 10) / 10,
    ];
    const own = b('b1', [at(-9, 0), at(9, 0), at(9, -14), at(-9, -14)]);
    const neighbour = b('b2', [at(9, 0), at(20, 0), at(20, -14), at(9, -14)]);
    const buildings = [own, neighbour];
    const edges = ownFacadeEdges(own, buildings);
    const facade = edges.find((e) => Math.abs(angleDiff(e.azimuth, 153.4)) < 1)!;
    expect(facade.selectable).toBe(true);
    for (const along of [alongRange(facade).min, 6.3, alongRange(facade).max]) {
      const placed = { edge: facade, along };
      const next = placementConfig(ANCHOR, placed);
      expect(next.facadeAzimuth).toBe(153);
      expect(Math.round(next.latitude * 1e6) / 1e6).toBe(next.latitude);
      expect(Math.round(next.longitude * 1e6) / 1e6).toBe(next.longitude);
      const origin = lonLatToEnu(ANCHOR, next.latitude, next.longitude);
      const back = placementPoint(placed);
      // Rounding to 1e-6° moves the point by at most 0.07 m.
      expect(Math.hypot(origin[0] - back[0], origin[1] - back[1])).toBeLessThan(0.07);
      // The plan finds it again, and the model's own-building rule (probe behind the origin) agrees.
      const again = currentPlacement(edges, origin, next.facadeAzimuth);
      expect(again?.edge.index).toBe(facade.index);
      expect(Math.abs(again!.along - along)).toBeLessThan(0.07);
      expect(sitePlanOwnBuilding(buildings, origin, next.facadeAzimuth)?.id).toBe('b1');
      const anchor = { ...ANCHOR, radius: 300, date: '2026-09-25' };
      expect(
        ownBuildingIds(
          buildings,
          anchor,
          { latitude: next.latitude, longitude: next.longitude },
          next.facadeAzimuth,
        ),
      ).toEqual(['b1']);
    }
  });

  it('wraps an azimuth that rounds to 360° to 0°', () => {
    const edges = facadeEdges([
      [0, 0],
      [10, 0.05],
      [10, 8],
      [0, 8],
    ]);
    const top = edges.find((e) => e.azimuth > 355 || e.azimuth < 5)!;
    expect(placementConfig(ANCHOR, { edge: top, along: 5 }).facadeAzimuth).toBe(0);
  });

  it('keeps the balcony on the facade line: the facade frame origin is the balcony point', () => {
    const edge = facadeEdges(rect(0, 0, 10, 8)).find((e) => e.azimuth === 180)!;
    const next = placementConfig(ANCHOR, { edge, along: 4 });
    const origin = lonLatToEnu(ANCHOR, next.latitude, next.longitude);
    const [ue, un] = facadeToEnu([1, 0], next.facadeAzimuth);
    expect(origin[1]).toBeCloseTo(0, 1);
    // The facade's u axis runs along the edge (east for a south facade).
    expect(ue).toBeCloseTo(1, 12);
    expect(un).toBeCloseTo(0, 12);
  });
});

describe('map view', () => {
  it('fitView centres on the own footprint, at least FIT_MIN_SPAN wide, 2.2 × its extent', () => {
    const v = fitView(rect(0, 0, 10, 12), [], 0.8);
    expect(v.cx).toBe(5);
    expect(v.cy).toBe(6);
    expect(v.span).toBe(FIT_MIN_SPAN);
    const big = fitView(rect(0, 0, 60, 20), [[0, -10]], 0.8);
    expect(big.span).toBeCloseTo(60 * 2.2, 9);
    // A tall footprint: its height / aspect sets the width.
    expect(fitView(rect(0, 0, 10, 40), [], 0.5).span).toBeCloseTo((40 / 0.5) * 2.2, 9);
    expect(fitView(null, [], 1)).toEqual({ cx: 0, cy: 0, span: FIT_MIN_SPAN * 2 });
  });

  it('zoomView keeps the focus point in place and clamps the width', () => {
    const v = { cx: 0, cy: 0, span: 100 };
    const z = zoomView(v, 2, [20, 10]);
    expect(z.span).toBe(50);
    // The focus stays at the same relative position: (20 − cx) / span unchanged.
    expect((20 - z.cx) / z.span).toBeCloseTo((20 - v.cx) / v.span, 12);
    expect((10 - z.cy) / z.span).toBeCloseTo((10 - v.cy) / v.span, 12);
    expect(zoomView(v, 1000).span).toBe(MIN_SPAN);
    expect(zoomView(v, 0.001).span).toBe(MAX_SPAN);
  });

  it('scaleBarLength: 1, 2 or 5 × 10^k m', () => {
    expect(scaleBarLength(14)).toBe(10);
    expect(scaleBarLength(33)).toBe(20);
    expect(scaleBarLength(70)).toBe(50);
    expect(scaleBarLength(0.9)).toBe(0.5);
    expect(scaleBarLength(0)).toBe(0);
  });
});
