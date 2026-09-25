import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetBuildingImport } from '../../hooks/useBuildingImport';
import { DEFAULT_CONFIG } from '../../model/defaults';
import { enuToLonLat, lonLatToEnu } from '../../model/enu';
import type { Vertex } from '../../model/polygon';
import { sanitizeConfig } from '../../model/share';
import type { Building, Config } from '../../model/types';
import { requestSitePlan, useBuildingImportStore } from '../../state/buildingImportStore';
import { useConfigStore } from '../../state/configStore';
import { useUiStore } from '../../state/uiStore';
import { resetStores } from '../../test/utils';
import { SitePlan } from './SitePlan';

const ANCHOR = { latitude: 46.958474, longitude: 7.45363, radius: 300, date: '2026-09-25' };

const rect = (e0: number, n0: number, e1: number, n1: number): [number, number][] => [
  [e0, n0],
  [e1, n0],
  [e1, n1],
  [e0, n1],
];

const b = (id: string, footprint: [number, number][], over: Partial<Building> = {}): Building => ({
  id,
  name: '',
  footprint,
  base: 0,
  height: 15,
  source: 'swisstopo',
  ...over,
});

/**
 * Own row house b1 (10 × 12 m, north of the anchor) between b2 (west) and b3 (east): its south (180°) and
 * north (0°) walls are facades, east and west are party walls. b4 across the street, b5 entered by hand.
 */
const BUILDINGS: Building[] = [
  b('b1', rect(-5, 0, 5, 12)),
  b('b2', rect(-15, 0, -5, 12)),
  b('b3', rect(5, 0, 15, 12)),
  b('b4', rect(-20, -40, 20, -25), { height: 20 }),
  b('b5', rect(20, -10, 30, 0), { source: 'manual', name: 'Neubau' }),
];

/** The location at anchor ENU (e, n), the address point by default (inside the own building). */
function setSite(e = 0, n = 6, over: Partial<Config['horizon']> = {}): void {
  const loc = enuToLonLat(ANCHOR, e, n);
  useConfigStore.getState().replace(
    sanitizeConfig({
      ...DEFAULT_CONFIG,
      location: { ...DEFAULT_CONFIG.location, name: 'Teststrasse 1', ...loc },
      horizon: { ...DEFAULT_CONFIG.horizon, buildings: BUILDINGS, buildingImport: ANCHOR, ...over },
    }),
  );
}

const config = () => useConfigStore.getState().config;
/** Text with non-breaking spaces as plain spaces. */
const text = (el: Element): string => (el.textContent ?? '').replace(/\u00a0/g, ' ');
const map = () => screen.getByRole('group', { name: 'Lageplan, Norden oben' });
const svg = () => map().querySelector('svg')!;

function openPlan(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Lageplan' }));
}

/** Screen position (map px; jsdom has no layout, so client = map px) of a world point, from the transform. */
function screenOf([x, y]: Vertex): { clientX: number; clientY: number } {
  const m = /matrix\(([^)]+)\)/.exec(
    svg().querySelector('g[transform^="matrix"]')!.getAttribute('transform')!,
  )!;
  const [s, , , , tx, ty] = m[1].split(' ').map(Number);
  return { clientX: tx + x * s, clientY: ty - y * s };
}

/** Screen midpoint of the own edge facing `azimuth`. */
function edgeMid(index: number): { clientX: number; clientY: number } {
  const line = svg().querySelector(`[data-edge="${index}"] line`)!;
  const n = (a: string): number => Number(line.getAttribute(a));
  return { clientX: (n('x1') + n('x2')) / 2, clientY: (n('y1') + n('y2')) / 2 };
}

beforeEach(() => {
  resetStores();
  resetBuildingImport();
});

describe('SitePlan', () => {
  it('renders nothing without stored buildings', () => {
    const { container } = render(<SitePlan />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the status closed; open, it draws the plan with the own building and its facades', () => {
    setSite();
    render(<SitePlan />);
    expect(screen.getByText(/liegt noch nicht auf einer Fassade/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Lageplan, Norden oben' })).toBeNull();
    openPlan();
    expect(map()).toHaveAccessibleDescription(/Eigenes Gebäude: Gebäude 1\. .*4 weitere Gebäude im Plan/);
    expect(svg().querySelectorAll('path[data-building]')).toHaveLength(5);
    // Two selectable facades (north, south), two party walls.
    expect(svg().querySelectorAll('[data-selectable]')).toHaveLength(2);
    expect(screen.getByText('2 Brandmauern sind nicht wählbar.')).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Fassade mit dem Balkon' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => text(o)),
    ).toEqual(['0° N · 10.0 m lang', '180° S · 10.0 m lang']);
  });

  it('opens by itself after an address import, with instructions, and consumes the request', () => {
    setSite();
    render(<SitePlan />);
    act(() => requestSitePlan('address'));
    expect(useUiStore.getState().openSections.building).toBe(true);
    expect(useBuildingImportStore.getState().sitePlanRequest).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent(/Fassade und Balkon bestätigen/);
    expect(map()).toBeInTheDocument();
  });

  it('after «Gebäude laden» it opens only when the balcony is not on a facade yet', () => {
    setSite(1, 0); // on the south wall …
    useConfigStore.getState().patch('building', { facadeAzimuth: 180 });
    render(<SitePlan />);
    expect(screen.getByText('Balkon an der Fassade 180° S des eigenen Gebäudes.')).toBeInTheDocument();
    act(() => requestSitePlan('manual'));
    expect(useBuildingImportStore.getState().sitePlanRequest).toBeNull();
    expect(screen.queryByRole('group', { name: 'Lageplan, Norden oben' })).toBeNull();
  });

  it('keyboard: facade list and position, then «Übernehmen» sets location (1e-6°) and azimuth', () => {
    setSite();
    render(<SitePlan />);
    openPlan();
    fireEvent.change(screen.getByRole('combobox', { name: 'Fassade mit dem Balkon' }), {
      target: { value: '0' }, // edge 0: the south wall (the ring starts at its west corner)
    });
    const along = screen.getByRole('textbox', { name: /Position entlang der Fassade/ });
    expect(along).toHaveValue('5');
    fireEvent.change(along, { target: { value: '3' } });
    fireEvent.keyDown(along, { key: 'Enter' });
    expect(screen.getByText(/Noch nicht übernommen/)).toBeInTheDocument();
    const before = config().location;
    expect(before).toEqual(config().location); // nothing applied yet
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    const { location, building } = config();
    expect(building.facadeAzimuth).toBe(180);
    expect(location.name).toBe('Teststrasse 1');
    const [e, n] = lonLatToEnu(ANCHOR, location.latitude, location.longitude);
    // 3 m from the west corner (−5, 0) of the south wall, within the 1e-6° rounding.
    expect(Math.hypot(e - -2, n - 0)).toBeLessThan(0.07);
    expect(Math.round(location.latitude * 1e6) / 1e6).toBe(location.latitude);
    expect(screen.getByText('Balkon an der Fassade 180° S des eigenen Gebäudes.')).toBeInTheDocument();
    expect(screen.getByRole('status', { hidden: true })).toHaveTextContent(
      'Standort auf die Fassade 180° S gesetzt.',
    );
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('click on a facade places the balcony there; «Verwerfen» drops the draft', () => {
    setSite();
    render(<SitePlan />);
    openPlan();
    // The north wall (edge 2), clicked at its midpoint.
    fireEvent.click(svg(), edgeMid(2));
    const select = screen.getByRole('combobox', { name: 'Fassade mit dem Balkon' });
    expect(select).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: /Position entlang der Fassade/ })).toHaveValue('5');
    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    // Back to the suggestion (the configured azimuth 202° is closest to the south wall).
    expect(select).toHaveValue('0');
    fireEvent.click(svg(), edgeMid(2));
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(config().building.facadeAzimuth).toBe(0);
    const [e, n] = lonLatToEnu(ANCHOR, config().location.latitude, config().location.longitude);
    expect(Math.hypot(e, n - 12)).toBeLessThan(0.07);
  });

  it('a party wall is not selectable: a click explains it', () => {
    setSite();
    render(<SitePlan />);
    openPlan();
    fireEvent.click(svg(), edgeMid(1)); // east wall, adjoining b3
    expect(screen.getByText(/Brandmauer: grenzt an ein anderes Gebäude/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Fassade mit dem Balkon' })).toHaveValue('0');
  });

  it('a tapped neighbour shows its height and opens it in the building list', () => {
    setSite();
    render(<SitePlan />);
    openPlan();
    fireEvent.click(svg(), screenOf([0, -32]));
    const card = screen.getByRole('group', { name: 'Gebäude 4' });
    expect(card).toHaveTextContent(/20\sm hoch/);
    expect(card).toHaveTextContent(/25\sm vom Balkon, S/);
    fireEvent.click(within(card).getByRole('button', { name: 'In der Liste bearbeiten' }));
    expect(useBuildingImportStore.getState().buildingFocus?.buildingId).toBe('b4');
    expect(useUiStore.getState().openSections.horizon).toBe(true);
    fireEvent.click(within(card).getByRole('button', { name: 'Schliessen' }));
    expect(screen.queryByRole('group', { name: 'Gebäude 4' })).toBeNull();
    // A manual building shows its name and badge.
    fireEvent.click(svg(), screenOf([25, -5]));
    expect(screen.getByRole('group', { name: 'Neubau' })).toHaveTextContent('von Hand');
  });

  it('keyboard only: «Eigenes Gebäude» chooses another part, then its facade (no tap needed)', () => {
    setSite();
    render(<SitePlan />);
    openPlan();
    const ownSelect = screen.getByRole('combobox', { name: 'Eigenes Gebäude' });
    expect(ownSelect).toHaveAccessibleDescription(/bis 25 m vom Standort/);
    // Imported parts near the address point (0, 6); b4 is 31 m away, b5 was entered by hand.
    expect(
      within(ownSelect)
        .getAllByRole('option')
        .map((o) => text(o)),
    ).toEqual(['Gebäude 1 · am Standort', 'Gebäude 2 · 5 m W', 'Gebäude 3 · 5 m O']);
    expect(ownSelect).toHaveValue('b1');
    fireEvent.change(ownSelect, { target: { value: 'b2' } });
    expect(map()).toHaveAccessibleDescription(/Eigenes Gebäude: Gebäude 2\./);
    const facade = screen.getByRole('combobox', { name: 'Fassade mit dem Balkon' });
    const options = within(facade).getAllByRole('option');
    expect(options.map((o) => text(o))).toEqual([
      '0° N · 10.0 m lang',
      '180° S · 10.0 m lang',
      '270° W · 12.0 m lang',
    ]);
    fireEvent.change(facade, { target: { value: options[2].getAttribute('value') } });
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    const { location, building } = config();
    expect(building.facadeAzimuth).toBe(270);
    const [e, n] = lonLatToEnu(ANCHOR, location.latitude, location.longitude);
    expect(Math.hypot(e - -15, n - 6)).toBeLessThan(0.07); // the middle of b2's west wall
    expect(screen.getByRole('combobox', { name: 'Eigenes Gebäude' })).toHaveValue('b2');
  });

  it('only buildings entered by hand: a neutral note, no own building to choose, nothing to apply', () => {
    setSite(0, 0, { buildings: [BUILDINGS[4]] });
    render(<SitePlan />);
    expect(screen.getByText(/Nur von Hand erfasste Gebäude/)).toBeInTheDocument();
    expect(screen.queryByText(/liegt noch nicht auf einer Fassade/)).toBeNull();
    openPlan();
    expect(screen.queryByRole('combobox', { name: 'Eigenes Gebäude' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Fassade mit dem Balkon' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Übernehmen' })).toBeNull();
    fireEvent.click(svg(), screenOf([25, -5]));
    const card = screen.getByRole('group', { name: 'Neubau' });
    expect(within(card).queryByRole('button', { name: 'Das ist mein Gebäude' })).toBeNull();
  });

  it('another site (location over 2 km from the anchor): says so and offers to load there', () => {
    const edited = BUILDINGS.map((x) => (x.id === 'b4' ? { ...x, edited: true } : x));
    setSite(0, 6, { buildings: edited });
    useConfigStore.getState().patch('location', { latitude: 47.3769, longitude: 8.5417 });
    render(<SitePlan />);
    expect(
      screen.getByText(/gehören zu einem anderen Ort: Sie liegen 9\d\.\d km vom Standort entfernt/),
    ).toBeInTheDocument();
    openPlan();
    expect(screen.queryByRole('group', { name: 'Lageplan, Norden oben' })).toBeNull();
    // The edited building makes the import ask first: that question is in «Horizont & Umgebung».
    fireEvent.click(screen.getByRole('button', { name: 'Gebäude um den Standort laden' }));
    expect(useBuildingImportStore.getState().pendingConfirm).toMatchObject({
      reason: 'manual',
      latitude: 47.3769,
    });
    expect(useUiStore.getState().openSections.horizon).toBe(true);
  });

  it('«Das ist mein Gebäude» makes another building the own one', () => {
    setSite();
    render(<SitePlan />);
    openPlan();
    fireEvent.click(svg(), screenOf([0, -32]));
    fireEvent.click(screen.getByRole('button', { name: 'Das ist mein Gebäude' }));
    expect(map()).toHaveAccessibleDescription(/Eigenes Gebäude: Gebäude 4\./);
    const options = within(screen.getByRole('combobox', { name: 'Fassade mit dem Balkon' }))
      .getAllByRole('option')
      .map((o) => text(o));
    expect(options).toEqual([
      '0° N · 40.0 m lang',
      '90° O · 15.0 m lang',
      '180° S · 40.0 m lang',
      '270° W · 15.0 m lang',
    ]);
  });

  it('touch: a vertical swipe on the balcony scrolls (nothing changes), a sideways drag moves it', () => {
    setSite();
    render(<SitePlan />);
    openPlan();
    const handle = svg().querySelector('[data-handle]')!;
    const cx = Number(handle.getAttribute('cx'));
    const cy = Number(handle.getAttribute('cy'));
    const touch = { pointerId: 3, pointerType: 'touch', button: 0 } as const;
    const along = () => screen.getByRole('textbox', { name: /Position entlang der Fassade/ });
    expect(along()).toHaveValue('5');
    fireEvent.pointerDown(svg(), { ...touch, clientX: cx, clientY: cy });
    fireEvent.pointerMove(svg(), { ...touch, clientX: cx + 2, clientY: cy - 20 });
    fireEvent.pointerCancel(svg(), { ...touch });
    expect(along()).toHaveValue('5');
    // Sideways: beyond 8 px the balcony follows the finger along the south wall (east = +x on screen).
    const scale = screenOf([1, 0]).clientX - screenOf([0, 0]).clientX;
    fireEvent.pointerDown(svg(), { ...touch, clientX: cx, clientY: cy });
    fireEvent.pointerMove(svg(), { ...touch, clientX: cx + 5, clientY: cy });
    expect(along()).toHaveValue('5');
    fireEvent.pointerMove(svg(), { ...touch, clientX: cx + 2 * scale, clientY: cy + 3 });
    fireEvent.pointerUp(svg(), { ...touch, clientX: cx + 2 * scale, clientY: cy + 3 });
    fireEvent.click(svg(), { clientX: cx + 2 * scale, clientY: cy + 3 }); // no click effect after a drag
    expect(along()).toHaveValue('7');
  });

  it('zoom: buttons and Ctrl + wheel; a plain wheel leaves the plan and shows how to zoom', () => {
    setSite();
    render(<SitePlan />);
    openPlan();
    const scale = (): number => screenOf([1, 0]).clientX - screenOf([0, 0]).clientX;
    const s0 = scale();
    fireEvent.click(screen.getByRole('button', { name: 'Vergrössern' }));
    expect(scale()).toBeCloseTo(s0 * 1.6, 6);
    fireEvent.click(screen.getByRole('button', { name: 'Plan zentrieren' }));
    expect(scale()).toBeCloseTo(s0, 6);
    fireEvent.wheel(svg(), { deltaY: 100, clientX: 100, clientY: 100 });
    expect(scale()).toBeCloseTo(s0, 6);
    expect(screen.getByText(/Zum Zoomen Strg/)).toBeInTheDocument();
    fireEvent.wheel(svg(), { deltaY: -100, ctrlKey: true, clientX: 100, clientY: 100 });
    expect(scale()).toBeGreaterThan(s0);
    // Keyboard on the focused plan: + zooms, 0 recentres, arrows pan.
    fireEvent.keyDown(map(), { key: '0' });
    expect(scale()).toBeCloseTo(s0, 6);
    const x0 = screenOf([0, 0]).clientX;
    fireEvent.keyDown(map(), { key: 'ArrowRight' });
    expect(screenOf([0, 0]).clientX).toBeLessThan(x0);
  });

  it('two fingers zoom the plan; a mouse drag pans it and selects nothing', () => {
    setSite();
    render(<SitePlan />);
    openPlan();
    const scale = (): number => screenOf([1, 0]).clientX - screenOf([0, 0]).clientX;
    const s0 = scale();
    const f1 = { pointerId: 11, pointerType: 'touch', button: 0 } as const;
    const f2 = { pointerId: 12, pointerType: 'touch', button: 0 } as const;
    fireEvent.pointerDown(svg(), { ...f1, clientX: 100, clientY: 120 });
    fireEvent.pointerDown(svg(), { ...f2, clientX: 140, clientY: 120 });
    fireEvent.pointerMove(svg(), { ...f2, clientX: 180, clientY: 120 });
    expect(scale()).toBeCloseTo(s0 * 2, 6);
    fireEvent.pointerUp(svg(), { ...f2, clientX: 180, clientY: 120 });
    fireEvent.pointerUp(svg(), { ...f1, clientX: 100, clientY: 120 });
    fireEvent.click(screen.getByRole('button', { name: 'Plan zentrieren' }));
    // Mouse: press on b4, drag 40 px: the plan follows, the click after the drag selects nothing.
    const start = screenOf([0, -32]);
    const mouse = { pointerId: 1, pointerType: 'mouse', button: 0 } as const;
    fireEvent.pointerDown(svg(), { ...mouse, ...start });
    fireEvent.pointerMove(svg(), { ...mouse, clientX: start.clientX + 40, clientY: start.clientY });
    fireEvent.pointerUp(svg(), { ...mouse, clientX: start.clientX + 40, clientY: start.clientY });
    fireEvent.click(svg(), { clientX: start.clientX + 40, clientY: start.clientY });
    expect(screenOf([0, -32]).clientX).toBeCloseTo(start.clientX + 40, 6);
    expect(screen.queryByRole('group', { name: 'Gebäude 4' })).toBeNull();
  });

  it('English', () => {
    setSite();
    useUiStore.getState().setLang('en');
    render(<SitePlan />);
    fireEvent.click(screen.getByRole('button', { name: 'Site plan' }));
    expect(screen.getByRole('combobox', { name: 'Facade with the balcony' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });
});
