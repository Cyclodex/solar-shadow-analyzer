import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('exports the body as PNG, named by kind and parts in the UI language', async () => {
    render(
      <ViewCard title="Frontalansicht" exportKind="frontal" exportParts={['Bern', '2025-06-21', '1230']}>
        <svg />
      </ViewCard>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Frontalansicht als PNG exportieren' }));
    await waitFor(() => expect(exportViewPng).toHaveBeenCalledTimes(1));
    expect(exportViewPng).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'verschattung-frontalansicht-Bern-2025-06-21-1230.png',
    );

    act(() => useUiStore.getState().setLang('en'));
    const button = screen.getByRole('button', { name: 'Export Frontalansicht as PNG' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(exportViewPng).toHaveBeenCalledTimes(2));
    expect(exportViewPng).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      'shading-front-view-Bern-2025-06-21-1230.png',
    );
  });

  it('hides the PNG button without an export kind', () => {
    render(
      <ViewCard title="Sonnenbahn">
        <svg />
      </ViewCard>,
    );
    expect(screen.queryByRole('button', { name: /als PNG exportieren/ })).not.toBeInTheDocument();
  });
});
