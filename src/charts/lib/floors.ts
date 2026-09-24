import { useMemo } from 'react';
import { floorLabel, useLang } from '../../i18n';
import { useFloorPlacements } from '../../hooks/useModel';

/** Display label per floor index ("1. OG", "Floor 2" …) from the real storey numbers. */
export function useFloorLabels(): string[] {
  const lang = useLang();
  const placements = useFloorPlacements();
  return useMemo(() => placements.map((p) => floorLabel(p.storey, lang)), [placements, lang]);
}

/** Floor indices from the top floor down (tooltips, vertical lists: same order as on the building). */
export function topDown(numFloors: number): number[] {
  return Array.from({ length: numFloors }, (_, i) => numFloors - 1 - i);
}
