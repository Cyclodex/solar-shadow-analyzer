import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDataStore } from './dataStore';
import { TERRAIN_GATE_MAX_MS, holdTerrainDownload, terrainDownloadGate } from './loadGate';

/** 'open' once the gate has resolved, 'waiting' while not. */
async function state(p: Promise<void>): Promise<string> {
  let s = 'waiting';
  p.then(
    () => (s = 'open'),
    () => (s = 'rejected'),
  );
  await vi.advanceTimersByTimeAsync(0);
  return s;
}

describe('terrainDownloadGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDataStore.getState().resetData();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens at once without a running weather request', async () => {
    expect(await state(terrainDownloadGate())).toBe('open');
    useDataStore.getState().setWeather({ status: 'error' });
    expect(await state(terrainDownloadGate())).toBe('open');
  });

  it('waits for the weather request to settle', async () => {
    useDataStore.getState().setWeather({ status: 'loading' });
    const gate = terrainDownloadGate();
    expect(await state(gate)).toBe('waiting');
    useDataStore.getState().setTerrain({ progress: 0.5 }); // other store changes do not open it
    expect(await state(gate)).toBe('waiting');
    useDataStore.getState().setWeather({ status: 'ready' });
    expect(await state(gate)).toBe('open');
  });

  it('waits for held downloads, at most TERRAIN_GATE_MAX_MS', async () => {
    let finish = (): void => {};
    void holdTerrainDownload(new Promise<void>((resolve) => (finish = resolve)));
    const gate = terrainDownloadGate();
    expect(await state(gate)).toBe('waiting');
    finish();
    expect(await state(gate)).toBe('open');
    // A failed download also opens it.
    void holdTerrainDownload(Promise.reject(new Error('chunk'))).catch(() => {});
    expect(await state(terrainDownloadGate())).toBe('open');

    useDataStore.getState().setWeather({ status: 'loading' });
    const slow = terrainDownloadGate();
    await vi.advanceTimersByTimeAsync(TERRAIN_GATE_MAX_MS - 1);
    expect(await state(slow)).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1);
    expect(await state(slow)).toBe('open');
  });

  it('rejects when aborted', async () => {
    useDataStore.getState().setWeather({ status: 'loading' });
    const ctrl = new AbortController();
    const gate = terrainDownloadGate(ctrl.signal);
    ctrl.abort();
    await expect(gate).rejects.toMatchObject({ name: 'AbortError' });
    const pre = new AbortController();
    pre.abort();
    await expect(terrainDownloadGate(pre.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
