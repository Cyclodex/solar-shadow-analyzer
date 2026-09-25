import { describe, expect, it } from 'vitest';
import type { Config, HorizonProfile } from './types';
import { DEFAULT_CONFIG } from './defaults';
import { dsmFloorHorizons, hashString, surfaceObserverKey, surfaceSiteKey } from './dsmHorizon';

const profile = (v: number): HorizonProfile => ({ stepDeg: 90, elevations: [v, v, v, v] });

describe('surfaceObserverKey', () => {
  it('n and z of the panel-row centre in cm', () => {
    expect(surfaceObserverKey({ n: 1.93456, z: 5.1 })).toBe('1.93:5.10');
    expect(surfaceObserverKey({ n: 0, z: 12 })).toBe('0.00:12.00');
  });
});

describe('dsmFloorHorizons', () => {
  const horizons = { '1.90:5.00': profile(10), '1.90:7.80': profile(20), bogus: profile(99) };

  it('takes the exact observer, else the nearest one, else null', () => {
    const got = dsmFloorHorizons(horizons, [
      { center: { u: 0, n: 1.9, z: 5 } },
      { center: { u: 0, n: 1.95, z: 7.7 } },
    ]);
    expect(got).toEqual([profile(10), profile(20)]);
    expect(dsmFloorHorizons({}, [{ center: { u: 0, n: 1.9, z: 5 } }])).toEqual([null]);
  });
});

describe('surfaceSiteKey', () => {
  const with_ = (patch: (c: Config) => void): string => {
    const c = structuredClone(DEFAULT_CONFIG);
    patch(c);
    return surfaceSiteKey(c);
  };
  const base = surfaceSiteKey(DEFAULT_CONFIG);

  it('changes with everything the scan horizons depend on besides the observers', () => {
    const changed = [
      with_((c) => (c.location.latitude = 46.947849)),
      with_((c) => (c.building.facadeAzimuth = 180)),
      with_((c) => (c.building.balconyDepth = 200)),
      with_((c) => (c.panels.count = 4)),
      with_((c) => (c.horizon.surfaceModel.trees = false)),
      with_((c) => (c.horizon.surfaceModel.radius = 450)),
      with_((c) => {
        c.horizon.buildingImport = { latitude: 47.1, longitude: 7.45, radius: 300, date: '' };
        c.horizon.buildings = [
          {
            id: 'b1',
            name: '',
            footprint: [
              [0, 10],
              [5, 10],
              [5, 15],
            ],
            base: 0,
            height: 9,
            source: 'swisstopo',
            removed: true,
          },
        ];
      }),
    ];
    for (const k of changed) expect(k).not.toBe(base);
    expect(new Set(changed).size).toBe(changed.length);
  });

  it('ignores what the observers or other horizons cover (tilt, floors, obstacles, enabled flag)', () => {
    expect(with_((c) => (c.panels.tiltFromVertical = 10))).toBe(base);
    expect(with_((c) => (c.building.numFloors = 5))).toBe(base);
    expect(with_((c) => (c.horizon.surfaceModel.enabled = true))).toBe(base);
    expect(with_((c) => (c.horizon.terrainEnabled = false))).toBe(base);
    // Buildings that are neither removed nor edited do not touch the scan.
    expect(
      with_((c) => {
        c.horizon.buildingImport = { latitude: 47.1, longitude: 7.45, radius: 300, date: '' };
        c.horizon.buildings = [
          {
            id: 'b1',
            name: '',
            footprint: [
              [0, 10],
              [5, 10],
              [5, 15],
            ],
            base: 0,
            height: 9,
            source: 'manual',
          },
        ];
      }),
    ).toBe(base);
  });

  it('hashString: FNV-1a 32-bit', () => {
    expect(hashString('')).toBe('811c9dc5');
    expect(hashString('a')).toBe('e40c292c');
    expect(hashString('foobar')).toBe('bf9cf968');
  });
});
