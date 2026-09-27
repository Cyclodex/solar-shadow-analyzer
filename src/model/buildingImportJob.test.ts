import { describe, expect, it, vi } from 'vitest';
import type { BuildingFetchResult, BuildingPart } from './buildingSources';
import { runImportJob, type ImportJobInput, type ImportJobProgress } from './buildingImportJob';
import { enuToLonLat } from './enu';
import { pointInRing } from './polygon';

const SITE = { latitude: 46.958474, longitude: 7.45363 };

const rect = (x0: number, y0: number, w: number, d: number, height: number): BuildingPart => ({
  footprint: [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + d],
    [x0, y0 + d],
  ],
  height,
  minHeight: 0,
  kind: null,
});

/** Own part around the import point, two adjoining parts, a street row in front (south), one far and high. */
function parts(): BuildingPart[] {
  const out = [rect(-6, -2, 12, 12, 18), rect(-18, -2, 12, 12, 16), rect(6, -2, 12, 12, 20)];
  for (let k = 0; k < 8; k++) out.push(rect(-40 + 10 * k, -25, 9, 10, 10 + k));
  out.push(rect(-5, -140, 20, 20, 30));
  return out;
}

const ok = (over: Partial<Extract<BuildingFetchResult, { ok: true }>> = {}): BuildingFetchResult => ({
  ok: true,
  parts: parts(),
  attribution: '© swisstopo',
  tileCount: 2,
  bytes: 300_000,
  covered: true,
  coverage: 1,
  mergedPieces: 0,
  ...over,
});

const INPUT: ImportJobInput = {
  ...SITE,
  radius: 300,
  probeOwn: false,
  location: SITE,
  facadeAzimuth: 180,
  observers: { heights: [2.1, 4.9, 7.7], offsets: [1.5, 2.35], top: 9 },
  maxBuildings: 120,
  maxVertices: 1600,
};

describe('runImportJob', () => {
  it('keeps the own part first, then adjoining parts, horizon setters and context; reports progress', async () => {
    const progress: ImportJobProgress[] = [];
    const fetchBuildings = vi.fn(async (...args: unknown[]) => {
      const opts = args[3] as { onProgress?: (d: number, t: number, b: number) => void };
      opts.onProgress?.(2, 2, 300_000);
      return ok();
    });
    const r = await runImportJob(INPUT, { fetchBuildings, onProgress: (p) => progress.push(p) });
    if (!r.ok || !r.covered) throw new Error('expected a covered result');
    expect(fetchBuildings.mock.calls[0].slice(0, 3)).toEqual([SITE.latitude, SITE.longitude, 300]);
    expect(r.found).toBe(12);
    expect(r.kept[0].reason).toBe('own');
    expect(pointInRing(r.kept[0].footprint, 0, 0)).toBe(true);
    expect(r.kept.slice(1, 3).map((k) => k.reason)).toEqual(['adjoining', 'adjoining']);
    expect(r.kept.some((k) => k.reason === 'horizon' && k.height === 30)).toBe(true);
    expect(r.selectMs).toBeGreaterThanOrEqual(0);
    expect(progress[0]).toEqual({ phase: 'tiles', done: 2, total: 2, bytes: 300_000 });
    expect(progress.at(-1)?.phase).toBe('select');
    expect(progress.at(-1)?.done).toBe(progress.at(-1)?.total);
  });

  it('honours the room left by the buildings entered by hand (priority order)', async () => {
    const r = await runImportJob({ ...INPUT, maxBuildings: 3 }, { fetchBuildings: async () => ok() });
    if (!r.ok || !r.covered) throw new Error('expected a covered result');
    expect(r.kept.map((k) => k.reason)).toEqual(['own', 'adjoining', 'adjoining']);
    expect(r.droppedSetters).toBeGreaterThan(0);
    expect(r.maxDroppedScore).toBeGreaterThan(0);
  });

  it('«Gebäude laden»: the part behind the configured facade origin is the own one', async () => {
    // Location on the south wall of the west neighbour (y = −2), facade south: the probe lies 0.5 m north.
    const location = enuToLonLat(SITE, -12, -2);
    const r = await runImportJob(
      { ...INPUT, probeOwn: true, location },
      { fetchBuildings: async () => ok() },
    );
    if (!r.ok || !r.covered) throw new Error('expected a covered result');
    expect(pointInRing(r.kept[0].footprint, -12, 0)).toBe(true);
  });

  it('outside CH/FL, errors and aborts come back as data', async () => {
    const outside = await runImportJob(INPUT, {
      fetchBuildings: async () => ok({ covered: false, coverage: 0, parts: [] }),
    });
    expect(outside).toEqual({
      ok: true,
      covered: false,
      coverage: 0,
      attribution: '© swisstopo',
      tileCount: 2,
      bytes: 300_000,
    });
    const failed = await runImportJob(INPUT, {
      fetchBuildings: async () => ({
        ok: false,
        error: { kind: 'timeout', message: 'slow' },
        tileCount: 2,
        bytes: 0,
      }),
    });
    expect(failed).toEqual({ ok: false, error: { kind: 'timeout', message: 'slow' } });
    const ctrl = new AbortController();
    ctrl.abort();
    const never = vi.fn();
    expect(await runImportJob(INPUT, { signal: ctrl.signal, fetchBuildings: never })).toMatchObject({
      ok: false,
      error: { kind: 'aborted' },
    });
    expect(never).not.toHaveBeenCalled();
    const broken = await runImportJob(INPUT, {
      fetchBuildings: async () => ok({ parts: [{ ...rect(0, 0, 1, 1, 5), footprint: null as never }] }),
    });
    expect(broken).toMatchObject({ ok: false, error: { kind: 'decode' } });
  });
});
