import {
  fetchSwisstopoBuildings,
  type BuildingSourceError,
  type FetchBuildingsOptions,
} from './buildingSources';
import { findOwnBuilding } from './buildings';
import {
  horizonScores,
  importCandidate,
  planImport,
  pruneHeights,
  pruneStations,
  type ImportCandidate,
  type ImportReason,
  type PruneStation,
} from './buildingImport';
import { facadeToEnu, lonLatToEnu, type GeoPoint } from './enu';
import { OWN_BUILDING_EXCLUSION } from './surroundings';

// ─────────────────────────────────────────────
// SWISSTOPO BUILDING IMPORT: THE HEAVY PART (owned by the buildings feature, docs/ARCHITECTURE.md "Umgebung")
// Download and decode the vector tiles, assemble the parts (buildingSources.ts), prepare the candidates, find
// the own building and keep the buildings that set the horizon of a candidate facade plus the own building,
// its adjoining parts and near context within the caps (buildings.ts planImport). Runs in the building-import
// worker (hooks/buildingImport.worker.ts, off the main thread: tile decoding and part assembly took long tasks
// of 100–470 ms there on a phone-like CPU), or in this thread where no worker is available (tests, a worker
// that failed to start); hooks/buildingImportClient.ts chooses. Plain data in and out (structured clone).
// Never throws: failures come back as { ok: false, error }.
// ─────────────────────────────────────────────

/** What an import needs from the config (taken when it starts). */
export interface ImportJobInput {
  /** Import centre (the anchor), WGS84 degrees (1e-6). */
  latitude: number;
  longitude: number;
  /** Radius of the import, m (surfaceModel.radius). */
  radius: number;
  /** «Gebäude laden»: the own building is first the part behind the configured facade origin. */
  probeOwn: boolean;
  /** Configured location (facade origin) and facade azimuth: an extra pruning station within the radius. */
  location: GeoPoint;
  facadeAzimuth: number;
  /** Panel-centre heights of the configured floors (m), panel-centre distances from the wall (m), top rail (m). */
  observers: { heights: number[]; offsets: number[]; top: number };
  /** Room for imported buildings: the caps minus the buildings entered by hand. */
  maxBuildings: number;
  maxVertices: number;
}

/** Progress: 'tiles' = downloading the vector tiles, 'select' = choosing the buildings to keep. */
export interface ImportJobProgress {
  phase: 'tiles' | 'select';
  /** Tiles done / total ('tiles'), stations done / total ('select'). */
  done: number;
  total: number;
  /** Bytes received so far. */
  bytes: number;
}

/** A kept building part, in store order (own, adjoining, horizon setters by score, context). */
export interface KeptBuilding extends ImportCandidate {
  reason: ImportReason;
  score: number;
}

export type ImportJobResult =
  | { ok: false; error: BuildingSourceError }
  | {
      ok: true;
      /** False outside CH/FL (no building data there): nothing to store. */
      covered: false;
      coverage: number;
      attribution: string;
      tileCount: number;
      bytes: number;
    }
  | {
      ok: true;
      covered: true;
      kept: KeptBuilding[];
      /** Building parts found within the radius. */
      found: number;
      /** Horizon setters that did not fit the caps, and the largest horizon change that can cause (°). */
      droppedSetters: number;
      maxDroppedScore: number;
      coverage: number;
      attribution: string;
      tileCount: number;
      bytes: number;
      /** Time of the selection (pruning), ms. */
      selectMs: number;
    };

export interface ImportJobOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** The tile source (tests inject one). */
  fetchBuildings?: typeof fetchSwisstopoBuildings;
  onProgress?: (progress: ImportJobProgress) => void;
  /** Awaited between the selection steps (keeps a thread responsive, lets an abort in). */
  pause?: () => Promise<void>;
  /** Retry parameters of the tile requests (tests). */
  retry?: FetchBuildingsOptions['retry'];
}

const aborted = (): ImportJobResult => ({
  ok: false,
  error: { kind: 'aborted', message: 'The import was aborted.' },
});

/** Runs an import (see the header). Resolves { ok: false, error: 'aborted' } once `signal` aborts. */
export async function runImportJob(
  input: ImportJobInput,
  opts: ImportJobOptions = {},
): Promise<ImportJobResult> {
  const { signal, onProgress } = opts;
  const fetchBuildings = opts.fetchBuildings ?? fetchSwisstopoBuildings;
  if (signal?.aborted) return aborted();
  try {
    const res = await fetchBuildings(input.latitude, input.longitude, input.radius, {
      signal,
      fetchImpl: opts.fetchImpl,
      retry: opts.retry,
      onProgress: (done, total, bytes) => onProgress?.({ phase: 'tiles', done, total, bytes }),
    });
    if (signal?.aborted) return aborted();
    if (!res.ok) return { ok: false, error: res.error };
    const { coverage, attribution, tileCount, bytes } = res;
    if (!res.covered) return { ok: true, covered: false, coverage, attribution, tileCount, bytes };

    const started = performance.now();
    const anchor = { latitude: input.latitude, longitude: input.longitude };
    const candidates: ImportCandidate[] = [];
    for (const p of res.parts) {
      const c = importCandidate(p);
      if (c) candidates.push(c);
    }
    const footprints = candidates.map((c) => c.footprint);
    const tops = candidates.map((c) => c.base + c.height);
    const { facadeAzimuth, observers } = input;
    const loc = lonLatToEnu(anchor, input.location.latitude, input.location.longitude);
    const back = facadeToEnu([0, OWN_BUILDING_EXCLUSION.probeN], facadeAzimuth);
    const probe: [number, number] = [loc[0] + back[0], loc[1] + back[1]];
    const own = findOwnBuilding(footprints, [0, 0], input.probeOwn ? probe : null);
    const others = footprints.filter((_, i) => i !== own);
    // The configured facade counts too while its origin lies within the import radius.
    const extra: PruneStation[] =
      Math.hypot(loc[0], loc[1]) <= input.radius ? [{ origin: loc, facadeAzimuth }] : [];
    const stations = pruneStations(own >= 0 ? footprints[own] : null, others, extra);
    const ownTop = own >= 0 ? tops[own] : observers.top;
    const heights = pruneHeights(Math.max(ownTop, observers.top), observers.heights);
    let done = 0;
    const total = stations.length;
    onProgress?.({ phase: 'select', done, total, bytes });
    const scores = await horizonScores(footprints, tops, stations, heights, observers.offsets, {
      exclude: own >= 0 ? [own] : [],
      signal,
      pause: async () => {
        done++;
        onProgress?.({ phase: 'select', done, total, bytes });
        await opts.pause?.();
      },
    });
    if (signal?.aborted) return aborted();
    const plan = planImport({
      candidates,
      scores,
      own,
      site: [0, 0],
      maxBuildings: input.maxBuildings,
      maxVertices: input.maxVertices,
    });
    return {
      ok: true,
      covered: true,
      kept: plan.kept.map(({ index, reason, score }) => ({ ...candidates[index], reason, score })),
      found: res.parts.length,
      droppedSetters: plan.droppedSetters,
      maxDroppedScore: plan.maxDroppedScore,
      coverage,
      attribution,
      tileCount,
      bytes,
      selectMs: performance.now() - started,
    };
  } catch (e) {
    // Defensive: a bug in the selection must not escape.
    if (signal?.aborted) return aborted();
    return { ok: false, error: { kind: 'decode', message: e instanceof Error ? e.message : String(e) } };
  }
}
