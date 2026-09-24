import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfigStore } from '../../state/configStore';
import { useTimeStore } from '../../state/timeStore';
import { resetStores } from '../../test/utils';
import Scene3D from './Scene3D';

// Pretend WebGL 2 exists: the DOM part of the view renders; R3F never creates a renderer in jsdom
// (the stubbed ResizeObserver never reports a canvas size).
vi.mock('./webgl', () => ({ isWebGL2Available: () => true, resetWebGLDetection: () => {} }));

const exportViewPng = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../export/png', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../export/png')>()),
  exportViewPng,
}));

/** Renders the view and waits for the lazily loaded WebGL part. */
async function renderLoaded(): Promise<HTMLElement> {
  render(<Scene3D />);
  return screen.findByRole('toolbar', { name: 'Kamera' }, { timeout: 10_000 });
}

// The first test pays for loading three.js/R3F (several seconds in jsdom on a slow CI runner).
describe('Scene3D stage (DOM parts)', { timeout: 20_000 }, () => {
  beforeEach(() => {
    resetStores();
  });

  it('offers PNG export, camera presets and layer toggles', async () => {
    const camera = await renderLoaded();
    expect(screen.getByText(/ziehen zum Drehen/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3D-Ansicht als PNG exportieren' })).toBeInTheDocument();
    for (const name of ['Ansicht zurücksetzen', 'Front', 'Seite', 'Oben', 'Aus Sonnenrichtung']) {
      expect(within(camera).getByRole('button', { name })).toBeInTheDocument();
    }
    const layers = screen.getByRole('list', { name: 'Ebenen' });
    const model = within(layers).getByRole('button', { name: 'Modell-Schatten' });
    expect(model).toHaveAttribute('aria-pressed', 'true');
    // The layer toggles label the legend in the printed report (print.css).
    expect(model).toHaveAttribute('data-print', 'label');
    fireEvent.click(model);
    expect(model).toHaveAttribute('aria-pressed', 'false');
    expect(within(layers).getByRole('button', { name: 'Schattenwurf' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(layers).getByRole('button', { name: 'Sonnenbahn' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('names the PNG after the site and the selected instant, in the UI language', async () => {
    useTimeStore.getState().setMinutes(12 * 60 + 30);
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: '3D-Ansicht als PNG exportieren' }));
    await waitFor(() =>
      expect(exportViewPng).toHaveBeenLastCalledWith(
        expect.any(HTMLElement),
        'verschattung-3d-ansicht-47.100-N-7.450-E-2025-06-21-1230.png',
      ),
    );
  });

  it('lists the model state per floor, top floor first, and describes the scene', async () => {
    await renderLoaded();
    const items = screen.getAllByRole('listitem').filter((li) => /OG/.test(li.textContent ?? ''));
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^2\. OG/),
      expect.stringMatching(/^1\. OG/),
    ]);
    // Top floor: nothing above it. Lower floor at noon on 21 June: shaded by the row above.
    expect(items[0]).toHaveTextContent('besonnt');
    expect(items[1]).toHaveTextContent(/\d+ % der Fläche verschattet/);
    const scene = screen.getByRole('group', { name: /^3D-Modell von Gebäude und Panels/ });
    expect(scene).toHaveAccessibleName(expect.stringMatching(/Sonne \d+° hoch, Azimut \d+°/));
    expect(scene).toHaveAccessibleDescription(/Pfeiltasten drehen/);
    expect(scene).toHaveAttribute('tabindex', '0');
  });

  it('disables the sun view at night and reports the night per floor', async () => {
    useTimeStore.getState().setMinutes(60);
    await renderLoaded();
    expect(screen.getByRole('button', { name: 'Aus Sonnenrichtung' })).toBeDisabled();
    expect(screen.getAllByText('Sonne unter dem Horizont')).toHaveLength(2);
  });

  it('follows the configuration (floor labels from the storey numbers)', async () => {
    useConfigStore.getState().patch('building', { numFloors: 3, lowestFloor: 0 });
    await renderLoaded();
    for (const label of ['EG', '1. OG', '2. OG']) expect(screen.getByText(label)).toBeInTheDocument();
  });
});
