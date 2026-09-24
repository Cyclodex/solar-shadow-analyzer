import { useMemo } from 'react';
import { floorLabel, useLang } from '../../i18n';
import { useFloorPlacements, useFocusFloor } from '../../hooks/useModel';
import { useConfigSection } from '../../state/configStore';

/** Display label per floor index ("1. OG", "Floor 2" …) from the real storey numbers. */
export function useFloorLabels(): string[] {
  const lang = useLang();
  const placements = useFloorPlacements();
  return useMemo(() => placements.map((p) => floorLabel(p.storey, lang)), [placements, lang]);
}

/**
 * Floor analysed by the shade heatmap and the shaded-hours column: the focus floor, but never the top floor
 * when there are floors below it (no panels above the top row, so it is never shaded by them).
 * A single floor is floor 0.
 */
export function useShadedFloor(): number {
  const numFloors = useConfigSection('building').numFloors;
  const focus = useFocusFloor();
  return numFloors <= 1 ? 0 : Math.min(focus, numFloors - 2);
}

/** Floor indices from the top floor down (tooltips, vertical lists: same order as on the building). */
export function topDown(numFloors: number): number[] {
  return Array.from({ length: numFloors }, (_, i) => numFloors - 1 - i);
}
