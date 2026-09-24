import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { CONFIG_STORAGE_KEY, shareConfig, useConfigStore } from './configStore';
import { resetStores } from '../test/utils';

describe('useConfigStore', () => {
  beforeEach(resetStores);

  it('patches one section and keeps the other section objects', () => {
    const before = useConfigStore.getState().config;
    useConfigStore.getState().patch('panels', { tiltFromVertical: 30 });
    const after = useConfigStore.getState().config;
    expect(after.panels.tiltFromVertical).toBe(30);
    expect(after.panels).not.toBe(before.panels);
    expect(after.location).toBe(before.location);
    expect(after.building).toBe(before.building);
    expect(after.weather).toBe(before.weather);
  });

  it('clamps and rounds through sanitizeConfig', () => {
    useConfigStore.getState().patch('building', { numFloors: 99, floorHeight: 123.4 });
    const { building } = useConfigStore.getState().config;
    expect(building.numFloors).toBe(8);
    expect(building.floorHeight).toBe(200);
  });

  it('does not notify subscribers when nothing changes', () => {
    const listener = vi.fn();
    const unsubscribe = useConfigStore.subscribe(listener);
    useConfigStore.getState().patch('panels', { tiltFromVertical: DEFAULT_CONFIG.panels.tiltFromVertical });
    useConfigStore.getState().replace(structuredClone(DEFAULT_CONFIG));
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it('setConfig, replace and reset', () => {
    useConfigStore.getState().setConfig((c) => ({ ...c, economics: { ...c.economics, currency: 'EUR' } }));
    expect(useConfigStore.getState().config.economics.currency).toBe('EUR');
    useConfigStore.getState().replace({ ...DEFAULT_CONFIG, weather: { source: 'clear-sky', year: 2020 } });
    expect(useConfigStore.getState().config.weather).toEqual({ source: 'clear-sky', year: 2020 });
    expect(useConfigStore.getState().config.economics.currency).toBe('CHF');
    useConfigStore.getState().reset();
    expect(useConfigStore.getState().config).toEqual(DEFAULT_CONFIG);
  });

  it('persists the config to localStorage (version 2)', () => {
    useConfigStore.getState().patch('location', { latitude: 46.5 });
    const stored = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) ?? 'null') as {
      state: { config: { location: { latitude: number } } };
      version: number;
    };
    expect(stored.version).toBe(2);
    expect(stored.state.config.location.latitude).toBe(46.5);
  });

  it('shareConfig returns the previous object for equal content', () => {
    const prev = DEFAULT_CONFIG;
    expect(shareConfig(prev, structuredClone(prev))).toBe(prev);
  });
});

describe('persist hydration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function freshStore() {
    const mod = await import('./configStore');
    return mod.useConfigStore;
  }

  it('migrates an old v1 flat config through persist', async () => {
    localStorage.setItem(
      CONFIG_STORAGE_KEY,
      JSON.stringify({
        state: {
          config: {
            latitude: 46.2,
            longitude: 6.15,
            facadeAzimuth: 180,
            balconyHeight: 300,
            railingHeight: 110,
            panelLength: 100,
            panelWidth: 170,
            numPanels: 3,
            numFloors: 4,
            panelTilt: 30,
            panelThickness: 3,
          },
        },
        version: 1,
      }),
    );
    const store = await freshStore();
    const { config } = store.getState();
    expect(config.version).toBe(2);
    expect(config.location.latitude).toBe(46.2);
    expect(config.building).toMatchObject({
      facadeAzimuth: 180,
      floorHeight: 300,
      railingHeight: 110,
      numFloors: 4,
    });
    expect(config.panels).toMatchObject({ length: 100, width: 170, count: 3, tiltFromVertical: 30 });
    expect(config.economics).toEqual(DEFAULT_CONFIG.economics);
  });

  it('sanitizes a stored v2 config', async () => {
    localStorage.setItem(
      CONFIG_STORAGE_KEY,
      JSON.stringify({
        state: { config: { ...DEFAULT_CONFIG, panels: { ...DEFAULT_CONFIG.panels, count: 50 } } },
        version: 2,
      }),
    );
    const store = await freshStore();
    expect(store.getState().config.panels.count).toBe(8);
  });

  it('falls back to defaults for corrupt storage', async () => {
    localStorage.setItem(CONFIG_STORAGE_KEY, '{not json');
    const store = await freshStore();
    expect(store.getState().config).toEqual(DEFAULT_CONFIG);
  });

  it('works when localStorage throws', async () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    vi.stubGlobal('localStorage', throwing);
    const store = await freshStore();
    expect(store.getState().config).toEqual(DEFAULT_CONFIG);
    expect(() => store.getState().patch('panels', { count: 3 })).not.toThrow();
    expect(store.getState().config.panels.count).toBe(3);
  });
});
