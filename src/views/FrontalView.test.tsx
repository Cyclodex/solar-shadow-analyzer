import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { FrontalView } from './FrontalView';
import {
  EXTREME_CASES,
  WALL_OBSTACLE,
  expectSaneSvg,
  expectUniqueIds,
  figureOf,
  setConfig,
  svgTexts,
} from '../test/svg';

describe('FrontalView', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders an accessible figure for the default config', () => {
    const { container } = render(<FrontalView />);
    expect(screen.getByRole('heading', { name: 'Frontalansicht' })).toBeInTheDocument();
    const svg = figureOf(container);
    expect(screen.getByRole('img', { name: /Frontalansicht am 21\. Juni 2025 um 12:00/ })).toBe(svg);
    expect(svg).toHaveAccessibleDescription(/Fassade 202° SSW: 2 Stockwerke, je 2 Module\./);
    expect(svg).toHaveAccessibleDescription(/2\. OG .*; 1\. OG /);
    expectSaneSvg(svg);
  });

  it.each(EXTREME_CASES)('stays inside the viewBox: $name', ({ patch }) => {
    setConfig(patch);
    const { container } = render(<FrontalView />);
    expectSaneSvg(figureOf(container));
  });

  it('labels the floors bottom-up with their storey names', () => {
    setConfig({ building: { numFloors: 3, lowestFloor: 0 } });
    const { container } = render(<FrontalView />);
    const svg = figureOf(container);
    const y = (label: string): number => {
      const el = Array.from(svg.querySelectorAll('text')).find((t) => t.textContent === label);
      if (!el) throw new Error(`label ${label} missing`);
      return Number(el.getAttribute('y'));
    };
    expect(y('EG')).toBeGreaterThan(y('1. OG'));
    expect(y('1. OG')).toBeGreaterThan(y('2. OG'));
  });

  it('computes the compass labels from the facade azimuth', () => {
    setConfig({ building: { facadeAzimuth: 90 } });
    const { container } = render(<FrontalView />);
    const svg = figureOf(container);
    const texts = svgTexts(svg);
    expect(texts).toContain('O 90°');
    expect(texts).toEqual(expect.arrayContaining(['N', 'S', 'NO', 'SO']));
    expect(texts.join(' ')).not.toMatch(/von Süden/);
    // Looking at an east facade from outside (facing west), north is on the right, south on the left.
    const x = (label: string): number =>
      Number(
        Array.from(svg.querySelectorAll('text'))
          .find((t) => t.textContent === label)
          ?.getAttribute('x'),
      );
    expect(x('N')).toBeGreaterThan(x('O 90°'));
    expect(x('S')).toBeLessThan(x('O 90°'));
  });

  it('draws the exact shade of the row above and its percentage', () => {
    setConfig({ building: { floorHeight: 220 }, panels: { length: 170, tiltFromVertical: 60 } });
    useTimeStore.setState({ minutes: 750 });
    const { container } = render(<FrontalView />);
    const svg = figureOf(container);
    const texts = svgTexts(svg);
    // Lower floor partially shaded, top floor never shaded by panels.
    expect(texts.some((t) => /^[1-9]\d*\s%$/.test(t))).toBe(true);
    expect(svg).toHaveAccessibleDescription(/1\. OG \d+\s% verschattet/);
    expect(svg).toHaveAccessibleDescription(/2\. OG unverschattet \(keine Panels darüber\)/);
  });

  it('reports night and the sun behind the facade', () => {
    useTimeStore.setState({ minutes: 0 });
    const { container, unmount } = render(<FrontalView />);
    expect(svgTexts(figureOf(container)).join(' ')).toMatch(/Sonne unter dem Horizont/);
    unmount();

    setConfig({ building: { facadeAzimuth: 0 } });
    useTimeStore.setState({ minutes: 720 });
    const second = render(<FrontalView />);
    expect(svgTexts(figureOf(second.container)).join(' ')).toMatch(/Sonne hinter der Fassade/);
  });

  it('names the floors blocked by the horizon', () => {
    setConfig({ horizon: { terrainEnabled: false, obstacles: [WALL_OBSTACLE], manual: [] } });
    const { container } = render(<FrontalView />);
    const svg = figureOf(container);
    expect(svgTexts(svg).join(' ')).toMatch(/Sonne hinter Gelände\/Hindernis/);
    expectSaneSvg(svg);
  });

  it('warns about physically overlapping panel rows', () => {
    setConfig({ building: { floorHeight: 200 }, panels: { length: 250, tiltFromVertical: 20 } });
    render(<FrontalView />);
    expect(screen.getByRole('note')).toHaveTextContent(/überlappen sich um 35 cm/);
  });

  it('warns when ground-floor panels would reach into the ground', () => {
    setConfig({ building: { lowestFloor: 0 }, panels: { width: 113.4, length: 176.2 } });
    render(<FrontalView />);
    expect(screen.getByRole('note')).toHaveTextContent(
      /untersten Reihe \(EG\) reichen 25\scm unter das Terrain/,
    );
  });

  it('draws the hour labels over the current sun, clear of its glyph', () => {
    const { container } = render(<FrontalView />);
    const all = Array.from(figureOf(container).querySelectorAll('*'));
    const twelve = all.find((e) => e.tagName === 'text' && e.textContent === '12');
    const core = all.find(
      (e) => e.tagName === 'circle' && /(^|\s)_sunCore_/.test(e.getAttribute('class') ?? ''),
    );
    if (!twelve || !core) throw new Error('12 label or sun missing');
    expect(all.indexOf(twelve)).toBeGreaterThan(all.indexOf(core));
    // Baseline above the glow (core radius 7 · 1.95).
    expect(Number(twelve.getAttribute('y'))).toBeLessThan(Number(core.getAttribute('cy')) - 13.65);
  });

  it('does not warn for a single floor', () => {
    setConfig({ building: { numFloors: 1, floorHeight: 200 }, panels: { length: 250, tiltFromVertical: 0 } });
    render(<FrontalView />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('uses unique SVG ids per instance and renders in English', () => {
    useUiStore.getState().setLang('en');
    const { container } = render(
      <>
        <FrontalView />
        <FrontalView />
      </>,
    );
    expectUniqueIds(container);
    expect(screen.getAllByRole('img', { name: /Front view on 21 June 2025 at 12:00/ })).toHaveLength(2);
  });
});
