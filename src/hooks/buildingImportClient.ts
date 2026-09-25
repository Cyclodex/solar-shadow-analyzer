import type {
  ImportJobInput,
  ImportJobOptions,
  ImportJobProgress,
  ImportJobResult,
} from '../model/buildingImportJob';

// ─────────────────────────────────────────────
// BUILDING-IMPORT WORKER CLIENT (owned by the buildings feature, docs/ARCHITECTURE.md "Umgebung")
// runImport has the signature of model/buildingImportJob.ts runImportJob but runs it in a module worker
// (buildingImport.worker.ts): downloading and decoding the vector tiles, assembling the parts and the
// selection leave the main thread. The job module is not part of the main chunk: the worker bundles it, and
// the fallback in this thread (no Worker support in jsdom tests or old browsers, an injected fetch or tile
// source in tests, or a worker that cannot be started) loads it on first use.
// ─────────────────────────────────────────────

/** Messages to the worker. */
export type ImportWorkerRequest =
  { type: 'run'; id: number; input: ImportJobInput } | { type: 'abort'; id: number };

/** Messages from the worker. */
export type ImportWorkerResponse =
  | { type: 'progress'; id: number; progress: ImportJobProgress }
  | { type: 'result'; id: number; result: ImportJobResult };

interface Job {
  progress: (p: ImportJobProgress) => void;
  resolve: (result: ImportJobResult) => void;
  /** Runs the job in this thread instead (the worker failed). */
  fallback: () => void;
}

let worker: Worker | null = null;
/** The worker could not be started (or failed): run in this thread from now on. */
let unavailable = false;
let nextId = 1;
const jobs = new Map<number, Job>();

function onMessage(event: MessageEvent<ImportWorkerResponse>): void {
  const message = event.data;
  const job = jobs.get(message.id);
  if (!job) return; // aborted meanwhile
  if (message.type === 'progress') job.progress(message.progress);
  else job.resolve(message.result);
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
    worker = new Worker(new URL('./buildingImport.worker.ts', import.meta.url), {
      type: 'module',
      name: 'building-import',
    });
  } catch {
    unavailable = true;
    return null;
  }
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onWorkerError);
  return worker;
}

/** The job in this thread (the module is loaded on first use). */
async function runHere(input: ImportJobInput, opts: ImportJobOptions): Promise<ImportJobResult> {
  try {
    const { runImportJob } = await import('../model/buildingImportJob');
    return await runImportJob(input, opts);
  } catch (e) {
    // The chunk could not be loaded (offline without the service worker's copy).
    if (opts.signal?.aborted)
      return { ok: false, error: { kind: 'aborted', message: 'The import was aborted.' } };
    return { ok: false, error: { kind: 'network', message: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * runImportJob in the building-import worker (same results and progress; resolves { ok: false, error:
 * 'aborted' } as soon as the signal aborts); in this thread when no worker is available or a fetch / tile
 * source is injected (tests: functions cannot be sent to a worker). Never rejects.
 */
export function runImport(input: ImportJobInput, opts: ImportJobOptions = {}): Promise<ImportJobResult> {
  const w = opts.fetchImpl || opts.fetchBuildings ? null : getWorker();
  if (!w) return runHere(input, opts);
  const { signal, onProgress } = opts;
  const abortedResult: ImportJobResult = {
    ok: false,
    error: { kind: 'aborted', message: 'The import was aborted.' },
  };
  if (signal?.aborted) return Promise.resolve(abortedResult);
  return new Promise<ImportJobResult>((resolve) => {
    const id = nextId++;
    const done = (): void => {
      jobs.delete(id);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      done();
      if (worker) worker.postMessage({ type: 'abort', id } satisfies ImportWorkerRequest);
      resolve(abortedResult);
    };
    jobs.set(id, {
      progress: (p) => onProgress?.(p),
      resolve: (result) => {
        done();
        resolve(result);
      },
      fallback: () => {
        done();
        void runHere(input, opts).then(resolve);
      },
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    w.postMessage({ type: 'run', id, input } satisfies ImportWorkerRequest);
  });
}

/** Stops the worker and forgets its state (tests). */
export function resetBuildingImportWorker(): void {
  worker?.terminate();
  worker = null;
  unavailable = false;
  jobs.clear();
}
