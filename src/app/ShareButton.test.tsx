import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfigFromHash } from '../model/share';
import { useConfigStore } from '../state/configStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { ShareButton } from './ShareButton';

function setNavigator(key: 'clipboard' | 'share' | 'canShare', value: unknown): void {
  Object.defineProperty(navigator, key, { configurable: true, writable: true, value });
}

/** matchMedia stub: '(pointer: coarse)' matches on touch devices. */
function setTouch(touch: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: touch && query.includes('coarse'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

describe('ShareButton', () => {
  beforeEach(() => {
    resetStores();
    history.replaceState(null, '', '/app/');
    useConfigStore.getState().patch('building', { numFloors: 5 });
    setTouch(false);
  });

  afterEach(() => {
    history.replaceState(null, '', '/');
    setNavigator('clipboard', undefined);
    setNavigator('share', undefined);
    setNavigator('canShare', undefined);
    Object.defineProperty(document, 'execCommand', { configurable: true, writable: true, value: undefined });
  });

  it('copies the share link of the current configuration and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator('clipboard', { writeText });
    render(<ShareButton />);
    const button = screen.getByRole('button', { name: 'Teilen' });
    expect(button).toHaveAttribute('title', 'Link zu dieser Konfiguration kopieren');

    fireEvent.click(button);
    await screen.findByRole('button', { name: 'Link kopiert' });
    expect(screen.getByRole('status')).toHaveTextContent('Link kopiert');

    const url = writeText.mock.calls[0][0] as string;
    expect(url.startsWith(`${location.origin}/app/#c=`)).toBe(true);
    expect(readConfigFromHash(new URL(url).hash)?.building.numFloors).toBe(5);
  });

  it('returns to "Teilen" after the confirmation time', async () => {
    setNavigator('clipboard', { writeText: vi.fn().mockResolvedValue(undefined) });
    vi.useFakeTimers();
    render(<ShareButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Teilen' }));
    });
    expect(screen.getByRole('button', { name: 'Link kopiert' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('button', { name: 'Teilen' })).toBeInTheDocument();
  });

  it('shows the link for manual copying when no clipboard method works', async () => {
    setNavigator('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: () => false,
    });
    useUiStore.getState().setLang('en');
    render(<ShareButton />);
    const button = screen.getByRole('button', { name: 'Share' });
    fireEvent.click(button);

    const dialog = await screen.findByRole('dialog');
    const input = screen.getByRole('textbox', { name: /copy the link manually/ });
    expect((input as HTMLInputElement).value).toContain('#c=');
    expect(dialog).toContainElement(input);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('opens the native share sheet on touch devices', async () => {
    setTouch(true);
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator('share', share);
    setNavigator('canShare', () => true);
    setNavigator('clipboard', { writeText });
    render(<ShareButton />);
    const button = screen.getByRole('button', { name: 'Teilen' });
    expect(button).toHaveAttribute('title', 'Link zu dieser Konfiguration teilen');
    fireEvent.click(button);
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0]).toMatchObject({ url: expect.stringContaining('#c=') });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('does nothing when the share sheet is dismissed, and copies when sharing fails', async () => {
    setTouch(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator('clipboard', { writeText });
    const share = vi.fn().mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    setNavigator('share', share);
    render(<ShareButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Teilen' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(writeText).not.toHaveBeenCalled();

    share.mockRejectedValueOnce(new TypeError('not allowed'));
    fireEvent.click(screen.getByRole('button', { name: 'Teilen' }));
    await screen.findByRole('button', { name: 'Link kopiert' });
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
