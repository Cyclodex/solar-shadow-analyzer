import type { TerrainWorkerRequest, TerrainWorkerResponse } from './terrainProtocol';
import { createTerrainWorkerHandler } from './terrainWorkerHandler';

// ─────────────────────────────────────────────
// TERRAIN WORKER (module worker, started by terrainClient.ts)
// Downloads and decodes the DEM tiles (fast-png) and computes the terrain horizons off the main thread.
// ─────────────────────────────────────────────

/** The parts of DedicatedWorkerGlobalScope used here (the app's TypeScript lib is DOM, not WebWorker). */
interface WorkerScope {
  postMessage(message: TerrainWorkerResponse): void;
  onmessage: ((event: MessageEvent<TerrainWorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const handle = createTerrainWorkerHandler((message) => scope.postMessage(message));
scope.onmessage = (event) => handle(event.data);
