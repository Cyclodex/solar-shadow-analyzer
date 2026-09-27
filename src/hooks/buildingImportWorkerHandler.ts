import { runImportJob } from '../model/buildingImportJob';
import type { ImportWorkerRequest, ImportWorkerResponse } from './buildingImportClient';

// ─────────────────────────────────────────────
// BUILDING-IMPORT WORKER: MESSAGE HANDLER (owned by the buildings feature)
// The worker's logic without the worker scope (buildingImport.worker.ts wires it to `self`), so tests can run
// it in process. One AbortController per running job; an aborted job posts nothing more.
// ─────────────────────────────────────────────

/** The worker yields to its event loop at least this often during the selection, so an abort gets in (ms). */
export const IMPORT_WORKER_SLICE_MS = 30;

/** Message handler of the building-import worker; `run` is the job (tests replace it). */
export function createImportWorkerHandler(
  post: (message: ImportWorkerResponse) => void,
  run: typeof runImportJob = runImportJob,
): (message: ImportWorkerRequest) => void {
  const running = new Map<number, AbortController>();
  return (message) => {
    if (message.type === 'abort') {
      running.get(message.id)?.abort();
      running.delete(message.id);
      return;
    }
    const { id, input } = message;
    const ctrl = new AbortController();
    running.set(id, ctrl);
    let last = performance.now();
    void run(input, {
      signal: ctrl.signal,
      onProgress: (progress) => {
        if (!ctrl.signal.aborted) post({ type: 'progress', id, progress });
      },
      pause: async () => {
        if (performance.now() - last < IMPORT_WORKER_SLICE_MS) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
        last = performance.now();
      },
    })
      .catch((e: unknown): Awaited<ReturnType<typeof runImportJob>> => ({
        ok: false,
        error: { kind: 'decode', message: e instanceof Error ? e.message : String(e) },
      }))
      .then((result) => {
        running.delete(id);
        if (!ctrl.signal.aborted) post({ type: 'result', id, result });
      });
  };
}
