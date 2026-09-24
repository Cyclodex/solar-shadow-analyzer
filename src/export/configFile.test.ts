import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { configToJson, sanitizeConfig } from '../model/share';
import type { Config } from '../model/types';
import {
  CONFIG_FILE_MAX_BYTES,
  configFilename,
  downloadConfigJson,
  parseConfigText,
  readConfigFile,
} from './configFile';

const custom: Config = sanitizeConfig({
  ...DEFAULT_CONFIG,
  location: { ...DEFAULT_CONFIG.location, name: 'Zürich Altstetten', latitude: 47.391, longitude: 8.489 },
  building: { ...DEFAULT_CONFIG.building, numFloors: 4, facadeAzimuth: 170 },
  horizon: {
    terrainEnabled: false,
    obstacles: [
      { id: 'o1', name: 'Nachbar', offsetAlong: 3, distance: 25, width: 20, depth: 12, height: 15 },
    ],
    manual: [
      { azimuth: 90, elevation: 5 },
      { azimuth: 180, elevation: 8.5 },
    ],
  },
  economics: { ...DEFAULT_CONFIG.economics, currency: 'EUR', electricityPrice: 0.3214 },
});

const file = (text: string, name = 'config.json'): File =>
  new File([text], name, { type: 'application/json' });

describe('config JSON file', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips a configuration through export and import', async () => {
    const result = await readConfigFile(file(configToJson(custom)));
    expect(result).toEqual({ ok: true, config: custom });
  });

  it('downloads the configuration as JSON with a localised name', async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
      blobs.push(b as Blob);
      return 'blob:config';
    });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    downloadConfigJson(custom, 'de');
    expect(names).toEqual(['verschattung-konfiguration-Zurich-Altstetten.json']);
    expect(blobs[0].type).toContain('application/json');
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blobs[0]);
    });
    expect(await readConfigFile(file(text))).toEqual({ ok: true, config: custom });
    expect(configFilename(custom, 'en')).toBe('shading-configuration-Zurich-Altstetten.json');
  });

  it('rejects invalid files with a specific error', async () => {
    expect(await readConfigFile(file('not json at all'))).toEqual({ ok: false, error: 'invalid' });
    expect(await readConfigFile(file('{"hello": "world"}'))).toEqual({ ok: false, error: 'invalid' });
    expect(await readConfigFile(file('[1, 2, 3]'))).toEqual({ ok: false, error: 'invalid' });
    expect(await readConfigFile(file(''))).toEqual({ ok: false, error: 'empty' });
    expect(parseConfigText('   ')).toEqual({ ok: false, error: 'empty' });
    const huge = new File(['x'.repeat(CONFIG_FILE_MAX_BYTES + 1)], 'huge.json');
    expect(await readConfigFile(huge)).toEqual({ ok: false, error: 'too-large' });
    const broken = { size: 10, text: () => Promise.reject(new Error('io')) } as unknown as Blob;
    expect(await readConfigFile(broken)).toEqual({ ok: false, error: 'unreadable' });
  });

  it('sanitises imported values and accepts flat v1 exports', async () => {
    const wild = JSON.stringify({
      version: 2,
      building: { numFloors: 99 },
      panels: { tiltFromVertical: -5 },
    });
    const r1 = await readConfigFile(file(`\uFEFF${wild}`));
    expect(r1.ok && r1.config.building.numFloors).toBe(8);
    expect(r1.ok && r1.config.panels.tiltFromVertical).toBe(0);

    const v1 = JSON.stringify({ latitude: 46.5, longitude: 6.6, numFloors: 3, panelTilt: 30 });
    const r2 = await readConfigFile(file(v1));
    expect(r2.ok && r2.config.location.latitude).toBe(46.5);
    expect(r2.ok && r2.config.panels.tiltFromVertical).toBe(30);
  });
});
