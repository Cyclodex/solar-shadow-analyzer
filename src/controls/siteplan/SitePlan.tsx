import { lazy, Suspense } from 'react';
import { useConfigSection } from '../../state/configStore';

// ─────────────────────────────────────────────
// SITE PLAN «Lageplan»: ENTRY (owned by the buildings feature, docs/ARCHITECTURE.md "Umgebung")
// BuildingSection renders <SitePlan/> without props. The plan (SitePlanPanel.tsx with its drawing,
// SitePlanMap.tsx) is a chunk of its own, loaded once surrounding buildings are stored: without them there
// is nothing to show, and most visits never need it.
// ─────────────────────────────────────────────

const SitePlanPanel = lazy(() => import('./SitePlanPanel').then((m) => ({ default: m.SitePlanPanel })));

/** The site plan once surrounding buildings (with their anchor) are stored; nothing before. */
export function SitePlan() {
  const { buildings, buildingImport } = useConfigSection('horizon');
  if (!buildingImport || !buildings.some((b) => !b.removed)) return null;
  return (
    <Suspense fallback={null}>
      <SitePlanPanel />
    </Suspense>
  );
}
