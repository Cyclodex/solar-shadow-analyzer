import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { InstallButton } from './InstallButton';
import { STANDALONE_QUERY, initInstallPrompt, type BeforeInstallPromptEvent } from './install';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
/** iPadOS Safari asks for desktop sites and reports a Mac. */
const IPAD_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';

/** Overrides navigator properties (own properties shadow the prototype getters) until restoreNavigator(). */
const overridden: string[] = [];
function stubNavigator(props: Partial<Record<'userAgent' | 'maxTouchPoints' | 'standalone', unknown>>): void {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(navigator, key, { configurable: true, get: () => value });
    overridden.push(key);
  }
}
function restoreNavigator(): void {
  for (const key of overridden.splice(0)) Reflect.deleteProperty(navigator, key);
}

/** A beforeinstallprompt event whose dialog ends with `outcome`. */
function installEvent(outcome: 'accepted' | 'dismissed'): BeforeInstallPromptEvent {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    platforms: ['web'],
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
}

function matchStandalone(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === STANDALONE_QUERY,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  );
}

describe('InstallButton', () => {
  let stop: () => void;

  beforeEach(() => {
    resetStores();
    stop = initInstallPrompt();
  });

  afterEach(() => {
    stop();
    restoreNavigator();
  });

  it('is hidden in a desktop browser that offers no installation', () => {
    const { container } = render(<InstallButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the browser’s install dialog after beforeinstallprompt and hides once installed', async () => {
    render(<InstallButton />);
    const event = installEvent('accepted');
    act(() => {
      window.dispatchEvent(event);
    });
    // Chrome's own mini-infobar is suppressed in favour of the button.
    expect(event.defaultPrevented).toBe(true);
    const button = screen.getByRole('button', { name: 'Installieren' });
    expect(button).toHaveAttribute('title', 'Als App auf diesem Gerät installieren');

    await act(async () => {
      fireEvent.click(button);
      await event.userChoice;
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Installieren' })).not.toBeInTheDocument();
  });

  it('drops the used event when the install dialog is dismissed', async () => {
    render(<InstallButton />);
    const event = installEvent('dismissed');
    act(() => {
      window.dispatchEvent(event);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Installieren' }));
      await event.userChoice;
    });
    expect(screen.queryByRole('button', { name: 'Installieren' })).not.toBeInTheDocument();
    // The browser may offer installation again later.
    act(() => {
      window.dispatchEvent(installEvent('accepted'));
    });
    expect(screen.getByRole('button', { name: 'Installieren' })).toBeInTheDocument();
  });

  it('hides after appinstalled (e.g. installed from the browser menu)', () => {
    render(<InstallButton />);
    act(() => {
      window.dispatchEvent(installEvent('accepted'));
    });
    expect(screen.getByRole('button', { name: 'Installieren' })).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByRole('button', { name: 'Installieren' })).not.toBeInTheDocument();
  });

  it('is hidden while running as the installed app', () => {
    matchStandalone();
    const { container } = render(<InstallButton />);
    act(() => {
      window.dispatchEvent(installEvent('accepted'));
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('explains the home screen steps on iOS', () => {
    stubNavigator({ userAgent: IPHONE, maxTouchPoints: 5 });
    render(<InstallButton />);
    const button = screen.getByRole('button', { name: 'Installieren' });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const steps = screen.getByRole('group', { name: 'Als App auf den Home-Bildschirm' });
    expect(button).toHaveAttribute('aria-controls', steps.id);
    // Labels as in Apple's German iPhone guide.
    expect(steps).toHaveTextContent('«Teilen» antippen');
    expect(steps).toHaveTextContent('«Zu Home-Bildschirm hinzufügen» wählen');
    expect(steps).toHaveTextContent(
      '«Als Web-App öffnen» einschalten, falls angezeigt, und mit «Hinzufügen» bestätigen.',
    );

    // Escape closes and returns focus to the button.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Schliessen' }), { key: 'Escape' });
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    // A press outside closes it as well.
    fireEvent.click(button);
    expect(screen.getByRole('group')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('shows the steps in English', () => {
    stubNavigator({ userAgent: IPHONE, maxTouchPoints: 5 });
    useUiStore.setState({ lang: 'en' });
    render(<InstallButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    const steps = screen.getByRole('group', { name: 'Add the app to the Home Screen' });
    expect(steps).toHaveTextContent('Choose “Add to Home Screen”');
    expect(steps).toHaveTextContent('Turn on “Open as Web App” if shown, then confirm with “Add”.');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('recognises iPadOS by its touch points, and a Mac without them as a desktop', () => {
    stubNavigator({ userAgent: IPAD_DESKTOP, maxTouchPoints: 5 });
    const { unmount } = render(<InstallButton />);
    expect(screen.getByRole('button', { name: 'Installieren' })).toBeInTheDocument();
    unmount();
    restoreNavigator();

    stubNavigator({ userAgent: IPAD_DESKTOP, maxTouchPoints: 0 });
    const { container } = render(<InstallButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden in the iOS home screen app', () => {
    stubNavigator({ userAgent: IPHONE, maxTouchPoints: 5, standalone: true });
    const { container } = render(<InstallButton />);
    expect(container).toBeEmptyDOMElement();
  });
});
