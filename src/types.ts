// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface Config {
  latitude: number;
  longitude: number;
  facadeAzimuth: number;
  balconyHeight: number;
  railingHeight: number;
  panelLength: number;
  panelWidth: number;
  numPanels: number;
  numFloors: number;
  panelTilt: number;
  panelThickness: number;
}

export interface SolarPosition {
  altitude: number;
  azimuth: number;
}

export interface PanelGeometry {
  panelH: number;
  panelD: number;
  verticalGap: number;
  criticalAngle: number;
}

export interface SeasonDay {
  label: string;
  day: number;
  color: string;
}

export interface YearlyMonthResult {
  month: number;
  maxProfile: number;
  shadowH: number;
  sunH: number;
}

export interface ActiveViews {
  frontal: boolean;
  profile: boolean;
  topdown: boolean;
}
