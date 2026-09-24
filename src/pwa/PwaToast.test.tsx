import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { OFFLINE_NOTICE_MS, PwaToast } from './PwaToast';
import { RELOAD_FALLBACK_MS, UPDATE_CHECK_MS, reloadPage } from './updates';

// The service worker registration (virtual module of vite-plugin-pwa) with the state a test sets up.
const sw = vi.hoisted(() => ({
  needRefresh: false,
  offlineReady: false,
  options: undefined as RegisterSWOptions | undefined,
  updateServiceWorker: vi.fn<(reloadPage?: boolean) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock('virtual:pwa-register/react', async () => {
  const { useState } = await import('react');
  return {
    useRegisterSW: (options?: RegisterSWOptions) => {
      sw.options = options;
      return {
        needRefresh: useState(sw.needRefresh),
        offlineReady: useState(sw.offlineReady),
        updateServiceWorker: sw.updateServiceWorker,
      };
    },
  };
});

// jsdom cannot reload the page.
vi.mock('./updates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./updates')>()),
  reloadPage: vi.fn(),
}));

describe('PwaToast', () => {
  beforeEach(() => {
    resetStores();
    sw.needRefresh = false;
    sw.offlineReady = false;
    sw.options = undefined;
    sw.updateServiceWorker.mockClear();
    vi.mocked(reloadPage).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps an empty live region without notices', () => {
    render(<PwaToast />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('offers the new version: "Neu laden" activates it, "Später" keeps the running one', () => {
    vi.useFakeTimers();
    sw.needRefresh = true;
    const { unmount } = render(<PwaToast />);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Neue Version verfügbar.');
    fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true);
    // Normally the new version reloads the page; if that signal does not come, the page reloads itself.
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS - 1);
    expect(reloadPage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reloadPage).toHaveBeenCalledTimes(1);
    unmount();

    render(<PwaToast />);
    fireEvent.click(screen.getByRole('button', { name: 'Später' }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS);
    expect(sw.updateServiceWorker).toHaveBeenCalledTimes(1);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('announces "Offline verfügbar" and hides it after a while or on close', () => {
    vi.useFakeTimers();
    sw.offlineReady = true;
    const { unmount } = render(<PwaToast />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Offline verfügbar: Die App startet jetzt auch ohne Internet.',
    );
    act(() => {
      vi.advanceTimersByTime(OFFLINE_NOTICE_MS - 1);
    });
    expect(screen.getByRole('status')).not.toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    unmount();

    render(<PwaToast />);
    fireEvent.click(screen.getByRole('button', { name: 'Schliessen' }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('keeps the offline notice while it has focus', () => {
    vi.useFakeTimers();
    sw.offlineReady = true;
    render(<PwaToast />);
    const close = screen.getByRole('button', { name: 'Schliessen' });
    close.focus();
    act(() => {
      vi.advanceTimersByTime(OFFLINE_NOTICE_MS * 2);
    });
    expect(close).toBeInTheDocument();
    close.blur();
    act(() => {
      vi.advanceTimersByTime(OFFLINE_NOTICE_MS);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('shows the update notice rather than the offline notice when both apply, in English', () => {
    useUiStore.setState({ lang: 'en' });
    sw.needRefresh = true;
    sw.offlineReady = true;
    render(<PwaToast />);
    expect(screen.getByRole('status')).toHaveTextContent('New version available.');
    expect(screen.getByRole('status')).not.toHaveTextContent('Available offline');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument();
  });

  it('looks for updates hourly once registered and reports registration errors as warnings', () => {
    vi.useFakeTimers();
    render(<PwaToast />);
    const update = vi.fn(() => Promise.resolve());
    const registration = { installing: null, update } as unknown as ServiceWorkerRegistration;
    sw.options?.onRegisteredSW?.('/sw.js', registration);
    act(() => {
      vi.advanceTimersByTime(UPDATE_CHECK_MS);
    });
    expect(update).toHaveBeenCalledTimes(1);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sw.options?.onRegisterError?.(new Error('blocked'));
    expect(warn).toHaveBeenCalledWith('Service worker registration failed:', expect.any(Error));
  });
});
