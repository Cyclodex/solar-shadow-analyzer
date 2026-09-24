import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { reloadPage } from './pwa/updates';
import { resetStores } from './test/utils';

// The 3D view's chunk cannot be loaded, as after a deploy that removed it (src/pwa/staleChunks.ts).
vi.mock('./views/scene3d', async () => {
  const { lazy } = await import('react');
  return {
    Scene3DLazy: lazy(() =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/Scene3D-old.js')),
    ),
  };
});

vi.mock('./pwa/updates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pwa/updates')>()),
  reloadPage: vi.fn(),
}));

describe('App with a 3D chunk that fails to load', () => {
  beforeEach(() => {
    resetStores();
    history.replaceState(null, '', '/');
  });

  it('replaces only the 3D view with a notice and offers a reload', async () => {
    // React and the boundary log the caught error.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<App />);
    expect(await screen.findByText('Die 3D-Ansicht konnte nicht geladen werden.')).toBeInTheDocument();
    // The rest of the app keeps working.
    expect(screen.getByRole('heading', { level: 1, name: 'Verschattungsanalyse' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Frontalansicht' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
