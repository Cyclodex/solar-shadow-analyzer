import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_CHECK_MS, scheduleUpdateChecks } from './updates';

function registration(installing: object | null = null) {
  const update = vi.fn(() => Promise.resolve());
  return { update, reg: { installing, update } as unknown as ServiceWorkerRegistration };
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('scheduleUpdateChecks', () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    Reflect.deleteProperty(document, 'visibilityState');
    vi.restoreAllMocks();
  });

  it('checks every hour until stopped', () => {
    const { update, reg } = registration();
    stop = scheduleUpdateChecks(reg);
    vi.advanceTimersByTime(UPDATE_CHECK_MS - 1);
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(update).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('skips a check while offline or while an update is installing', () => {
    const offline = registration();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    stop = scheduleUpdateChecks(offline.reg);
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(offline.update).not.toHaveBeenCalled();
    stop();

    vi.restoreAllMocks();
    const installing = registration({});
    stop = scheduleUpdateChecks(installing.reg);
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(installing.update).not.toHaveBeenCalled();
  });

  it('checks when the app returns to the foreground after at least an interval', () => {
    const { update, reg } = registration();
    stop = scheduleUpdateChecks(reg, 1000);
    setVisibility('visible');
    expect(update).not.toHaveBeenCalled(); // too soon
    vi.setSystemTime(Date.now() + 1000);
    setVisibility('hidden');
    expect(update).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('ignores a failed check (offline, server error)', async () => {
    const update = vi.fn(() => Promise.reject(new TypeError('network')));
    stop = scheduleUpdateChecks({ installing: null, update } as unknown as ServiceWorkerRegistration);
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
