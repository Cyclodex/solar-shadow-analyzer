import { describe, expect, it } from 'vitest';
import {
  boxDistance,
  boxHitsCircle,
  boxesOverlap,
  clampLabelX,
  clipPolyline,
  clipSegment,
  fitUniform,
  labelBox,
  pathD,
  px,
  rayExit,
  raySegment,
  rectD,
  segmentHitsBox,
  shiftBox,
  textWidth,
  wrapText,
  type Box,
} from './geometry2d';
import { pathPoints } from './testUtils';

const box: Box = { x0: 0, y0: 0, x1: 100, y1: 50 };

describe('geometry2d', () => {
  it('rounds coordinates without producing −0', () => {
    expect(px(1.23456)).toBe(1.23);
    expect(Object.is(px(-0.001), 0)).toBe(true);
    expect(pathD([])).toBe('');
    expect(
      pathD(
        [
          { x: 1, y: 2 },
          { x: 3.333, y: 4 },
        ],
        true,
      ),
    ).toBe('M1 2L3.33 4Z');
    expect(pathPoints(rectD(10, 20, 30, 40))).toEqual([
      [10, 20],
      [40, 20],
      [40, 60],
      [10, 60],
    ]);
  });

  it('clips segments to a box', () => {
    expect(clipSegment({ x: 10, y: 10 }, { x: 20, y: 20 }, box)).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);
    const c = clipSegment({ x: -50, y: 25 }, { x: 150, y: 25 }, box);
    expect(c).toEqual([
      { x: 0, y: 25 },
      { x: 100, y: 25 },
    ]);
    expect(clipSegment({ x: -10, y: -10 }, { x: -5, y: 80 }, box)).toBeNull();
  });

  it('splits polylines at the box edge and where requested', () => {
    const pts = [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 150, y: 10 },
      { x: 150, y: 20 },
      { x: 90, y: 20 },
      { x: 80, y: 20 },
    ];
    const pieces = clipPolyline(pts, box);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toEqual([
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 100, y: 10 },
    ]);
    expect(pieces[1][0]).toEqual({ x: 100, y: 20 });
    const broken = clipPolyline(
      [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 90, y: 10 },
        { x: 95, y: 10 },
      ],
      box,
      (a, b) => Math.abs(a.x - b.x) > 50,
    );
    expect(broken).toHaveLength(2);
  });

  it('finds ray exits and ray–segment hits', () => {
    expect(rayExit({ x: 50, y: 25 }, { x: 1, y: -1 }, box)).toEqual({ x: 75, y: 0 });
    expect(rayExit({ x: 50, y: 25 }, { x: 0, y: 0 }, box)).toBeNull();
    const hit = raySegment({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: -5 }, { x: 10, y: 5 });
    expect(hit?.t).toBeCloseTo(10);
    expect(hit?.s).toBeCloseTo(0.5);
    expect(raySegment({ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 10, y: -5 }, { x: 10, y: 5 })).toBeNull();
  });

  it('fits a world extent with one scale for both axes (y up)', () => {
    const fit = fitUniform({ x0: 0, x1: 10, y0: 0, y1: 2 }, { x0: 0, y0: 0, x1: 200, y1: 200 }, 0.5, 0);
    expect(fit.k).toBe(20);
    expect(fit.x(0)).toBe(0);
    expect(fit.y(2)).toBe(0);
    expect(fit.y(0)).toBe(40);
    const tall = fitUniform({ x0: 0, x1: 1, y0: 0, y1: 10 }, { x0: 0, y0: 0, x1: 200, y1: 100 }, 0.5, 0);
    expect(tall.k).toBe(10);
    expect(tall.x(0)).toBe(95); // centred horizontally
  });

  it('wraps and places labels within the available width', () => {
    const lines = wrapText('eins zwei drei vier fünf sechs sieben', 60, 11);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 11)).toBeLessThanOrEqual(60 + textWidth('sieben', 11));
    expect(wrapText('', 60, 11)).toEqual(['']);
    expect(clampLabelX(2, 40, 'middle', 0, 100)).toBe(20);
    expect(clampLabelX(99, 40, 'start', 0, 100)).toBe(60);
    expect(clampLabelX(50, 40, 'end', 0, 100)).toBe(50);
  });

  it('estimates label boxes and tests them against boxes, segments and circles', () => {
    expect(labelBox(50, 20, 30, 'middle', 10)).toEqual({ x0: 35, y0: 11, x1: 65, y1: 22.5 });
    expect(labelBox(50, 20, 30, 'end', 10).x0).toBe(20);
    const a: Box = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(boxesOverlap(a, shiftBox(a, 9, 9))).toBe(true);
    expect(boxesOverlap(a, shiftBox(a, 10, 0))).toBe(false); // touching edges
    expect(boxDistance(a, shiftBox(a, 13, 14))).toBeCloseTo(5);
    expect(boxDistance(a, shiftBox(a, 8, 0))).toBe(-2); // penetration depth
    expect(
      segmentHitsBox(
        [
          { x: -5, y: 5 },
          { x: 15, y: 5 },
        ],
        a,
      ),
    ).toBe(true);
    expect(
      segmentHitsBox(
        [
          { x: -5, y: 15 },
          { x: 15, y: 15 },
        ],
        a,
      ),
    ).toBe(false);
    expect(boxHitsCircle(a, { x: 13, y: 5 }, 4)).toBe(true);
    expect(boxHitsCircle(a, { x: 13, y: 13 }, 4)).toBe(false); // corner 4.24 px away
  });
});
