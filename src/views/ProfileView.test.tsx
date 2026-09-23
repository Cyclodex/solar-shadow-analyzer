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
  setConfig,
  svgTexts,
} from './svg/testUtils';

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
    expect(text).toMatch(/Abstand 200\scm/);
    expect(text).toMatch(/Auskragung 80\scm/);
    expect(text).toMatch(/θ 45°/);
    expect(text).toMatch(/β 45°/);
    // Critical angle from the model (2D onset): atan2(H − L cos θ, L sin θ).
    const critical = panelLayout(useConfigStore.getState().config).criticalProfileAngle;
    expect(text).toContain(`kritisch ${critical.toFixed(1)}°`);
    expect(svg).toHaveAccessibleDescription(/Neigung θ 45° ab Senkrechte \(β 45° ab Horizontal\)/);
    expectSaneSvg(svg);
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
    expect(allText(container)).toMatch(/1\. OG: \d+\s% verschattet \(exaktes 3D-Modell\)/);
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
    expect(text).not.toMatch(/Abstand/);
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
    expect(text).not.toMatch(/Abstand\s−/);
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
    expect(allText(container)).toMatch(/Floor height 280\scm/);
  });
});
