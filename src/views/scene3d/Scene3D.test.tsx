import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../../state/uiStore';
import { resetStores } from '../../test/utils';
import Scene3D from './Scene3D';
import { isWebGL2Available, resetWebGLDetection } from './webgl';

describe('Scene3D without WebGL (jsdom)', () => {
  beforeEach(() => {
    resetStores();
    resetWebGLDetection();
  });

  it('shows an accessible notice instead of the canvas', () => {
    render(<Scene3D />);
    expect(screen.getByRole('heading', { name: '3D-Ansicht' })).toBeInTheDocument();
    expect(screen.getByText('3D-Ansicht nicht verfügbar')).toBeInTheDocument();
    expect(screen.getByText(/kein WebGL 2/)).toBeInTheDocument();
    expect(document.querySelector('canvas')).toBeNull();
    // Nothing to export or toggle.
    expect(screen.queryByRole('button', { name: /PNG/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Modell-Schatten' })).toBeNull();
  });

  it('shows date and time of the selected instant in the subtitle, in English too', () => {
    useUiStore.getState().setLang('en');
    render(<Scene3D />);
    expect(screen.getByRole('heading', { name: '3D view' })).toBeInTheDocument();
    expect(screen.getByText(/21 June 2025, 12:00/)).toBeInTheDocument();
    expect(screen.getByText('3D view not available')).toBeInTheDocument();
  });
});

describe('isWebGL2Available', () => {
  afterEach(() => {
    resetWebGLDetection();
    vi.restoreAllMocks();
  });

  it('is false when no WebGL 2 context can be created', () => {
    resetWebGLDetection();
    expect(isWebGL2Available()).toBe(false);
  });

  it('is true with a WebGL 2 context, releases the probe context and caches the result', () => {
    const loseContext = vi.fn();
    const getContext = vi.fn(() => ({ getExtension: () => ({ loseContext }) }));
    vi.stubGlobal('WebGL2RenderingContext', class {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      getContext as unknown as HTMLCanvasElement['getContext'],
    );
    resetWebGLDetection();
    expect(isWebGL2Available()).toBe(true);
    expect(getContext).toHaveBeenCalledWith('webgl2');
    expect(loseContext).toHaveBeenCalledOnce();
    expect(isWebGL2Available()).toBe(true);
    expect(getContext).toHaveBeenCalledOnce();
  });
});
