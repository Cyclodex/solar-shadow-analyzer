import type { FloorPlacement, PanelLayout } from '../../model/types';

// ─────────────────────────────────────────────
// PHYSICALLY IMPOSSIBLE GEOMETRY shown as view notices (pure, no React).
// Overlapping rows: model/geometry.panelsOverlap.
// ─────────────────────────────────────────────

/**
 * How far the lowest panel row reaches below ground level (m); 0 when it stays above. Only a ground-floor
 * row can reach that far: from the 1st floor up the railing top is at least 2.5 m, the maximum drop.
 */
export function panelDepthBelowGround(layout: PanelLayout, placements: readonly FloorPlacement[]): number {
  const lowest = placements[0];
  return lowest ? Math.max(0, layout.drop - lowest.railTopZ) : 0;
}
