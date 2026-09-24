import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { CANVAS_RENDER_EVENT, type CanvasRenderDetail } from './canvasRender';
import { PRINT_STAND_IN_ATTR, PRINTING_CLASS, printReport } from './print';
import { PrintRoot } from './PrintRoot';

const REPORT = { name: 'Eingaben dieses Berichts' };

/** State of the page seen by the print snapshot. */
interface Snapshot {
  theme: string;
  dataTheme: string | undefined;
  printing: boolean;
  report: boolean;
}

function snapshot(): Snapshot {
  return {
    theme: useUiStore.getState().theme,
    dataTheme: document.documentElement.dataset.theme,
    printing: document.documentElement.classList.contains(PRINTING_CLASS),
    report: screen.queryByRole('region', REPORT) !== null,
  };
}

describe('print mode', () => {
  beforeEach(() => {
    resetStores();
    document.documentElement.dataset.theme = 'dark';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('printReport switches to the light theme before printing and restores it afterwards', async () => {
    render(<PrintRoot />);
    const seen: Record<string, Snapshot> = {};
    // Like Chromium: print() fires beforeprint, takes the snapshot, fires afterprint, then returns.
    const print = vi.fn(() => {
      seen.called = snapshot();
      act(() => {
        window.dispatchEvent(new Event('beforeprint'));
      });
      seen.printed = snapshot();
      act(() => {
        window.dispatchEvent(new Event('afterprint'));
      });
    });
    vi.stubGlobal('print', print);

    await act(() => printReport());
    expect(print).toHaveBeenCalledTimes(1);
    // Already light when print() is called, so canvases had frames to redraw.
    expect(seen.called).toEqual({ theme: 'light', dataTheme: 'light', printing: false, report: false });
    expect(seen.printed).toEqual({ theme: 'light', dataTheme: 'light', printing: true, report: true });
    expect(snapshot()).toEqual({ theme: 'dark', dataTheme: 'dark', printing: false, report: false });
  });

  it('printReport restores the theme when printing fires no print events', async () => {
    render(<PrintRoot />);
    const print = vi.fn(() => {
      expect(useUiStore.getState().theme).toBe('light');
    });
    vi.stubGlobal('print', print);
    await act(() => printReport());
    expect(print).toHaveBeenCalledTimes(1);
    expect(snapshot()).toEqual({ theme: 'dark', dataTheme: 'dark', printing: false, report: false });
  });

  it("re-renders canvases for the browser's print command and prints 2D copies of them", () => {
    render(<PrintRoot />);
    const host = document.createElement('div');
    const scene = document.createElement('canvas');
    scene.width = 400;
    scene.height = 200;
    scene.style.width = '200px';
    const plain = document.createElement('canvas');
    host.append(scene, plain);
    document.body.append(host);

    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return this === scene ? null : { drawImage };
    } as unknown as HTMLCanvasElement['getContext']);
    const requests: { reason: string; theme: string }[] = [];
    scene.addEventListener(CANVAS_RENDER_EVENT, (e) => {
      const detail = (e as CustomEvent<CanvasRenderDetail>).detail;
      requests.push({ reason: detail.reason, theme: useUiStore.getState().theme });
      detail.rendered = true;
    });

    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    // Re-rendered in the light theme, then copied; the plain canvas (no listener) is printed as is.
    expect(requests).toEqual([{ reason: 'print', theme: 'light' }]);
    const copy = scene.nextElementSibling as HTMLCanvasElement;
    expect(copy.tagName).toBe('CANVAS');
    expect(copy).toHaveAttribute(PRINT_STAND_IN_ATTR);
    expect(copy).toHaveAttribute('aria-hidden', 'true');
    expect([copy.width, copy.height, copy.style.width]).toEqual([400, 200, '200px']);
    expect(drawImage).toHaveBeenCalledWith(scene, 0, 0);
    expect(document.querySelectorAll(`[${PRINT_STAND_IN_ATTR}]`)).toHaveLength(1);
    expect(scene).toHaveAttribute('data-print-replaced');
    expect(plain).not.toHaveAttribute('data-print-replaced');

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(document.querySelectorAll(`[${PRINT_STAND_IN_ATTR}]`)).toHaveLength(0);
    expect(scene).not.toHaveAttribute('data-print-replaced');
    expect(useUiStore.getState().theme).toBe('dark');
    host.remove();
  });
});
