import { useMemo } from 'react';
import { useSelectedUtc } from '../../hooks/useModel';
import { sunPosition } from '../../model/sun';
import type { SunPosition } from '../../model/types';

/**
 * Sun position at the selected date and time for a site. Only its subscribers (the sun ray and caption of the
 * site plan) re-render while the time animates, not the whole plan.
 */
export function useSun(site: { latitude: number; longitude: number }): SunPosition {
  const utc = useSelectedUtc();
  return useMemo(() => sunPosition(utc, site.latitude, site.longitude), [utc, site.latitude, site.longitude]);
}
