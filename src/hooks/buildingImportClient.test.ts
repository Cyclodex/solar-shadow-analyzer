import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildingFetchResult } from '../model/buildingSources';
import type { ImportJobInput, ImportJobResult, runImportJob } from '../model/buildingImportJob';
import {
  resetBuildingImportWorker,
  runImport,
  type ImportWorkerRequest,
  type ImportWorkerResponse,
} from './buildingImportClient';
import { createImportWorkerHandler } from './buildingImportWorkerHandler';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../model/buildingSources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../model/buildingSources')>()),
  fetchSwisstopoBuildings: fetchMock,
}));

const INPUT: ImportJobInput = {
  latitude: 46.958474,
  longitude: 7.45363,
  radius: 300,
  probeOwn: false,
  location: { latitude: 46.958474, longitude: 7.45363 },
  facadeAzimuth: 180,
  observers: { heights: [2, 4.8], offsets: [1.5, 2.3], top: 6 },
  maxBuildings: 120,
  maxVertices: 1600,
};

const RESULT: ImportJobResult = {
  ok: true,
  covered: false,
  coverage: 0,
  attribution: '© swisstopo',
  tileCount: 1,
  bytes: 1000,
};

/** Controllable stand-in for the worker's job. */
let job: typeof runImportJob;
const workers: FakeWorker[] = [];
const posted: ImportWorkerRequest[] = [];

/** In-process Worker: the real message handler, messages delivered asynchronously like postMessage. */
class FakeWorker extends EventTarget {
  readonly url: string;
  readonly options?: WorkerOptions;
  private readonly handle: (m: ImportWorkerRequest) => void;
  private terminated = false;
  constructor(url: URL | string, options?: WorkerOptions) {
    super();
    this.url = String(url);
    this.options = options;
    workers.push(this);
    this.handle = createImportWorkerHandler((m: ImportWorkerResponse) => {
      setTimeout(() => {
        if (!this.terminated) this.dispatchEvent(new MessageEvent('message', { data: m }));
      }, 0);
    }, job);
  }
  postMessage(m: ImportWorkerRequest): void {
    posted.push(m);
    setTimeout(() => this.handle(m), 0);
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('runImport (building-import worker client)', () => {
  beforeEach(() => {
    workers.length = 0;
    posted.length = 0;
    fetchMock.mockReset();
    resetBuildingImportWorker();
    vi.stubGlobal('Worker', FakeWorker);
    job = async (_input, opts = {}) => {
      opts.onProgress?.({ phase: 'tiles', done: 1, total: 2, bytes: 500 });
      await new Promise((r) => setTimeout(r, 5));
      opts.onProgress?.({ phase: 'tiles', done: 2, total: 2, bytes: 1000 });
      return RESULT;
    };
  });
  afterEach(() => {
    resetBuildingImportWorker();
    vi.unstubAllGlobals();
  });

  it('runs the job in one module worker and relays progress and the result', async () => {
    const progress: number[] = [];
    const r = await runImport(INPUT, { onProgress: (p) => progress.push(p.done) });
    expect(r).toEqual(RESULT);
    expect(progress).toEqual([1, 2]);
    await runImport(INPUT);
    expect(workers).toHaveLength(1);
    expect(workers[0].url).toMatch(/buildingImport\.worker/);
    expect(workers[0].options?.type).toBe('module');
    expect(posted.map((m) => m.type)).toEqual(['run', 'run']);
    expect(fetchMock).not.toHaveBeenCalled(); // not in this thread
  });

  it('an abort resolves at once, stops the job in the worker and drops its late messages', async () => {
    let seen: AbortSignal | undefined;
    job = async (_input, opts = {}) => {
      seen = opts.signal;
      await new Promise((r) => setTimeout(r, 20));
      opts.onProgress?.({ phase: 'select', done: 1, total: 1, bytes: 0 });
      return RESULT;
    };
    const ctrl = new AbortController();
    const progress = vi.fn();
    const run = runImport(INPUT, { signal: ctrl.signal, onProgress: progress });
    await new Promise((r) => setTimeout(r, 5));
    ctrl.abort();
    expect(await run).toMatchObject({ ok: false, error: { kind: 'aborted' } });
    await new Promise((r) => setTimeout(r, 40));
    expect(posted.map((m) => m.type)).toEqual(['run', 'abort']);
    expect(seen?.aborted).toBe(true);
    expect(progress).not.toHaveBeenCalled();
    const already = new AbortController();
    already.abort();
    expect(await runImport(INPUT, { signal: already.signal })).toMatchObject({ error: { kind: 'aborted' } });
  });

  it('runs in this thread with an injected tile source, without Worker support, or after a worker error', async () => {
    const fetchBuildings = vi.fn(async (): Promise<BuildingFetchResult> => ({
      ok: true,
      parts: [],
      attribution: '© swisstopo',
      tileCount: 1,
      bytes: 10,
      covered: false,
      coverage: 0,
      mergedPieces: 0,
    }));
    expect(await runImport(INPUT, { fetchBuildings })).toMatchObject({ ok: true, covered: false, bytes: 10 });
    expect(fetchBuildings).toHaveBeenCalledTimes(1);
    expect(workers).toHaveLength(0);

    // A worker whose script fails: the pending job finishes here (the real job with the mocked tile source).
    fetchMock.mockResolvedValue({
      ok: false,
      error: { kind: 'http', message: 'HTTP 503', status: 503 },
      tileCount: 1,
      bytes: 0,
    });
    job = () => new Promise<ImportJobResult>(() => {}); // never answers
    const pending = runImport(INPUT);
    await new Promise((r) => setTimeout(r, 5));
    workers[0].dispatchEvent(new Event('error'));
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'http', status: 503 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await runImport(INPUT)).toMatchObject({ error: { kind: 'http' } }); // stays in this thread
    expect(workers).toHaveLength(1);

    resetBuildingImportWorker();
    vi.unstubAllGlobals();
    vi.stubGlobal('Worker', undefined);
    expect(await runImport(INPUT)).toMatchObject({ error: { kind: 'http' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
