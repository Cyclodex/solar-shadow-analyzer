import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { panelLayout } from '../model/geometry';
import { useConfigStore } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { ProfileView } from './ProfileView';
import {
  EXTREME_CASES,
  WALL_OBSTACLE,
  expectSaneSvg,
  expectUniqueIds,
  figureOf,
  pathPoints,
  setConfig,
  svgTexts,
} from '../test/svg';

const allText = (container: HTMLElement): string => svgTexts(figureOf(container)).join(' | ');

describe('ProfileView', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the section with dimensions and angles for the default config', () => {
    const { container } = render(<ProfileView />);
    const svg = figureOf(container);
    expect(screen.getByRole('img', { name: /Seitenansicht um 12:00/ })).toBe(svg);
    const text = allText(container);
    expect(text).toMatch(/Stockwerkhöhe 280\scm/);
    expect(text).toMatch(/Freiraum 200\scm/);
    expect(text).toMatch(/Ausladung 80\scm/);
    expect(text).toMatch(/θ 45°/);
    expect(text).toMatch(/β 45°/);
    // Critical angle from the model (2D onset): atan2(H − L cos θ, L sin θ).
    const critical = panelLayout(useConfigStore.getState().config).criticalProfileAngle;
    expect(text).toContain(`kritisch ${critical.toFixed(1)}°`);
    expect(svg).toHaveAccessibleDescription(/Neigung θ 45° ab Senkrechte \(β 45° ab Horizontal\)/);
    expect(svg).toHaveAccessibleDescription(
      /Stockwerkhöhe 280\scm, Freiraum zur Reihe darunter 200\scm, Ausladung 80\scm\./,
    );
    expectSaneSvg(svg);
  });

  it('labels θ from vertical and β = 90° − θ from horizontal (θ = 30°, where they differ)', () => {
    setConfig({ panels: { tiltFromVertical: 30 } });
    const { container } = render(<ProfileView />);
    const texts = svgTexts(figureOf(container));
    expect(texts).toContain('θ 30°');
    expect(texts).toContain('β 60°');
    expect(figureOf(container)).toHaveAccessibleDescription(
      /Neigung θ 30° ab Senkrechte \(β 60° ab Horizontal\)/,
    );
  });

  it.each(EXTREME_CASES)('stays inside the viewBox: $name', ({ patch }) => {
    setConfig(patch);
    const { container } = render(<ProfileView />);
    expectSaneSvg(figureOf(container));
  });

  it.each([0, 360, 720, 1080, 1260])('keeps the sun ray on the canvas at minute %i', (minutes) => {
    useTimeStore.setState({ minutes });
    for (const tilt of [0, 30, 90]) {
      setConfig({ panels: { tiltFromVertical: tilt } });
      const { container, unmount } = render(<ProfileView />);
      expectSaneSvg(figureOf(container));
      unmount();
    }
  });

  it('shows the exact shaded share from the 3D model', () => {
    setConfig({ building: { floorHeight: 220 }, panels: { length: 170, tiltFromVertical: 60 } });
    useTimeStore.setState({ minutes: 750 });
    const { container } = render(<ProfileView />);
    expect(allText(container)).toMatch(/1\. OG: \d+\s% der Fläche verschattet \(exaktes 3D-Modell\)/);
  });

  it('explains when the profile angle exceeds the critical angle but the shadow misses the row', () => {
    // Narrow row, low sun far to the side: 2D test says "shaded", the 3D model does not.
    setConfig({
      building: { floorHeight: 220 },
      panels: { length: 170, tiltFromVertical: 60, count: 1, width: 40 },
    });
    useTimeStore.setState({ minutes: 17 * 60 + 30 });
    const { container } = render(<ProfileView />);
    expect(figureOf(container)).toHaveAccessibleDescription(/fällt aber seitlich neben die Reihe/);
  });

  it('draws only the panel of a single floor, without critical ray or shade', () => {
    setConfig({ building: { numFloors: 1 } });
    const { container } = render(<ProfileView />);
    const text = allText(container);
    expect(text).toMatch(/Nur ein Stockwerk/);
    expect(text).not.toMatch(/kritisch/);
    expect(text).not.toMatch(/Freiraum/);
  });

  it.each([
    { name: 'tall floors', patch: { building: { floorHeight: 500 } } },
    { name: '4 floors', patch: { building: { numFloors: 4 } } },
    { name: 'single floor', patch: { building: { numFloors: 1 } } },
  ])('keeps the dimension labels clear of the status text and floor labels: $name', ({ patch }) => {
    setConfig(patch);
    const { container } = render(<ProfileView />);
    const texts = Array.from(figureOf(container).querySelectorAll('text'));
    const find = (re: RegExp): SVGTextElement => {
      const el = texts.find((t) => re.test(t.textContent ?? ''));
      if (!el) throw new Error(`no text ${re}`);
      return el;
    };
    const y = (el: Element): number => Number(el.getAttribute('y'));
    const reach = find(/^(Ausladung )?80\scm$/);
    const status = find(/Profilwinkel/);
    // Reach baseline + descent + gap + the status line's cap height.
    expect(y(status) - y(reach)).toBeGreaterThanOrEqual(16);
    if (patch.building.numFloors === 1) return;
    // The rotated floor-height label (glyphs up to ~9 px left of its baseline) stays clear of the floor labels.
    const height = find(/^(Stockwerkhöhe )?(280|500)\scm$/);
    const floorLabelRight = Math.max(
      ...texts.filter((t) => /\. OG$/.test(t.textContent ?? '')).map((t) => Number(t.getAttribute('x'))),
    );
    expect(Number(height.getAttribute('x')) - 13).toBeGreaterThanOrEqual(floorLabelRight - 0.01);
  });

  it('warns when ground-floor panels would reach into the ground', () => {
    setConfig({ building: { lowestFloor: 0 }, panels: { width: 113.4, length: 176.2 } });
    render(<ProfileView />);
    expect(screen.getByRole('note')).toHaveTextContent(
      /untersten Reihe \(EG\) reichen 25\scm unter das Terrain/,
    );
  });

  it('ends the sun ray on the balcony floor instead of drawing it through the slab', () => {
    // 21 June 15:00: the ray passes above the lower row (profile angle below the critical angle).
    useTimeStore.setState({ minutes: 15 * 60 });
    const { container } = render(<ProfileView />);
    const paths = Array.from(figureOf(container).querySelectorAll('path'));
    const byClass = (name: string): SVGPathElement | undefined =>
      paths.find((p) => new RegExp(`(^|\\s)_${name}_`).test(p.getAttribute('class') ?? ''));
    const [to] = pathPoints(byClass('ray')?.getAttribute('d') ?? '');
    // Slab rectangles: M x y h w v h h −w Z → top-left, top-right, bottom-right, bottom-left.
    const slabPts = pathPoints(byClass('slab')?.getAttribute('d') ?? '');
    expect(slabPts.length).toBe(12);
    const onSlabTop = [];
    for (let i = 0; i < slabPts.length; i += 4) {
      const [[x0, top], [x1]] = slabPts.slice(i, i + 2);
      if (Math.abs(to[1] - top) < 0.05 && to[0] > x0 && to[0] < x1) onSlabTop.push(i);
    }
    expect(onSlabTop).toHaveLength(1);
  });

  it('draws the critical-angle label above the sun ray, with a halo', () => {
    // 24 Sept, 12:00 (default facade): the ray at 51° crosses the "kritisch 68.1°" label.
    useTimeStore.setState({ date: '2026-09-24', minutes: 12 * 60 });
    const { container } = render(<ProfileView />);
    const svg = figureOf(container);
    const ray = Array.from(svg.querySelectorAll('path')).find((p) =>
      /(^|\s)_ray_/.test(p.getAttribute('class') ?? ''),
    );
    const label = Array.from(svg.querySelectorAll('text')).find((el) =>
      /^kritisch \d/.test(el.textContent ?? ''),
    );
    expect(ray).toBeDefined();
    expect(label).toBeDefined();
    expect(label?.getAttribute('class')).toMatch(/(^|\s)_halo_/);
    // Later in the document = painted on top.
    expect(ray!.compareDocumentPosition(label!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(svgTexts(svg).filter((tx) => /^kritisch/.test(tx))).toHaveLength(1);
  });

  it('shows at least the analysed pair of floors and names it when not all fit', () => {
    setConfig({ building: { numFloors: 8, floorHeight: 500 } });
    useUiStore.getState().setFocusFloor(3);
    const { container } = render(<ProfileView />);
    const text = allText(container);
    expect(text).toMatch(/Gezeigt: 4\. OG und 5\. OG/);
    expect(text).toContain('4. OG');
    expect(text).toContain('5. OG');
    expect(text).not.toContain('8. OG');
  });

  it('marks overlapping rows instead of a negative gap', () => {
    setConfig({ building: { floorHeight: 200 }, panels: { length: 250, tiltFromVertical: 20 } });
    const { container } = render(<ProfileView />);
    expect(screen.getByRole('note')).toHaveTextContent(/überlappen sich um 35 cm/);
    const text = allText(container);
    expect(text).toMatch(/Überlappung 35\scm/);
    expect(text).not.toMatch(/Freiraum\s−/);
    expect(text).not.toMatch(/kritisch/);
  });

  it('reports night, sun behind the facade and a blocked horizon', () => {
    useTimeStore.setState({ minutes: 0 });
    const night = render(<ProfileView />);
    expect(allText(night.container)).toMatch(/Sonne unter dem Horizont/);
    night.unmount();

    useTimeStore.setState({ minutes: 720 });
    setConfig({ building: { facadeAzimuth: 0 } });
    const behind = render(<ProfileView />);
    expect(allText(behind.container)).toMatch(/Sonne hinter der Fassade/);
    behind.unmount();

    setConfig({ horizon: { terrainEnabled: false, obstacles: [WALL_OBSTACLE], manual: [] } });
    const blocked = render(<ProfileView />);
    expect(allText(blocked.container)).toMatch(/1\. OG: Sonne hinter Gelände\/Hindernis/);
  });

  it('uses unique ids and renders in English', () => {
    useUiStore.getState().setLang('en');
    const { container } = render(
      <>
        <ProfileView />
        <ProfileView />
      </>,
    );
    expectUniqueIds(container);
    expect(screen.getAllByRole('img', { name: /Side view at 12:00/ })).toHaveLength(2);
    const text = allText(container);
    expect(text).toMatch(/Floor-to-floor height 280\scm/);
    expect(text).toMatch(/Clearance 200\scm/);
    expect(screen.getAllByRole('img', { name: /Side view/ })[0]).toHaveAccessibleDescription(
      /floor-to-floor height 280\scm, clearance to the row below 200\scm, reach 80\scm\./,
    );
  });
});
