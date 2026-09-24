import { computeTerrainHorizons, type TerrainComputer } from '../model/terrain';
import type { TerrainWorkerRequest, TerrainWorkerResponse } from './terrainProtocol';

/**
 * Message handler of the terrain worker: runs `compute` (tile download, PNG decoding, horizons) per job and
 * posts progress, the result or the error. An aborted job posts nothing more. The worker stays alive between
 * jobs, so its in-memory tile cache serves later jobs (e.g. new floor heights at the same site).
 */
export function createTerrainWorkerHandler(
  post: (message: TerrainWorkerResponse) => void,
  compute: TerrainComputer = computeTerrainHorizons,
): (message: TerrainWorkerRequest) => void {
  const jobs = new Map<number, AbortController>();
  return (message) => {
    if (message.type === 'abort') {
      jobs.get(message.id)?.abort();
      jobs.delete(message.id);
      return;
    }
    const { id, latitude, longitude, observerHeights } = message;
    const ctrl = new AbortController();
    jobs.set(id, ctrl);
    compute(latitude, longitude, observerHeights, {
      signal: ctrl.signal,
      onProgress: (done, total) => {
        if (!ctrl.signal.aborted) post({ type: 'progress', id, done, total });
      },
    })
      .then(
        (results) => {
          if (!ctrl.signal.aborted) post({ type: 'result', id, results });
        },
        (e: unknown) => {
          if (ctrl.signal.aborted) return;
          const err = e instanceof Error ? e : new Error(String(e));
          post({ type: 'error', id, name: err.name, message: err.message });
        },
      )
      .finally(() => {
        if (jobs.get(id) === ctrl) jobs.delete(id);
      });
  };
}
