import { encode } from 'fast-png';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DsmJobRequest, DsmJobResult, DsmProgress } from '../model/dsm';
import type { TerrainComputer, TerrainHorizonResult } from '../model/terrain';
import { clearTerrainTileCache } from '../model/terrain';
import type { TerrainWorkerRequest, TerrainWorkerResponse } from './terrainProtocol';
import { computeDsmInWorker, computeTerrainInWorker, resetTerrainWorker } from './terrainClient';
import { createTerrainWorkerHandler, type DsmComputer } from './terrainWorkerHandler';

const result = (h: number): TerrainHorizonResult => ({
  profile: { stepDeg: 90, elevations: [h, h, h, h] },
  siteElevation: 500,
  tiles: 2,
});

/** Controllable stand-ins for the worker's computations. */
let compute: TerrainComputer;
let dsm: DsmComputer;
const workers: FakeWorker[] = [];
const posted: TerrainWorkerRequest[] = [];

/** In-process Worker: the real message handler, messages delivered asynchronously like postMessage. */
class FakeWorker extends EventTarget {
  readonly url: string;
  readonly options?: WorkerOptions;
  private readonly handle: (m: TerrainWorkerRequest) => void;
  private terminated = false;
  constructor(url: URL | string, options?: WorkerOptions) {
    super();
    this.url = String(url);
    this.options = options;
    workers.push(this);
    this.handle = createTerrainWorkerHandler(
      (m: TerrainWorkerResponse) => {
        setTimeout(() => {
          if (!this.terminated) this.dispatchEvent(new MessageEvent('message', { data: m }));
        }, 0);
      },
      compute,
      (request, opts) => dsm(request, opts),
    );
  }
  postMessage(m: TerrainWorkerRequest): void {
    posted.push(m);
    setTimeout(() => this.handle(m), 0);
  }
  terminate(): void {
    this.terminated = true;
  }
}

/** A flat Terrarium tile (0 m everywhere: R = 128). */
function flatTilePng(): Uint8Array {
  const data = new Uint8Array(256 * 256 * 3);
  for (let i = 0; i < data.length; i += 3) data[i] = 128;
  return encode({ width: 256, height: 256, data, channels: 3, depth: 8 });
}

describe('computeTerrainInWorker', () => {
  beforeEach(() => {
    workers.length = 0;
    posted.length = 0;
    resetTerrainWorker();
    clearTerrainTileCache();
    vi.stubGlobal('Worker', FakeWorker);
    compute = async (_lat, _lon, heights, opts) => {
      opts.onProgress?.(0, 2);
      await new Promise((r) => setTimeout(r, 5));
      opts.onProgress?.(2, 2);
      return heights.map(result);
    };
  });
  afterEach(() => {
    resetTerrainWorker();
    vi.unstubAllGlobals();
  });

  it('runs the computation in one module worker and relays progress and results', async () => {
    const progress: [number, number][] = [];
    const r = await computeTerrainInWorker(47, 7, [4, 7], { onProgress: (d, t) => progress.push([d, t]) });
    expect(r).toEqual([result(4), result(7)]);
    expect(progress).toEqual([
      [0, 2],
      [2, 2],
    ]);
    await computeTerrainInWorker(47, 7, [5], {});
    expect(workers).toHaveLength(1); // kept alive: its tile cache serves later jobs
    expect(workers[0].url).toMatch(/\/terrain\.worker\.ts\b/);
    expect(workers[0].options).toMatchObject({ type: 'module' });
    expect(posted.map((m) => m.type)).toEqual(['compute', 'compute']);
  });

  it('rejects at once when aborted and tells the worker to drop the job', async () => {
    const ctrl = new AbortController();
    const progress = vi.fn();
    const run = computeTerrainInWorker(47, 7, [4], { signal: ctrl.signal, onProgress: progress });
    ctrl.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(posted.map((m) => m.type)).toEqual(['compute', 'abort']);
    await new Promise((r) => setTimeout(r, 20));
    expect(progress).not.toHaveBeenCalled();
    const pre = new AbortController();
    pre.abort();
    await expect(computeTerrainInWorker(47, 7, [4], { signal: pre.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('passes errors of the computation on', async () => {
    compute = async () => {
      throw new Error('DEM tile x: HTTP 404');
    };
    await expect(computeTerrainInWorker(47, 7, [4], {})).rejects.toThrow('DEM tile x: HTTP 404');
  });

  it('computes in this thread when the worker script fails, and without Worker support', async () => {
    const png = flatTilePng();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => png.slice().buffer }) as Response),
    );
    compute = () => new Promise(() => {}); // the worker never answers …
    const run = computeTerrainInWorker(47.1, 7.45, [4], {});
    await new Promise((r) => setTimeout(r, 10));
    expect(workers).toHaveLength(1);
    // … because its script failed to load: the pending job and later ones run in this thread.
    workers[0].dispatchEvent(new Event('error', { cancelable: true }));
    const [r] = await run;
    expect(r.siteElevation).toBe(0);
    expect(r.profile.elevations).toHaveLength(360);
    const [r7] = await computeTerrainInWorker(47.1, 7.45, [7], {});
    expect(r7.siteElevation).toBe(0);
    expect(workers).toHaveLength(1);

    resetTerrainWorker();
    vi.stubGlobal('Worker', undefined);
    const [r9] = await computeTerrainInWorker(47.1, 7.45, [9], {});
    expect(r9.siteElevation).toBe(0);
    expect(workers).toHaveLength(1);
  });

  it('computes in this thread with an injected fetch (tests)', async () => {
    const png = flatTilePng();
    const fetchImpl = vi.fn(
      async () => ({ ok: true, status: 200, arrayBuffer: async () => png.slice().buffer }) as Response,
    ) as unknown as typeof fetch;
    const [r] = await computeTerrainInWorker(47.1, 7.45, [4], { fetchImpl });
    expect(r.siteElevation).toBe(0);
    expect(workers).toHaveLength(0);
  });
});

const DSM_STATS: DsmJobResult['stats'] = {
  requests: 0,
  downloaded: 0,
  ms: { stac: 0, download: 0, decode: 0, mask: 0, rays: 0, total: 0 },
};
const DSM_REQUEST: DsmJobRequest = {
  site: {
    latitude: 46.95,
    longitude: 7.45,
    facadeAzimuth: 180,
    radius: 300,
    trees: true,
    masks: null,
    exclusion: { balconyDepthM: 1.5, rowWidthM: 3.5, ownFootprint: null },
  },
  groups: [{ n: 1.9, heights: [4.1, 6.9] }],
};

describe('computeDsmInWorker', () => {
  beforeEach(() => {
    workers.length = 0;
    posted.length = 0;
    resetTerrainWorker();
    vi.stubGlobal('Worker', FakeWorker);
    dsm = async (request, opts) => {
      opts.onProgress?.({ fraction: 0.5, bytes: 10, totalBytes: 20 });
      await new Promise((r) => setTimeout(r, 5));
      return {
        status: 'ok',
        horizons: request.groups.map((g) => g.heights.map(() => ({ stepDeg: 90, elevations: [1, 2, 3, 4] }))),
        info: {
          dataYears: [2023],
          bytes: 20,
          coverage: 1,
          ground: 500,
          groundSource: 'height-service',
          files: 1,
          tiles: 1,
        },
        stats: DSM_STATS,
      };
    };
  });
  afterEach(() => {
    resetTerrainWorker();
    vi.unstubAllGlobals();
  });

  it('runs the job in the terrain worker and relays progress and the result', async () => {
    const progress: DsmProgress[] = [];
    const r = await computeDsmInWorker(DSM_REQUEST, { onProgress: (p) => progress.push(p) });
    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && r.horizons[0]).toHaveLength(2);
    expect(progress).toEqual([{ fraction: 0.5, bytes: 10, totalBytes: 20 }]);
    expect(posted.map((m) => m.type)).toEqual(['dsm']);
    // The same worker as the terrain jobs (its memory keeps the site's rasters).
    compute = async (_lat, _lon, heights) => heights.map(result);
    await computeTerrainInWorker(47, 7, [4], {});
    expect(workers).toHaveLength(1);
  });

  it('rejects at once when aborted and tells the worker to drop the job', async () => {
    const ctrl = new AbortController();
    const run = computeDsmInWorker(DSM_REQUEST, { signal: ctrl.signal });
    ctrl.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(posted.map((m) => m.type)).toEqual(['dsm', 'abort']);
  });

  it('passes an exception of the worker on', async () => {
    dsm = async () => {
      throw new Error('out of memory');
    };
    await expect(computeDsmInWorker(DSM_REQUEST)).rejects.toThrow('out of memory');
  });

  it('runs in this thread with an injected fetch or without Worker support', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    // Outside the scan's extent (Paris): unavailable without a request.
    const paris = { ...DSM_REQUEST, site: { ...DSM_REQUEST.site, latitude: 48.8566, longitude: 2.3522 } };
    expect((await computeDsmInWorker(paris, { fetchImpl })).status).toBe('unavailable');
    expect(workers).toHaveLength(0);
    vi.stubGlobal('Worker', undefined);
    expect((await computeDsmInWorker(paris)).status).toBe('unavailable');
    expect(fetchImpl).not.toHaveBeenCalled();
    const pre = new AbortController();
    pre.abort();
    await expect(computeDsmInWorker(paris, { signal: pre.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
