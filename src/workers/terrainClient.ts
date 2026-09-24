import { computeTerrainHorizons, type TerrainComputer, type TerrainHorizonResult } from '../model/terrain';
import type { TerrainWorkerRequest, TerrainWorkerResponse } from './terrainProtocol';

// ─────────────────────────────────────────────
// TERRAIN WORKER CLIENT
// computeTerrainInWorker has the signature of model computeTerrainHorizons (TerrainComputer) but runs it
// in a module worker (terrain.worker.ts): tile PNG decoding and the horizon computation (≈ 1 s of main-
// thread work on a slow phone) leave the main thread. The localStorage result cache stays on the page
// (fetchTerrainHorizons; workers have no localStorage). Without Worker support (jsdom tests, old browsers),
// with an injected fetch (tests), or when the worker script cannot be started, the same function runs in
// this thread instead.
// ─────────────────────────────────────────────

interface Job {
  progress: (done: number, total: number) => void;
  resolve: (results: TerrainHorizonResult[]) => void;
  reject: (error: unknown) => void;
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
  const message = event.data;
  const job = jobs.get(message.id);
  if (!job) return; // aborted meanwhile
  if (message.type === 'progress') job.progress(message.done, message.total);
  else if (message.type === 'result') job.resolve(message.results);
  else {
    const error = new Error(message.message);
    error.name = message.name;
    job.reject(error);
  }
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

/**
 * computeTerrainHorizons in the terrain worker (same results, progress and abort behaviour: rejects with the
 * signal's reason as soon as it aborts); in this thread where no worker is available.
 */
export const computeTerrainInWorker: TerrainComputer = (latitude, longitude, observerHeights, opts) => {
  const w = opts.fetchImpl ? null : getWorker();
  if (!w) return computeTerrainHorizons(latitude, longitude, observerHeights, opts);
  const { signal, onProgress } = opts;
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise<TerrainHorizonResult[]>((resolve, reject) => {
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
    jobs.set(id, {
      progress: (d, t) => onProgress?.(d, t),
      resolve: (results) => {
        done();
        resolve(results);
      },
      reject: (error) => {
        done();
        reject(error);
      },
      fallback: () => {
        done();
        computeTerrainHorizons(latitude, longitude, observerHeights, opts).then(resolve, reject);
      },
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    post(w, { type: 'compute', id, latitude, longitude, observerHeights: [...observerHeights] });
  });
};

/** Stops the worker and forgets its state (tests). */
export function resetTerrainWorker(): void {
  worker?.terminate();
  worker = null;
  unavailable = false;
  jobs.clear();
}
