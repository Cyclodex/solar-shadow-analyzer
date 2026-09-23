import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { SunPathView } from './SunPathView';
import {
  EXTREME_CASES,
  WALL_OBSTACLE,
  expectSaneSvg,
  expectUniqueIds,
  figureOf,
  setConfig,
  svgTexts,
} from './svg/testUtils';

describe('SunPathView', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the polar diagram for the default config', () => {
    const { container } = render(<SunPathView />);
    const svg = figureOf(container);
    expect(screen.getByRole('img', { name: 'Sonnenbahndiagramm für den 21. Juni 2025' })).toBe(svg);
    const texts = svgTexts(svg);
    // Compass (north up), rings, facade orientation, reference days (the selected day is 21 June itself).
    expect(texts).toEqual(expect.arrayContaining(['N', 'O', 'W', '30°', '60°', 'Fassade 202°']));
    expect(texts).toEqual(expect.arrayContaining(['21. Dez.', '20. März']));
    expect(texts).not.toContain('21. Juni');
    // Local clock hours along the selected path (CEST).
    expect(texts).toEqual(expect.arrayContaining(['8', '12', '18']));
    expect(svg).toHaveAccessibleDescription(/Sonne vor der Fassade: \d\d:\d\d–\d\d:\d\d/);
    expect(svg).toHaveAccessibleDescription(/Höchststand 66° um 13:\d\d/);
    expectSaneSvg(svg);
  });

  it.each(EXTREME_CASES)('stays inside the viewBox: $name', ({ patch }) => {
    setConfig(patch);
    const { container } = render(<SunPathView />);
    expectSaneSvg(figureOf(container));
  });

  it('labels all reference days when another date is selected', () => {
    useTimeStore.setState({ date: '2025-11-02' });
    const { container } = render(<SunPathView />);
    const texts = svgTexts(figureOf(container));
    expect(texts).toEqual(expect.arrayContaining(['21. Dez.', '20. März', '21. Juni']));
  });

  it('draws the horizon profile of the analysed floor', () => {
    setConfig({ horizon: { terrainEnabled: false, obstacles: [WALL_OBSTACLE], manual: [] } });
    const { container } = render(<SunPathView />);
    const svg = figureOf(container);
    expect(svgTexts(svg)).toContain('Horizont (1. OG)');
    expect(svg.querySelector('path[fill-rule="evenodd"]')).not.toBeNull();
    expectSaneSvg(svg);
  });

  it('reports a day without sun in front of the facade and polar night', () => {
    setConfig({ building: { facadeAzimuth: 0 } });
    useTimeStore.setState({ date: '2025-12-21' });
    const first = render(<SunPathView />);
    expect(figureOf(first.container)).toHaveAccessibleDescription(/nie vor der Fassade/);
    first.unmount();

    setConfig({ location: { latitude: 78.2, longitude: 15.6, timezone: 'Arctic/Longyearbyen' } });
    const second = render(<SunPathView />);
    const svg = figureOf(second.container);
    expect(svg).toHaveAccessibleDescription(/Polarnacht/);
    expectSaneSvg(svg);
  });

  it('shows the current sun only above the horizon', () => {
    useTimeStore.setState({ minutes: 0 });
    const { container } = render(<SunPathView />);
    expect(figureOf(container)).toHaveAccessibleDescription(/Sonne unter dem Horizont/);
  });

  it('uses unique ids and renders in English', () => {
    useUiStore.getState().setLang('en');
    const { container } = render(
      <>
        <SunPathView />
        <SunPathView />
      </>,
    );
    expectUniqueIds(container);
    expect(screen.getAllByRole('img', { name: 'Sun path diagram for 21 June 2025' })).toHaveLength(2);
    expect(svgTexts(figureOf(container))).toEqual(expect.arrayContaining(['N', 'E', 'Facade 202°']));
  });
});
