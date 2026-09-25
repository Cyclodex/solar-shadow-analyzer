import { computeDsmJob, type DsmJobRequest, type DsmJobResult, type DsmProgress } from '../model/dsm';
import { computeTerrainHorizons, type TerrainComputer, type TerrainHorizonResult } from '../model/terrain';
import type { TerrainWorkerRequest, TerrainWorkerResponse } from './terrainProtocol';

// ─────────────────────────────────────────────
// TERRAIN WORKER CLIENT
// computeTerrainInWorker has the signature of model computeTerrainHorizons (TerrainComputer) but runs it
// in a module worker (terrain.worker.ts): tile PNG decoding and the horizon computation (≈ 1 s of main-
// thread work on a slow phone) leave the main thread. computeDsmInWorker does the same for the laser-scan
// horizons (model/dsm.ts computeDsmJob: COG decoding, masks, ray marching); the worker keeps the scan rasters
// of the last site, so later jobs with other observers or masks do not refetch. The localStorage result caches
// stay on the page (workers have no localStorage). Without Worker support (jsdom tests, old browsers), with an
// injected fetch (tests), or when the worker script cannot be started, the same functions run in this thread.
// ─────────────────────────────────────────────

interface Job {
  /** A message of the worker for this job. */
  receive: (message: TerrainWorkerResponse) => void;
  /** Runs the job in this thread instead (the worker failed). */
  fallback: () => void;
}

let worker: Worker | null = null;
/** The worker could not be started (or failed): compute in this thread from now on. */
let unavailable = false;
let nextId = 1;
const jobs = new Map<number, Job>();

function post(w: Worker, message: TerrainWorkerRequest): void {
  w.postMessage(message);
}

function onMessage(event: MessageEvent<TerrainWorkerResponse>): void {
  jobs.get(event.data.id)?.receive(event.data); // absent: aborted meanwhile
}

/** The worker script failed to load or crashed: finish the pending jobs in this thread. */
function onWorkerError(event: Event): void {
  event.preventDefault();
  unavailable = true;
  worker?.terminate();
  worker = null;
  const pending = [...jobs.values()];
  jobs.clear();
  pending.forEach((job) => job.fallback());
}

function getWorker(): Worker | null {
  if (worker || unavailable) return worker;
  if (typeof Worker === 'undefined') {
    unavailable = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module', name: 'terrain' });
  } catch {
    unavailable = true;
    return null;
  }
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onWorkerError);
  return worker;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function workerError(message: { name: string; message: string }): Error {
  const error = new Error(message.message);
  error.name = message.name;
  return error;
}

/**
 * Posts a job to `w` and settles with what `receive` makes of the worker's messages; rejects with the
 * signal's reason as soon as it aborts (and tells the worker to drop the job); `fallback` computes it here.
 */
function runJob<T>(
  w: Worker,
  signal: AbortSignal | undefined,
  request: (id: number) => TerrainWorkerRequest,
  receive: (message: TerrainWorkerResponse, resolve: (v: T) => void, reject: (e: unknown) => void) => void,
  fallback: () => Promise<T>,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const id = nextId++;
    const done = (): void => {
      jobs.delete(id);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      done();
      if (worker) post(worker, { type: 'abort', id });
      reject(abortReason(signal as AbortSignal));
    };
    const settle = (v: T): void => {
      done();
      resolve(v);
    };
    const fail = (e: unknown): void => {
      done();
      reject(e);
    };
    jobs.set(id, {
      receive: (message) => receive(message, settle, fail),
      fallback: () => {
        done();
        fallback().then(resolve, reject);
      },
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    post(w, request(id));
  });
}

/**
 * computeTerrainHorizons in the terrain worker (same results, progress and abort behaviour: rejects with the
 * signal's reason as soon as it aborts); in this thread where no worker is available.
 */
export const computeTerrainInWorker: TerrainComputer = (latitude, longitude, observerHeights, opts) => {
  const w = opts.fetchImpl ? null : getWorker();
  if (!w) return computeTerrainHorizons(latitude, longitude, observerHeights, opts);
  const { signal, onProgress } = opts;
  return runJob<TerrainHorizonResult[]>(
    w,
    signal,
    (id) => ({ type: 'compute', id, latitude, longitude, observerHeights: [...observerHeights] }),
    (message, resolve, reject) => {
      if (message.type === 'progress') onProgress?.(message.done, message.total);
      else if (message.type === 'result') resolve(message.results);
      else if (message.type === 'error') reject(workerError(message));
    },
    () => computeTerrainHorizons(latitude, longitude, observerHeights, opts),
  );
};

export interface DsmWorkerOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DsmProgress) => void;
  /** fetch for tests: the job then runs in this thread. */
  fetchImpl?: typeof fetch;
}

/** computeDsmJob here, rejecting with the signal's reason when it aborts (like the worker path). */
function dsmHere(request: DsmJobRequest, opts: DsmWorkerOptions): Promise<DsmJobResult> {
  const { signal } = opts;
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise<DsmJobResult>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal as AbortSignal));
    signal?.addEventListener('abort', onAbort, { once: true });
    computeDsmJob(request, opts).then(
      (r) => {
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) reject(abortReason(signal));
        else resolve(r);
      },
      (e: unknown) => {
        signal?.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Laser-scan horizons (model/dsm.ts computeDsmJob) in the terrain worker, whose memory keeps the site's
 * rasters between jobs. Resolves with the typed result (ok / unavailable / error); rejects with the signal's
 * reason as soon as it aborts. In this thread where no worker is available or a fetch is injected.
 */
export function computeDsmInWorker(
  request: DsmJobRequest,
  opts: DsmWorkerOptions = {},
): Promise<DsmJobResult> {
  const w = opts.fetchImpl ? null : getWorker();
  if (!w) return dsmHere(request, opts);
  return runJob<DsmJobResult>(
    w,
    opts.signal,
    (id) => ({ type: 'dsm', id, request }),
    (message, resolve, reject) => {
      if (message.type === 'dsm-progress') opts.onProgress?.(message.progress);
      else if (message.type === 'dsm-result') resolve(message.result);
      else if (message.type === 'error') reject(workerError(message));
    },
    () => dsmHere(request, opts),
  );
}

/** Stops the worker and forgets its state (tests). */
export function resetTerrainWorker(): void {
  worker?.terminate();
  worker = null;
  unavailable = false;
  jobs.clear();
}
