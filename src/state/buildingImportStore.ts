import { create } from 'zustand';
import type { BuildingSourceError } from '../model/buildingSources';

// ─────────────────────────────────────────────
// BUILDING IMPORT STATE (not persisted; owned by the buildings feature, docs/ARCHITECTURE.md "Umgebung")
// Progress, result and errors of the swisstopo building import (hooks/useBuildingImport.ts writes them), a
// pending confirmation (a re-import would discard the user's changes to imported buildings), and the request
// to open the site plan after an import (the site plan consumes it once, like uiStore.surroundingsImport).
// ─────────────────────────────────────────────

/** Why an import runs: an address was picked (automatic) or the user pressed «Gebäude laden». */
export type BuildingImportReason = 'address' | 'manual';

/** An import around a point (WGS84 degrees, 1e-6). */
export interface BuildingImportRequest {
  latitude: number;
  longitude: number;
  reason: BuildingImportReason;
}

export type BuildingImportStatus =
  /** Nothing ran in this session (stored buildings may exist). */
  | 'idle'
  /** Tiles are loading or the buildings are being selected. */
  | 'loading'
  /** The last import finished (summary). */
  | 'ready'
  /** No building data at the point (outside Switzerland and Liechtenstein): the config is unchanged. */
  | 'unavailable'
  /** The last import failed (error); the config is unchanged. */
  | 'error';

export interface BuildingImportProgress {
  /** 'tiles' = downloading the vector tiles, 'select' = choosing the buildings to keep. */
  phase: 'tiles' | 'select';
  /** Tiles done / total ('tiles'), stations done / total ('select'). */
  done: number;
  total: number;
  /** Bytes received so far. */
  bytes: number;
}

/** Result of the last successful import (this session only). */
export interface BuildingImportSummary {
  /** Building parts found within the radius. */
  found: number;
  /** Imported buildings stored (all reasons). */
  stored: number;
  /** Stored because they set the horizon of a candidate facade. */
  horizon: number;
  /** Stored as context near the site / adjoining the own building. */
  context: number;
  /** Id of the own building in the stored list, null when none was identified. */
  ownId: string | null;
  /** Horizon setters that did not fit the caps, and the largest horizon change that can cause (°). */
  droppedSetters: number;
  maxDroppedScore: number;
  /** Manual buildings kept (moved to the new anchor) and dropped (more than 2 km from it). */
  keptManual: number;
  droppedManual: number;
  /** Share of the import circle inside Switzerland/Liechtenstein (0–1; < 1: buildings abroad are missing). */
  coverage: number;
  attribution: string;
  tileCount: number;
  bytes: number;
  /** Time of the selection (pruning), ms. */
  selectMs: number;
}

/** Request to open the site plan (confirm facade and balcony); `id` grows with every request. */
export interface SitePlanRequest {
  id: number;
  reason: BuildingImportReason;
}

export interface BuildingImportState {
  status: BuildingImportStatus;
  progress: BuildingImportProgress | null;
  error: BuildingSourceError | null;
  /** The last import started (retry). */
  request: BuildingImportRequest | null;
  summary: BuildingImportSummary | null;
  /** An import waiting for the user's confirmation (it would discard changes to imported buildings). */
  pendingConfirm: BuildingImportRequest | null;
  /** Pending request to open the site plan (null when none). */
  sitePlanRequest: SitePlanRequest | null;
  /** Returns the pending site-plan request and clears it (null when none): each request is handled once. */
  consumeSitePlanRequest: () => SitePlanRequest | null;
}

export const INITIAL_BUILDING_IMPORT = {
  status: 'idle',
  progress: null,
  error: null,
  request: null,
  summary: null,
  pendingConfirm: null,
  sitePlanRequest: null,
} as const satisfies Omit<BuildingImportState, 'consumeSitePlanRequest'>;

export const useBuildingImportStore = create<BuildingImportState>()((set, get) => ({
  ...INITIAL_BUILDING_IMPORT,
  consumeSitePlanRequest: () => {
    const request = get().sitePlanRequest;
    if (request) set({ sitePlanRequest: null });
    return request;
  },
}));

let sitePlanRequestId = 0;

/** Asks the site plan to open (after an import). */
export function requestSitePlan(reason: BuildingImportReason): void {
  useBuildingImportStore.setState({ sitePlanRequest: { id: ++sitePlanRequestId, reason } });
}
