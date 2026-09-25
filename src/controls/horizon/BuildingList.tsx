import { lazy, Suspense } from 'react';

// ─────────────────────────────────────────────
// SURROUNDING BUILDINGS: ENTRY (owned by the buildings feature, docs/ARCHITECTURE.md "Umgebung")
// HorizonSection renders <BuildingList/> without props (only while «Horizont & Umgebung» is open). The list
// with its import status and manual entry (BuildingListPanel.tsx) is a chunk of its own, loaded the first
// time the section opens.
// ─────────────────────────────────────────────

const BuildingListPanel = lazy(() =>
  import('./BuildingListPanel').then((m) => ({ default: m.BuildingListPanel })),
);

/** Surrounding buildings of «Horizont & Umgebung» (BuildingListPanel, loaded on first use). */
export function BuildingList() {
  return (
    <Suspense fallback={null}>
      <BuildingListPanel />
    </Suspense>
  );
}
