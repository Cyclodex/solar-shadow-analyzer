import type { TerrainHorizonResult } from '../model/terrain';

// ─────────────────────────────────────────────
// TERRAIN WORKER PROTOCOL
// Messages between the page (terrainClient.ts) and the terrain worker (terrain.worker.ts). One job per
// computeTerrainHorizons call, identified by `id`; the page may abort a job, the worker then drops it.
// ─────────────────────────────────────────────

/** Page → worker. */
export type TerrainWorkerRequest =
  | { type: 'compute'; id: number; latitude: number; longitude: number; observerHeights: number[] }
  | { type: 'abort'; id: number };

/** Worker → page. */
export type TerrainWorkerResponse =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; results: TerrainHorizonResult[] }
  | { type: 'error'; id: number; name: string; message: string };
