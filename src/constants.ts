import type { Config, SeasonDay } from './types';
import { getDayOfYear } from './utils/solar';

// ─────────────────────────────────────────────
// DEFAULT CONFIG
// ─────────────────────────────────────────────
export const DEFAULT_CONFIG: Config = {
  latitude: 47.1,
  longitude: 7.45,
  facadeAzimuth: 202,
  balconyHeight: 280,
  railingHeight: 100,
  panelLength: 113.4,
  panelWidth: 176.2,
  numPanels: 2,
  numFloors: 2,
  panelTilt: 45,
  panelThickness: 3, // not user-editable, kept for rendering
};

export const monthNames: string[] = [
  'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
];

export const seasonDays: SeasonDay[] = [
  { label: 'Wintersonnenwende (21. Dez)', day: getDayOfYear(12, 21), color: '#3b82f6' },
  { label: 'Tagundnachtgleiche (20. Mär)', day: getDayOfYear(3, 20), color: '#f59e0b' },
  { label: 'Sommersonnenwende (21. Jun)', day: getDayOfYear(6, 21), color: '#ef4444' },
];
