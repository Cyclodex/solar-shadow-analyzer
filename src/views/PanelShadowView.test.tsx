import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { PanelShadowView } from './PanelShadowView';
import {
  EXTREME_CASES,
  WALL_OBSTACLE,
  expectSaneSvg,
  expectUniqueIds,
  figureOf,
  setConfig,
  svgTexts,
} from './svg/testUtils';

/** Config and time with a clearly shaded lower row (see ProfileView tests). */
function shadedCase(): void {
  setConfig({ building: { floorHeight: 220 }, panels: { length: 170, tiltFromVertical: 60 } });
  useTimeStore.setState({ minutes: 750 });
}

const pctLabels = (texts: string[]): string[] => texts.filter((t) => /^\d+\s%$/.test(t));

describe('PanelShadowView', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the row of the focus floor for the default config', () => {
    const { container } = render(<PanelShadowView />);
    const svg = figureOf(container);
    expect(screen.getByRole('img', { name: /Schatten auf der Panelreihe 1\. OG um 12:00/ })).toBe(svg);
    expect(svg).toHaveAccessibleDescription(/2 Module von 176\.2\scm × 113\.4\scm/);
    expectSaneSvg(svg);
  });

  it.each(EXTREME_CASES)('stays inside the viewBox: $name', ({ patch }) => {
    setConfig(patch);
    const { container } = render(<PanelShadowView />);
    expectSaneSvg(figureOf(container));
  });

  it('labels every module with its shaded share and substring loss', () => {
    shadedCase();
    const { container } = render(<PanelShadowView />);
    const svg = figureOf(container);
    const texts = svgTexts(svg);
    expect(pctLabels(texts.map((t) => t.replace(/Verlust.*$/, '')))).toHaveLength(2);
    expect(texts.filter((t) => /Verlust \d+\s%/.test(t))).toHaveLength(2);
    expect(svg).toHaveAccessibleDescription(
      /\d+\s% der Reihe verschattet, \d+\s% Verlust der Direktstrahlung/,
    );
    expect(svg).toHaveAccessibleDescription(/Schattenversatz/);
  });

  it('omits substring losses for the linear shading model', () => {
    shadedCase();
    setConfig({
      building: { floorHeight: 220 },
      panels: { length: 170, tiltFromVertical: 60 },
      system: { shadingModel: 'linear' },
    });
    const { container } = render(<PanelShadowView />);
    const svg = figureOf(container);
    expect(svgTexts(svg).join(' ')).not.toMatch(/Verlust/);
    expect(svg).toHaveAccessibleDescription(/\d+\s% der Reihe verschattet\./);
  });

  it('switches the analysed floor with the floor selector', () => {
    setConfig({ building: { numFloors: 3 } });
    render(<PanelShadowView />);
    const group = screen.getByRole('radiogroup', { name: 'Stockwerk für die Detailansicht' });
    expect(group).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '3. OG' }));
    expect(useUiStore.getState().focusFloor).toBe(2);
    expect(screen.getByRole('img', { name: /3\. OG/ })).toHaveAccessibleDescription(
      /Oberstes Stockwerk: keine Panels darüber/,
    );
  });

  it('uses a compact select for many floors', () => {
    setConfig({ building: { numFloors: 6 } });
    render(<PanelShadowView />);
    const select = screen.getByRole('combobox', { name: 'Stockwerk für die Detailansicht' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '6. OG',
      '5. OG',
      '4. OG',
      '3. OG',
      '2. OG',
      '1. OG',
    ]);
    fireEvent.change(select, { target: { value: '4' } });
    expect(useUiStore.getState().focusFloor).toBe(4);
    expect(screen.getByRole('heading', { name: 'Panel-Schatten' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /5\. OG/ })).toBeInTheDocument();
  });

  it('explains where the shadow goes when it misses the row', () => {
    // Low winter sun: the shadow of the row above falls above the lower row.
    useTimeStore.setState({ date: '2025-12-21', minutes: 780 });
    const above = render(<PanelShadowView />);
    expect(figureOf(above.container)).toHaveAccessibleDescription(/fällt oberhalb der Reihe/);
    above.unmount();

    // Narrow row, sun far to the side: the shadow falls beside the row.
    setConfig({
      building: { floorHeight: 220 },
      panels: { length: 170, tiltFromVertical: 60, count: 1, width: 40 },
    });
    useTimeStore.setState({ date: '2025-06-21', minutes: 17 * 60 + 30 });
    const beside = render(<PanelShadowView />);
    expect(figureOf(beside.container)).toHaveAccessibleDescription(/fällt seitlich neben die Reihe/);
  });

  it('has no floor selector and no shadow for a single floor', () => {
    setConfig({ building: { numFloors: 1 } });
    const { container } = render(<PanelShadowView />);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(pctLabels(svgTexts(figureOf(container)))).toHaveLength(0);
  });

  it('reports night, sun behind the facade and a blocked horizon', () => {
    useTimeStore.setState({ minutes: 0 });
    const night = render(<PanelShadowView />);
    expect(figureOf(night.container)).toHaveAccessibleDescription(/Sonne unter dem Horizont/);
    night.unmount();

    useTimeStore.setState({ minutes: 720 });
    setConfig({ building: { facadeAzimuth: 0 } });
    const behind = render(<PanelShadowView />);
    expect(figureOf(behind.container)).toHaveAccessibleDescription(/Sonne hinter der Fassade/);
    behind.unmount();

    setConfig({ horizon: { terrainEnabled: false, obstacles: [WALL_OBSTACLE], manual: [] } });
    const blocked = render(<PanelShadowView />);
    expect(figureOf(blocked.container)).toHaveAccessibleDescription(/Sonne hinter Gelände\/Hindernis/);
  });

  it('lists per-module values in the text when the modules are too narrow for labels', () => {
    setConfig({
      building: { floorHeight: 220 },
      panels: { count: 8, width: 30, length: 170, tiltFromVertical: 60 },
    });
    useTimeStore.setState({ minutes: 750 });
    const { container } = render(<PanelShadowView />);
    const svg = figureOf(container);
    expect(svg).toHaveAccessibleDescription(/Je Modul von links: (\d+\s%.*){8}/);
    expectSaneSvg(svg);
  });

  it('uses unique ids and renders in English', () => {
    useUiStore.getState().setLang('en');
    const { container } = render(
      <>
        <PanelShadowView />
        <PanelShadowView />
      </>,
    );
    expectUniqueIds(container);
    expect(screen.getAllByRole('img', { name: /Shadow on the panel row of Floor 1 at 12:00/ })).toHaveLength(
      2,
    );
  });
});
