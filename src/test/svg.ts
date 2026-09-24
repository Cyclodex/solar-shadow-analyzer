import { expect } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import type { Config } from '../model/types';
import { useConfigStore } from '../state/configStore';

// ─────────────────────────────────────────────
// TEST HELPERS FOR THE SVG VIEWS (tests of src/views only)
// ─────────────────────────────────────────────

type Patch = { [K in Exclude<keyof Config, 'version'>]?: Partial<Config[K]> };

/** Replaces the config with DEFAULT_CONFIG merged with `patch` (sanitised by the store). */
export function setConfig(patch: Patch): void {
  const base: Config = structuredClone(DEFAULT_CONFIG);
  const next = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    next[k] = { ...(base[k as keyof Patch] as object), ...(v as object) };
  }
  useConfigStore.getState().replace(next as unknown as Config);
}

/** Configs at the LIMITS extremes that every view must draw inside its viewBox. */
export const EXTREME_CASES: { name: string; patch: Patch }[] = [
  { name: 'default', patch: {} },
  {
    name: '8 floors × 8 modules, maximum sizes',
    patch: {
      building: { numFloors: 8, floorHeight: 500, balconyDepth: 400, railingHeight: 150, lowestFloor: 40 },
      panels: { count: 8, width: 250, length: 250, gap: 30 },
    },
  },
  {
    name: '8 floors × 8 modules, tilt 0 (vertical, overlapping)',
    patch: {
      building: { numFloors: 8, floorHeight: 200, lowestFloor: 0 },
      panels: { count: 8, width: 250, length: 250, tiltFromVertical: 0 },
    },
  },
  {
    name: '8 floors × 8 modules, tilt 90 (flat)',
    patch: {
      building: { numFloors: 8 },
      panels: { count: 8, width: 250, tiltFromVertical: 90 },
    },
  },
  {
    name: 'minimum sizes, single floor on the ground',
    patch: {
      building: { numFloors: 1, floorHeight: 200, balconyDepth: 0, railingHeight: 50, lowestFloor: 0 },
      panels: { count: 1, width: 30, length: 30, gap: 0 },
    },
  },
  {
    name: 'portrait modules, south facade, southern hemisphere',
    patch: {
      location: { latitude: -33.9, longitude: 18.4, timezone: 'Africa/Johannesburg' },
      building: { facadeAzimuth: 0, numFloors: 3 },
      panels: { width: 60, length: 180, count: 3 },
    },
  },
  {
    name: 'polar day',
    patch: { location: { latitude: 78.2, longitude: 15.6, timezone: 'Arctic/Longyearbyen' } },
  },
];

/** A tall obstacle right in front of the facade (blocks the sun for every floor). */
export const WALL_OBSTACLE = {
  id: 'wall',
  name: 'Wand',
  offsetAlong: 0,
  distance: 3,
  width: 300,
  depth: 5,
  height: 250,
};

/** The view's figure (role="img" SVG). */
export function figureOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector('svg[role="img"]');
  if (!(svg instanceof SVGSVGElement)) throw new Error('No figure SVG rendered');
  return svg;
}

const COORD_ATTRS: readonly [string, 'x' | 'y'][] = [
  ['x', 'x'],
  ['x1', 'x'],
  ['x2', 'x'],
  ['cx', 'x'],
  ['y', 'y'],
  ['y1', 'y'],
  ['y2', 'y'],
  ['cy', 'y'],
];

/** End points of a path made of M/L/H/V/h/v/A/Z commands (absolute M/L/A, relative h/v as in rectD). */
export function pathPoints(d: string): [number, number][] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const pts: [number, number][] = [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const num = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case 'M':
        x = num();
        y = num();
        sx = x;
        sy = y;
        break;
      case 'L':
        x = num();
        y = num();
        break;
      case 'H':
        x = num();
        break;
      case 'V':
        y = num();
        break;
      case 'h':
        x += num();
        break;
      case 'v':
        y += num();
        break;
      case 'A':
        i += 5;
        x = num();
        y = num();
        break;
      case 'Z':
      case 'z':
        x = sx;
        y = sy;
        continue;
      default:
        throw new Error(`Unsupported path command "${cmd}" in ${d}`);
    }
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Asserts that the serialised figure has no NaN/Infinity/undefined and that every drawn coordinate
 * (x/y attributes, circle extents, path points) lies inside the viewBox (± `tol` px).
 * Pattern tiles (<pattern>, pattern space) are skipped.
 */
export function expectSaneSvg(svg: SVGSVGElement, tol = 1): void {
  const html = svg.outerHTML;
  expect(html).not.toMatch(/NaN|Infinity|undefined/);
  const vb = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  expect(vb).toHaveLength(4);
  const [, , W, H] = vb;
  expect(W).toBeGreaterThan(0);
  expect(H).toBeGreaterThan(0);
  const inside = (v: number, axis: 'x' | 'y', what: string): void => {
    const max = axis === 'x' ? W : H;
    if (!(v >= -tol && v <= max + tol)) throw new Error(`${what}: ${axis} = ${v} outside 0…${max}`);
  };
  for (const el of Array.from(svg.querySelectorAll('*'))) {
    if (el.closest('pattern')) continue;
    const tag = el.tagName.toLowerCase();
    for (const [attr, axis] of COORD_ATTRS) {
      const raw = el.getAttribute(attr);
      if (raw === null || tag === 'tspan' || tag === 'lineargradient') continue;
      inside(Number(raw), axis, `<${tag} ${attr}>`);
    }
    if (tag === 'circle') {
      const cx = Number(el.getAttribute('cx'));
      const cy = Number(el.getAttribute('cy'));
      const r = Number(el.getAttribute('r'));
      inside(cx - r, 'x', '<circle> left');
      inside(cx + r, 'x', '<circle> right');
      inside(cy - r, 'y', '<circle> top');
      inside(cy + r, 'y', '<circle> bottom');
    }
    if (tag === 'path') {
      for (const [px, py] of pathPoints(el.getAttribute('d') ?? '')) {
        inside(px, 'x', '<path>');
        inside(py, 'y', '<path>');
      }
    }
  }
}

/** All ids in the document must be unique (several views, several instances). */
export function expectUniqueIds(root: ParentNode = document): void {
  const ids = Array.from(root.querySelectorAll('[id]')).map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
}

/** Text content of all <text> elements of the figure. */
export function svgTexts(svg: SVGSVGElement): string[] {
  return Array.from(svg.querySelectorAll('text')).map((t) => t.textContent ?? '');
}
