import { computeDsmJob, type DsmJobOptions, type DsmJobRequest, type DsmJobResult } from '../model/dsm';
import { computeTerrainHorizons, type TerrainComputer } from '../model/terrain';
import type { TerrainWorkerRequest, TerrainWorkerResponse } from './terrainProtocol';

/** A laser-scan job runner (model/dsm.ts computeDsmJob; tests pass a stand-in). */
export type DsmComputer = (request: DsmJobRequest, opts: DsmJobOptions) => Promise<DsmJobResult>;

/**
 * Message handler of the terrain worker: runs `compute` (tile download, PNG decoding, horizons) or `dsm`
 * (laser-scan horizons) per job and posts progress, the result or the error. An aborted job posts nothing
 * more. The worker stays alive between jobs, so the in-memory caches of both (terrain tiles; scan headers,
 * tiles and rasters) serve later jobs, e.g. new floor heights or new observers at the same site.
 */
export function createTerrainWorkerHandler(
  post: (message: TerrainWorkerResponse) => void,
  compute: TerrainComputer = computeTerrainHorizons,
  dsm: DsmComputer = computeDsmJob,
): (message: TerrainWorkerRequest) => void {
  const jobs = new Map<number, AbortController>();
  const fail = (id: number, ctrl: AbortController) => (e: unknown) => {
    if (ctrl.signal.aborted) return;
    const err = e instanceof Error ? e : new Error(String(e));
    post({ type: 'error', id, name: err.name, message: err.message });
  };
  return (message) => {
    if (message.type === 'abort') {
      jobs.get(message.id)?.abort();
      jobs.delete(message.id);
      return;
    }
    const { id } = message;
    const ctrl = new AbortController();
    jobs.set(id, ctrl);
    const done = (): void => {
      if (jobs.get(id) === ctrl) jobs.delete(id);
    };
    if (message.type === 'dsm') {
      dsm(message.request, {
        signal: ctrl.signal,
        onProgress: (progress) => {
          if (!ctrl.signal.aborted) post({ type: 'dsm-progress', id, progress });
        },
      })
        .then(
          (result) => {
            if (!ctrl.signal.aborted) post({ type: 'dsm-result', id, result });
          },
          fail(id, ctrl),
        )
        .finally(done);
      return;
    }
    const { latitude, longitude, observerHeights } = message;
    compute(latitude, longitude, observerHeights, {
      signal: ctrl.signal,
      onProgress: (d, total) => {
        if (!ctrl.signal.aborted) post({ type: 'progress', id, done: d, total });
      },
    })
      .then(
        (results) => {
          if (!ctrl.signal.aborted) post({ type: 'result', id, results });
        },
        fail(id, ctrl),
      )
      .finally(done);
  };
}
