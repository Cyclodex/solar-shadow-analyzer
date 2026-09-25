import type { Config, Obstacle } from './types';

// ─────────────────────────────────────────────
// DEFAULT CONFIG & FIELD LIMITS
// ─────────────────────────────────────────────

export const DEFAULT_CONFIG: Config = {
  version: 3,
  location: {
    name: '47.100° N, 7.450° E',
    latitude: 47.1,
    longitude: 7.45,
    timezone: 'Europe/Zurich',
    elevation: 486,
  },
  building: {
    facadeAzimuth: 202,
    floorHeight: 280,
    railingHeight: 100,
    balconyDepth: 150,
    numFloors: 2,
    lowestFloor: 1,
  },
  panels: {
    length: 113.4,
    width: 176.2,
    count: 2,
    gap: 2,
    tiltFromVertical: 45,
    powerWp: 430,
  },
  system: {
    inverterLimitW: 800,
    lossesPct: 14,
    tempCoeffPct: -0.35,
    noct: 45,
    albedo: 0.2,
    shadingModel: 'substring',
  },
  horizon: {
    terrainEnabled: true,
    obstacles: [],
    manual: [],
  },
  weather: {
    source: 'open-meteo',
    year: 2025,
  },
  economics: {
    currency: 'CHF',
    electricityPrice: 0.3,
    feedInTariff: 0.08,
    selfConsumptionPct: 70,
    investmentPerFloor: 900,
    degradationPct: 0.5,
    lifetimeYears: 25,
  },
  // Off by default. Device values: 2 × EcoFlow STREAM Ultra X in parallel on one AC output
  // (src/model/batteryPresets.ts). Sources and assumptions: docs/ARCHITECTURE.md, "Batteriespeicher".
  battery: {
    enabled: false,
    preset: 'ecoflow-stream-ultra-x',
    layout: 'shared',
    units: 2,
    unitCapacityWh: 3840,
    pvInputW: 4000,
    chargeW: 3000,
    dischargeW: 2400,
    // ESTI Mitteilung 7/2014: plug-in PV "gesamthaft maximal 600 W" per supply line (CH); EU 800 VA.
    acLimitW: 600,
    // Assumption: no manufacturer of the presets states charging/discharging efficiencies.
    chargeEfficiencyPct: 95,
    dischargeEfficiencyPct: 95,
    // Assumption: EcoFlow documents a reserve setting, not its default.
    minSocPct: 10,
    // Not stated by the manufacturers: 0 until measured.
    standbyW: 0,
    strategy: 'surplus',
    baseLoadW: 200,
    // ElCom consumption profile H2 (4-room apartment with electric cooker), Wegleitung Tarife 2027, 7.3.2.
    consumptionKwh: 2500,
    loadProfile: 'h0',
    // Example value: 2 × CHF 1'499 (ch.ecoflow.com, distributor Soltark by Hoelzle AG, 2026-09-24).
    investment: 2998,
  },
};

export interface FieldLimit {
  min: number;
  max: number;
  step: number;
}

/** Valid ranges for every numeric config field (used by UI sliders and by sanitizeConfig). */
export const LIMITS = {
  location: {
    latitude: { min: -89.9, max: 89.9, step: 0.001 },
    longitude: { min: -180, max: 180, step: 0.001 },
    elevation: { min: -500, max: 9000, step: 1 },
  },
  building: {
    facadeAzimuth: { min: 0, max: 359, step: 1 },
    floorHeight: { min: 200, max: 500, step: 1 },
    railingHeight: { min: 50, max: 150, step: 1 },
    balconyDepth: { min: 0, max: 400, step: 5 },
    numFloors: { min: 1, max: 8, step: 1 },
    lowestFloor: { min: 0, max: 40, step: 1 },
  },
  panels: {
    length: { min: 30, max: 250, step: 0.1 },
    width: { min: 30, max: 250, step: 0.1 },
    count: { min: 1, max: 8, step: 1 },
    gap: { min: 0, max: 30, step: 0.5 },
    tiltFromVertical: { min: 0, max: 90, step: 1 },
    powerWp: { min: 10, max: 800, step: 5 },
  },
  system: {
    inverterLimitW: { min: 100, max: 5000, step: 10 },
    lossesPct: { min: 0, max: 40, step: 0.5 },
    tempCoeffPct: { min: -0.6, max: 0, step: 0.01 },
    noct: { min: 35, max: 60, step: 1 },
    albedo: { min: 0, max: 0.9, step: 0.01 },
  },
  weather: {
    year: { min: 1940, max: 2100, step: 1 },
  },
  economics: {
    electricityPrice: { min: 0, max: 2, step: 0.01 },
    feedInTariff: { min: 0, max: 1, step: 0.005 },
    selfConsumptionPct: { min: 0, max: 100, step: 1 },
    investmentPerFloor: { min: 0, max: 20000, step: 10 },
    degradationPct: { min: 0, max: 3, step: 0.1 },
    lifetimeYears: { min: 1, max: 40, step: 1 },
  },
  battery: {
    units: { min: 1, max: 12, step: 1 },
    unitCapacityWh: { min: 100, max: 20000, step: 10 },
    pvInputW: { min: 100, max: 20000, step: 10 },
    chargeW: { min: 0, max: 20000, step: 10 },
    dischargeW: { min: 0, max: 20000, step: 10 },
    acLimitW: { min: 100, max: 5000, step: 10 },
    chargeEfficiencyPct: { min: 50, max: 100, step: 0.5 },
    dischargeEfficiencyPct: { min: 50, max: 100, step: 0.5 },
    minSocPct: { min: 0, max: 90, step: 1 },
    standbyW: { min: 0, max: 100, step: 0.5 },
    baseLoadW: { min: 0, max: 5000, step: 5 },
    consumptionKwh: { min: 100, max: 50000, step: 10 },
    investment: { min: 0, max: 50000, step: 10 },
  },
  obstacle: {
    offsetAlong: { min: -300, max: 300, step: 0.5 },
    distance: { min: 0.5, max: 1000, step: 0.5 },
    width: { min: 0.5, max: 500, step: 0.5 },
    depth: { min: 0.5, max: 300, step: 0.5 },
    height: { min: 0.5, max: 300, step: 0.5 },
  },
} as const satisfies Record<string, Record<string, FieldLimit>>;

/** Latest calendar year with complete historical weather data, given "now". */
export function latestCompleteWeatherYear(nowMs: number): number {
  return new Date(nowMs).getUTCFullYear() - 1;
}

export function createObstacle(id: string, name: string): Obstacle {
  return { id, name, offsetAlong: 0, distance: 20, width: 15, depth: 10, height: 12 };
}
