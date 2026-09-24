import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExportFilename } from '../app/useExportFilename';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { ViewCard } from './ViewCard';

const exportViewPng = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../export/png', () => ({ exportViewPng }));

describe('ViewCard', () => {
  beforeEach(() => {
    resetStores();
    exportViewPng.mockClear();
  });

  it('exports the body as PNG under the given file name', async () => {
    render(
      <ViewCard title="Frontalansicht" exportFilename="verschattung-frontalansicht-Bern.png">
        <svg />
      </ViewCard>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Frontalansicht als PNG exportieren' }));
    await waitFor(() => expect(exportViewPng).toHaveBeenCalledTimes(1));
    expect(exportViewPng).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'verschattung-frontalansicht-Bern.png',
    );
  });

  it('still accepts a base name (exportName) and hides the button without a name', async () => {
    const { rerender } = render(
      <ViewCard title="Sonnenbahn" exportName="sonnen bahn">
        <svg />
      </ViewCard>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sonnenbahn als PNG exportieren' }));
    await waitFor(() =>
      expect(exportViewPng).toHaveBeenCalledWith(expect.any(HTMLElement), 'sonnen-bahn.png'),
    );
    rerender(
      <ViewCard title="Sonnenbahn">
        <svg />
      </ViewCard>,
    );
    expect(screen.queryByRole('button', { name: /als PNG exportieren/ })).not.toBeInTheDocument();
  });
});

describe('useExportFilename', () => {
  beforeEach(resetStores);

  it('names exports like the Export menu, in the UI language, with the location', () => {
    const { result, rerender } = renderHook(() => useExportFilename('monthly', [2025]));
    expect(result.current).toBe('verschattung-monatsertrag-47.100-N-7.450-E-2025.png');
    useUiStore.getState().setLang('en');
    rerender();
    expect(result.current).toBe('shading-monthly-yield-47.100-N-7.450-E-2025.png');
  });
});
