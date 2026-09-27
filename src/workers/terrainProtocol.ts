import type { DsmJobRequest, DsmJobResult, DsmProgress } from '../model/dsm';
import type { TerrainHorizonResult } from '../model/terrain';

// ─────────────────────────────────────────────
// TERRAIN WORKER PROTOCOL
// Messages between the page (terrainClient.ts) and the terrain worker (terrain.worker.ts). One job per
// computeTerrainHorizons call ('compute') or laser-scan job ('dsm', model/dsm.ts computeDsmJob), identified by
// `id`; the page may abort a job, the worker then drops it. The worker keeps what the jobs loaded in memory
// (terrain tiles; scan headers, tiles and rasters of the last site), so later jobs of the same site (new floor
// heights, new observers after a tilt change, new masks) do not refetch.
// ─────────────────────────────────────────────

/** Page → worker. */
export type TerrainWorkerRequest =
  | { type: 'compute'; id: number; latitude: number; longitude: number; observerHeights: number[] }
  | { type: 'dsm'; id: number; request: DsmJobRequest }
  | { type: 'abort'; id: number };

/** Worker → page. */
export type TerrainWorkerResponse =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; results: TerrainHorizonResult[] }
  | { type: 'dsm-progress'; id: number; progress: DsmProgress }
  | { type: 'dsm-result'; id: number; result: DsmJobResult }
  | { type: 'error'; id: number; name: string; message: string };
