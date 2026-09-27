import type { ImportWorkerRequest, ImportWorkerResponse } from './buildingImportClient';
import { createImportWorkerHandler } from './buildingImportWorkerHandler';

// ─────────────────────────────────────────────
// BUILDING-IMPORT WORKER (module worker, started by buildingImportClient.ts; owned by the buildings feature)
// Downloads and decodes the swisstopo vector tiles, assembles the building parts and selects the ones to
// keep (model/buildingImportJob.ts) off the main thread. The tile cache of buildingSources.ts lives here.
// ─────────────────────────────────────────────

/** The parts of DedicatedWorkerGlobalScope used here (the app's TypeScript lib is DOM, not WebWorker). */
interface WorkerScope {
  postMessage(message: ImportWorkerResponse): void;
  onmessage: ((event: MessageEvent<ImportWorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const handle = createImportWorkerHandler((message) => scope.postMessage(message));
scope.onmessage = (event) => handle(event.data);
