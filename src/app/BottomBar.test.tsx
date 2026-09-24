import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { useConfigStore } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { BottomBar, TIME_STEP } from './BottomBar';

const bar = (name = 'Schnellsteuerung'): HTMLElement => screen.getByRole('region', { name });

describe('BottomBar', () => {
  beforeEach(resetStores);

  it(`shows the clock time; −/+ step by ${TIME_STEP} min on the ${TIME_STEP}-min grid and stop the animation`, () => {
    render(<BottomBar />);
    const region = bar();
    expect(within(region).getByRole('button', { name: /^Uhrzeit 12:00/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    const later = within(region).getByRole('button', { name: '15 Minuten später' });
    const earlier = within(region).getByRole('button', { name: '15 Minuten früher' });
    fireEvent.click(later);
    expect(useTimeStore.getState().minutes).toBe(735);
    fireEvent.click(earlier);
    fireEvent.click(earlier);
    expect(useTimeStore.getState().minutes).toBe(705);
    expect(within(region).getByRole('button', { name: /^Uhrzeit 11:45/ })).toBeInTheDocument();

    // Fractional minutes of the animation snap to the grid.
    act(() => useTimeStore.setState({ minutes: 722.4, playing: true }));
    fireEvent.click(later);
    expect(useTimeStore.getState()).toMatchObject({ minutes: 735, playing: false });
    act(() => useTimeStore.setState({ minutes: 722.4 }));
    fireEvent.click(earlier);
    expect(useTimeStore.getState().minutes).toBe(720);

    // Clamped to the day.
    act(() => useTimeStore.setState({ minutes: 1440 }));
    fireEvent.click(later);
    expect(useTimeStore.getState().minutes).toBe(1440);
    act(() => useTimeStore.setState({ minutes: 0 }));
    fireEvent.click(earlier);
    expect(useTimeStore.getState().minutes).toBe(0);
  });

  it('play/pause toggles the animation', () => {
    render(<BottomBar />);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Tagesverlauf abspielen' }));
    expect(useTimeStore.getState().playing).toBe(true);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Animation anhalten' }));
    expect(useTimeStore.getState().playing).toBe(false);
  });

  it('the clock and tilt buttons open their slider (one at a time)', () => {
    render(<BottomBar />);
    const region = bar();
    const clock = within(region).getByRole('button', { name: /^Uhrzeit/ });
    const tilt = within(region).getByRole('button', { name: 'Panelneigung θ 45°' });
    expect(within(region).queryByRole('slider')).toBeNull();

    fireEvent.click(clock);
    expect(clock).toHaveAttribute('aria-expanded', 'true');
    const time = within(region).getByRole('slider', { name: 'Uhrzeit (Ortszeit)' });
    expect(document.getElementById(clock.getAttribute('aria-controls') ?? '')).toContainElement(time);
    expect(time).toHaveAttribute('aria-valuetext', expect.stringMatching(/^12:00 \(/));
    fireEvent.change(time, { target: { value: '900' } });
    expect(useTimeStore.getState().minutes).toBe(900);

    fireEvent.click(tilt);
    expect(clock).toHaveAttribute('aria-expanded', 'false');
    expect(tilt).toHaveAttribute('aria-expanded', 'true');
    expect(within(region).queryByRole('slider', { name: 'Uhrzeit (Ortszeit)' })).toBeNull();
    const tiltSlider = within(region).getByRole('slider', { name: 'Neigung θ ab Senkrechte' });
    expect(tiltSlider).toHaveAttribute('aria-valuetext', '45°');
    fireEvent.change(tiltSlider, { target: { value: '60' } });
    expect(useConfigStore.getState().config.panels.tiltFromVertical).toBe(60);
    expect(within(region).getByRole('button', { name: 'Panelneigung θ 60°' })).toBeInTheDocument();

    fireEvent.click(tilt);
    expect(within(region).queryByRole('slider')).toBeNull();
  });

  it('"Springe zu" scrolls to and focuses a region without changing the share hash', () => {
    const hash = '#c=abc';
    history.replaceState(null, '', `/${hash}`);
    const scrollIntoView = vi.fn();
    render(
      <>
        <div id="settings" tabIndex={-1} />
        <BottomBar />
      </>,
    );
    const settings = document.getElementById('settings') as HTMLElement;
    settings.scrollIntoView = scrollIntoView;
    const toggle = within(bar()).getByRole('button', { name: 'Springe zu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const nav = screen.getByRole('navigation', { name: 'Springe zu' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Ergebnisse', 'Ansichten (3D)', 'Zeitpunkt und Neigung', 'Analyse', 'Einstellungen']);

    fireEvent.click(within(nav).getByRole('link', { name: 'Einstellungen' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    expect(document.activeElement).toBe(settings);
    expect(location.hash).toBe(hash);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('Escape closes the menu and returns the focus to its button', () => {
    render(<BottomBar />);
    const toggle = within(bar()).getByRole('button', { name: 'Springe zu' });
    fireEvent.click(toggle);
    const link = screen.getByRole('link', { name: 'Analyse' });
    link.focus();
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(toggle);
  });

  it('publishes its height for the page padding and removes it when unmounted', () => {
    const { unmount } = render(<BottomBar />);
    expect(document.documentElement.style.getPropertyValue('--bottom-bar-h')).toMatch(/^\d+px$/);
    unmount();
    expect(document.documentElement.style.getPropertyValue('--bottom-bar-h')).toBe('');
  });

  it('measures again when its border box or the bottom safe-area inset changes', () => {
    const observed: [Element, ResizeObserverOptions | undefined][] = [];
    let notify = (): void => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          notify = () => cb([], this as unknown as ResizeObserver);
        }
        observe(el: Element, options?: ResizeObserverOptions): void {
          observed.push([el, options]);
        }
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    render(<BottomBar />);
    const region = bar();
    // The bar's border box (its padding grows by the inset on phones) and a probe of the inset's height
    // (the floating dock only moves up by it).
    expect(observed).toHaveLength(2);
    expect(observed[0]).toEqual([region, { box: 'border-box' }]);
    const probe = observed[1][0];
    expect(region).toContainElement(probe as HTMLElement);
    expect(probe).toHaveAttribute('aria-hidden', 'true');

    const rect = vi.spyOn(region, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ height: 95 }));
    onTestFinished(() => rect.mockRestore());
    act(notify);
    expect(document.documentElement.style.getPropertyValue('--bottom-bar-h')).toBe('95px');
  });

  it('English texts', () => {
    useUiStore.getState().setLang('en');
    render(<BottomBar />);
    const region = bar('Quick controls');
    expect(within(region).getByRole('button', { name: '15 minutes later' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Play the day' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Panel tilt θ 45°' })).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Jump to' }));
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });
});
