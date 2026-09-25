// ─────────────────────────────────────────────
// DOMAIN TYPES
// Conventions: see docs/ARCHITECTURE.md
// Config lengths: building/panels in cm, obstacles in m. Model lengths: m.
// Angles in degrees unless a name ends in `Rad`.
// ─────────────────────────────────────────────

export type Lang = 'de' | 'en';
export type Theme = 'dark' | 'light';

// ── Config ───────────────────────────────────

export interface LocationConfig {
  /** Display name, e.g. "Bern" or "47.100, 7.450". */
  name: string;
  /** Degrees, −90…90 (north positive). */
  latitude: number;
  /** Degrees, −180…180 (east positive). */
  longitude: number;
  /** IANA time zone, e.g. "Europe/Zurich". */
  timezone: string;
  /** Ground elevation in m above sea level (informational; the terrain horizon uses the DEM height at the site). */
  elevation: number;
}

export interface BuildingConfig {
  /** Direction the facade faces (outward normal), degrees from north clockwise. */
  facadeAzimuth: number;
  /** Floor-to-floor height in cm (vertical distance between stacked panel rows). */
  floorHeight: number;
  /** Railing height above the balcony slab in cm. Panels hang from the railing top. */
  railingHeight: number;
  /** Distance from the facade wall to the railing in cm (balcony depth). */
  balconyDepth: number;
  /** Number of stacked floors with panels (1…8). */
  numFloors: number;
  /** Storey number of the lowest panel floor (0 = ground floor, 1 = 1st floor …). */
  lowestFloor: number;
}

export interface PanelConfig {
  /** Module dimension along the slope (hangs down from the railing), cm. */
  length: number;
  /** Module dimension along the railing, cm. */
  width: number;
  /** Modules side by side per floor. */
  count: number;
  /** Gap between adjacent modules, cm. */
  gap: number;
  /** 0 = hanging vertically, 90 = lying flat. PV tilt from horizontal β = 90 − tiltFromVertical. */
  tiltFromVertical: number;
  /** Rated power per module, Wp. */
  powerWp: number;
}

export type ShadingModel = 'linear' | 'substring';

export interface SystemConfig {
  /** AC limit of the inverter per floor, W. */
  inverterLimitW: number;
  /** System losses (cabling, inverter efficiency, soiling, mismatch), %. Excludes temperature & shading. */
  lossesPct: number;
  /** Power temperature coefficient, %/K (negative, e.g. −0.35). */
  tempCoeffPct: number;
  /** Nominal operating cell temperature, °C. */
  noct: number;
  /** Ground albedo 0…1. */
  albedo: number;
  /** How partial shading reduces module output. */
  shadingModel: ShadingModel;
}

/** Axis-aligned box in the facade frame (u = along facade, n = outward from the facade wall). */
export interface Obstacle {
  id: string;
  name: string;
  /** Center position along the facade, m (+ = right when looking at the facade from outside). */
  offsetAlong: number;
  /** Distance from the facade wall to the near face of the obstacle, m. */
  distance: number;
  /** Extent along the facade, m. */
  width: number;
  /** Extent away from the facade, m. */
  depth: number;
  /** Height above ground, m. */
  height: number;
}

export interface HorizonPoint {
  /** Azimuth, degrees from north clockwise. */
  azimuth: number;
  /** Elevation angle of the horizon, degrees. */
  elevation: number;
}

export interface HorizonConfig {
  /** Use the DEM-computed terrain horizon (fetched in the browser). */
  terrainEnabled: boolean;
  /** Neighbouring buildings / obstacles. */
  obstacles: Obstacle[];
  /** Optional user supplied horizon (e.g. imported PVGIS CSV). Empty = none. */
  manual: HorizonPoint[];
}

export type WeatherSource = 'open-meteo' | 'clear-sky';

export interface WeatherConfig {
  source: WeatherSource;
  /** Calendar year for historical weather (Open-Meteo best_match: ERA5 reanalysis, ECMWF IFS analysis). */
  year: number;
}

export interface EconomicsConfig {
  /** Currency label, e.g. "CHF". */
  currency: string;
  /** Price paid for grid electricity, per kWh. */
  electricityPrice: number;
  /** Feed-in tariff, per kWh. */
  feedInTariff: number;
  /** Share of production consumed on site, %. */
  selfConsumptionPct: number;
  /** Investment per floor system (modules, inverter, mounting). */
  investmentPerFloor: number;
  /** Annual degradation of module output, %/year. */
  degradationPct: number;
  /** Evaluation horizon, years. */
  lifetimeYears: number;
}

// ── Battery storage ──────────────────────────
// Model and sources: docs/ARCHITECTURE.md ("Batteriespeicher"), src/model/battery.ts.

/**
 * How the storage feeds the house:
 * - 'surplus': PV goes out directly up to the AC limit; only the PV above it charges the battery, which later
 *   discharges at the base load (baseLoadW) while PV output is below it;
 * - 'base-load': constant output of baseLoadW; PV above it charges the battery;
 * - 'self-consumption': the output follows the household load (smart meter); PV above the load charges.
 * In every strategy a full battery lets the PV surplus go out up to the AC limit.
 */
export type BatteryStrategy = 'surplus' | 'base-load' | 'self-consumption';

/** 'shared' = one storage system for all floors (one AC limit); 'per-floor' = one system per floor. */
export type BatteryLayout = 'shared' | 'per-floor';

/** Household load shape: BDEW standard load profile H0 or a constant load. */
export type LoadProfileKind = 'h0' | 'flat';

export interface BatteryConfig {
  /** Storage modelled at all (off = results exactly as without this section). */
  enabled: boolean;
  /** Device preset id (src/model/batteryPresets.ts) or 'custom'. */
  preset: string;
  layout: BatteryLayout;
  /** Battery units per system (identical devices / packs). */
  units: number;
  /** Usable capacity of one unit, Wh. */
  unitCapacityWh: number;
  /** Max. PV input power of one system (MPPTs), W; PV above it is lost. */
  pvInputW: number;
  /** Max. charging power of one system (from PV), W. */
  chargeW: number;
  /** Max. discharging power of one system, W. */
  dischargeW: number;
  /** AC output limit of one system, W (CH: 600 W per household, EU: 800 W). */
  acLimitW: number;
  /** Charging efficiency relative to the direct PV → AC path, %. */
  chargeEfficiencyPct: number;
  /** Discharging efficiency relative to the direct PV → AC path, %. */
  dischargeEfficiencyPct: number;
  /** Lowest state of charge the system discharges to (reserve), %. */
  minSocPct: number;
  /** Own consumption of one system, W (drawn from PV, else the battery, else the grid). */
  standbyW: number;
  strategy: BatteryStrategy;
  /** Base load output of one system, W ('surplus' and 'base-load'). */
  baseLoadW: number;
  /** Annual consumption of the household supplied by the system(s), kWh. */
  consumptionKwh: number;
  loadProfile: LoadProfileKind;
  /** Investment for the storage system(s), total (currency). */
  investment: number;
  /**
   * Part of the floors' investment (economics.investmentPerFloor × floors) that the storage makes unnecessary,
   * e.g. the micro-inverters it replaces, total (currency). Subtracted in the variant with storage.
   */
  replacedInvestment: number;
}

export interface Config {
  version: 3;
  location: LocationConfig;
  building: BuildingConfig;
  panels: PanelConfig;
  system: SystemConfig;
  horizon: HorizonConfig;
  weather: WeatherConfig;
  economics: EconomicsConfig;
  battery: BatteryConfig;
}

// ── Geometry ─────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Sun direction expressed in the facade frame (unit vector). */
export interface FacadeVector {
  /** Component along the facade (+ = right when looking at the facade from outside). */
  u: number;
  /** Component along the outward facade normal. */
  n: number;
  /** Vertical component. */
  z: number;
}

export interface SunPosition {
  /** Apparent altitude above the horizon incl. refraction, degrees. */
  altitude: number;
  /** Azimuth, degrees from north clockwise. */
  azimuth: number;
  /** Solar declination, degrees. */
  declination: number;
  /** Equation of time, minutes. */
  equationOfTime: number;
}

export interface ModuleSpan {
  /** Left edge along u, m (row is centered at u = 0). */
  u0: number;
  /** Right edge along u, m. */
  u1: number;
}

/** Derived panel row geometry in meters (identical for every floor). */
export interface PanelLayout {
  /** Slope length L, m. */
  length: number;
  /** Module width, m. */
  moduleWidth: number;
  count: number;
  gap: number;
  /** Total row width incl. gaps, m. */
  rowWidth: number;
  modules: ModuleSpan[];
  /** Tilt from vertical θ, degrees. */
  tiltFromVertical: number;
  /** PV tilt from horizontal β = 90 − θ, degrees. */
  tiltFromHorizontal: number;
  /** Vertical extent L·cos θ, m. */
  drop: number;
  /** Horizontal outward extent L·sin θ, m. */
  reach: number;
  /** Floor-to-floor height H, m. */
  floorHeight: number;
  /** Vertical clearance between the upper panel's lower edge and the lower panel's upper edge (H − drop), m. */
  verticalGap: number;
  /** Profile angle above which the upper row starts to shade the lower row (2D onset), degrees. 90 if never. */
  criticalProfileAngle: number;
  /** Panel normal in the facade frame. */
  normal: FacadeVector;
  /** Module area (single module), m². */
  moduleArea: number;
}

/** Placement of one floor's panel row in the facade frame (m). */
export interface FloorPlacement {
  floor: number;
  /** Storey number shown in the UI (lowestFloor + floor). */
  storey: number;
  /** Height of the balcony slab above ground, m. */
  slabZ: number;
  /** Height of the railing top = panel top edge, m. */
  railTopZ: number;
  /** Distance of the railing (panel top edge) from the facade wall, m. */
  railN: number;
  /** Panel center (u, n, z), m. */
  center: FacadeVector;
}

export interface ShadeRect {
  /** Shaded interval along u, m (clipped to the row extent). */
  u0: number;
  u1: number;
  /** Shaded interval along the slope, m (0 = top edge). */
  v0: number;
  v1: number;
}

export interface ShadeResult {
  /** Shaded fraction of the whole row area, 0…1. */
  fraction: number;
  /** Shaded fraction per module, 0…1. */
  perModule: number[];
  /** Shaded rectangles per module (empty when none). */
  rects: ShadeRect[];
  /** Translation of the upper row relative to the lower row (panel-plane coordinates), m. */
  du: number;
  dv: number;
}

export type SunState =
  /** Sun below the horizon (astronomical, altitude ≤ 0). */
  | 'night'
  /** Sun above the horizon but behind the facade plane. */
  | 'behind'
  /** Sun blocked by terrain / obstacles / manual horizon. */
  | 'horizon'
  /** Sun reaches the panel plane (may still be partially shaded by the floor above). */
  | 'lit';

/** Everything about one instant needed by the views. */
export interface InstantState {
  utcMs: number;
  sun: SunPosition;
  sunFacade: FacadeVector;
  /** Profile angle (angle of the sun ray projected onto the vertical plane normal to the facade), degrees; null if behind. */
  profileAngle: number | null;
  /** Per floor: state and shade from the floor above (top floor never shaded by panels). */
  floors: {
    floor: number;
    state: SunState;
    shade: ShadeResult;
    /** Cosine of the angle of incidence on the panel (≤0 = sun behind the panel plane). */
    cosIncidence: number;
  }[];
}

// ── Horizon ──────────────────────────────────

/** Horizon elevation sampled at regular azimuth steps starting at 0° (north). */
export interface HorizonProfile {
  stepDeg: number;
  /** elevations[i] = horizon elevation at azimuth i·stepDeg, degrees. */
  elevations: number[];
}

// ── Weather / irradiance ─────────────────────

export interface IrradianceSample {
  /** Global horizontal irradiance, W/m². */
  ghi: number;
  /** Direct normal irradiance, W/m². */
  dni: number;
  /** Diffuse horizontal irradiance, W/m². */
  dhi: number;
}

export interface WeatherSeries {
  source: WeatherSource;
  year: number;
  latitude: number;
  longitude: number;
  /** Duration of each step, minutes. */
  stepMinutes: number;
  /** UTC timestamp (ms) at the middle of each interval (use for the sun position). */
  timesUtc: number[];
  ghi: number[];
  dni: number[];
  dhi: number[];
  /** Air temperature, °C. */
  temperature: number[];
}

// ── Results ──────────────────────────────────

export interface FloorYield {
  floor: number;
  storey: number;
  /** AC energy, kWh per month (12 values). */
  monthlyKwh: number[];
  annualKwh: number;
  /** AC energy the floor would produce without shading by the floor above, kWh per month. */
  monthlyUnshadedKwh: number[];
  annualUnshadedKwh: number;
  /** Loss due to the floor above, kWh / %. */
  shadingLossKwh: number;
  shadingLossPct: number;
  /** Effective plane-of-array irradiation incl. shading (substring model: electrical loss), kWh/m² per year. */
  poaKwhPerM2: number;
  /** Energy clipped by the inverter limit, kWh. */
  clippedKwh: number;
  /** Specific yield, kWh/kWp. */
  specificYield: number;
  /** Diffuse sky view factor used for this floor (0…1, relative to the horizontal sky). */
  skyViewFactor: number;
}

export interface SimulationResult {
  source: WeatherSource;
  year: number;
  floors: FloorYield[];
  totalAnnualKwh: number;
  totalMonthlyKwh: number[];
  totalShadingLossKwh: number;
}

export interface HeatmapData {
  year: number;
  /** Days in the year (365/366). */
  days: number;
  /** Slots per day. */
  slotsPerDay: number;
  /** Minutes per slot (local clock time, slot 0 starts at 00:00). */
  slotMinutes: number;
  /**
   * Row-major [day][slot]. Values: −3 night, −2 sun behind facade, −1 sun below horizon profile,
   * 0…1 shaded fraction of the analysed floor's row.
   */
  values: Float32Array;
  /** Floor index that was analysed (shade from the floor above). */
  floor: number;
}

export interface TiltSweepPoint {
  tiltFromVertical: number;
  /** Annual kWh per floor. */
  floorsKwh: number[];
  totalKwh: number;
}

export interface DailyProfilePoint {
  /** Local clock minutes since midnight. */
  minutes: number;
  altitude: number;
  azimuth: number;
  /** AC power per floor, W (clear-sky or weather-based). */
  floorsW: number[];
  /** Shaded fraction per floor. */
  floorsShade: number[];
}

export interface EconomicsResult {
  annualKwh: number;
  selfConsumedKwh: number;
  exportedKwh: number;
  /** Savings in year 1 (currency). */
  annualSavings: number;
  /** Simple payback time, years (Infinity if never). */
  paybackYears: number;
  /** Cumulative savings over the lifetime incl. degradation, minus investment. */
  lifetimeNet: number;
  investment: number;
}

/** Energy flows of the storage simulation over a period, kWh (AC-equivalent, see src/model/battery.ts). */
export interface BatteryFlows {
  /** PV energy after system losses, before any limit (= yield without AC limit). */
  pv: number;
  /** PV above the systems' PV input limit (MPPT), lost. */
  pvInputLimited: number;
  /** PV sent to the AC side directly (incl. surplus fed in while the battery is full). */
  direct: number;
  /** PV into the battery (before charging losses). */
  charged: number;
  /** Battery energy delivered to the AC side (after discharging losses). */
  discharged: number;
  /** Household load covered by direct PV / by the battery. */
  selfDirect: number;
  selfBattery: number;
  /** AC energy fed into the grid. */
  exported: number;
  /** Energy drawn from the grid (load not covered + standby without PV or battery). */
  imported: number;
  /** Household consumption. */
  load: number;
  /** PV lost at the AC limit (battery full or charging power exceeded). */
  curtailed: number;
  chargeLoss: number;
  dischargeLoss: number;
  /** Own consumption of the system(s), from any source. */
  standby: number;
  /** Stored energy at the end minus at the start of the period. */
  storedDelta: number;
}

/** Same household and AC limit without storage (plain inverter), kWh. */
export interface BaselineFlows {
  /** AC output = min(PV, AC limit) per system. */
  output: number;
  selfConsumed: number;
  exported: number;
  imported: number;
  /** PV lost at the AC limit. */
  curtailed: number;
}

/** Hourly (weather step) series of the storage simulation, W (soc: 0…1 of the total capacity). */
export interface BatterySeries {
  timesUtc: readonly number[];
  stepMinutes: number;
  pv: Float32Array;
  direct: Float32Array;
  charge: Float32Array;
  discharge: Float32Array;
  load: Float32Array;
  exported: Float32Array;
  imported: Float32Array;
  soc: Float32Array;
}

export interface BatteryResult {
  source: WeatherSource;
  year: number;
  /** Number of storage systems (1 shared, or one per floor). */
  systems: number;
  /** Usable capacity of all systems, kWh. */
  capacityKwh: number;
  annual: BatteryFlows;
  monthly: BatteryFlows[];
  baseline: { annual: BaselineFlows; monthly: BaselineFlows[] };
  /** Full cycles per year: energy taken from the cells / total capacity. */
  cycles: number;
  /** Self-consumed share of the PV energy (pv), % — with and without storage. */
  selfConsumptionPct: number;
  baselineSelfConsumptionPct: number;
  /** Share of the load covered by PV, % — with and without storage. */
  autarkyPct: number;
  baselineAutarkyPct: number;
  /** AC energy delivered with storage minus without (same AC limit), kWh. */
  extraOutputKwh: number;
  /** Self-consumed energy with storage minus without, kWh. */
  extraSelfKwh: number;
  series: BatterySeries;
}
