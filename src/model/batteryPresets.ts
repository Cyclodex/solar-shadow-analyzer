import type { BatteryConfig } from './types';

// ─────────────────────────────────────────────
// BATTERY STORAGE PRESETS
// Values from the manufacturers' product pages and manuals, retrieved 2026-09-24. A value the manufacturer
// does not state is listed in `assumed` (shown in the UI) together with the value used instead.
// Efficiencies and standby consumption are stated by none of the presets' manufacturers: the presets keep the
// config's own values for them (defaults: DEFAULT_CONFIG.battery, marked as assumptions in the UI).
// ─────────────────────────────────────────────

/** Fields a preset sets. */
export type BatteryPresetValues = Pick<
  BatteryConfig,
  'unitCapacityWh' | 'pvInputW' | 'chargeW' | 'dischargeW'
> & { minSocPct?: number };

export interface BatteryPreset {
  id: string;
  /** Brand and model (not translated). */
  label: string;
  /** Most units per system per the manufacturer. */
  maxUnits: number;
  /** Values of a system of `units` units. */
  values: (units: number) => BatteryPresetValues;
  /** Fields without a manufacturer value (a substitute is used, see the source comment). */
  assumed: readonly (keyof BatteryPresetValues)[];
  /** Official source (manufacturer). */
  url: string;
}

export const CUSTOM_BATTERY_PRESET = 'custom';

export const BATTERY_PRESETS: readonly BatteryPreset[] = [
  {
    // https://eu.ecoflow.com/products/stream-ultra-x: "Capacity 3,84kWh", "MPPT 4", "PV Input Power 2000W
    // (500W*4)", "Expandable capacity from 3.84 to 23kWh" (6 units), FAQ: "The maximum charging power is 1500W
    // when using PV", "AC Output 1200W", "AC Output-Grid Tied 800W" (600 W models EF-EA-HD-U4K-600, manual
    // https://manuals.ecoflow.com/eu/product/stream-ultra-x). Discharging power not stated: the AC output
    // (1200 W) is used; grid feed-in is limited by acLimitW anyway. Each unit brings its own MPPTs.
    id: 'ecoflow-stream-ultra-x',
    label: 'EcoFlow STREAM Ultra X',
    maxUnits: 6,
    values: (n) => ({ unitCapacityWh: 3840, pvInputW: 2000 * n, chargeW: 1500 * n, dischargeW: 1200 * n }),
    assumed: ['dischargeW'],
    url: 'https://eu.ecoflow.com/products/stream-ultra-x',
  },
  {
    // https://eu.ecoflow.com/products/stream-ultra-x (comparison table) and the manual
    // https://manuals.ecoflow.com/eu/product/stream-pro-and-ultra: 1.92 kWh, 4 MPPT, 2000 W (500 W × 4),
    // "AC Charging Input 1050W", "AC Output 1200W", up to 6 STREAM devices. PV charging and discharging power
    // not stated: AC charging input (1050 W) and AC output (1200 W) are used.
    id: 'ecoflow-stream-ultra',
    label: 'EcoFlow STREAM Ultra',
    maxUnits: 6,
    values: (n) => ({ unitCapacityWh: 1920, pvInputW: 2000 * n, chargeW: 1050 * n, dischargeW: 1200 * n }),
    assumed: ['chargeW', 'dischargeW'],
    url: 'https://manuals.ecoflow.com/eu/product/stream-pro-and-ultra',
  },
  {
    // Same sources: 1.92 kWh, 3 MPPT, 1500 W (500 W × 3), AC charging 1050 W, AC output 1200 W.
    id: 'ecoflow-stream-pro',
    label: 'EcoFlow STREAM Pro',
    maxUnits: 6,
    values: (n) => ({ unitCapacityWh: 1920, pvInputW: 1500 * n, chargeW: 1050 * n, dischargeW: 1200 * n }),
    assumed: ['chargeW', 'dischargeW'],
    url: 'https://manuals.ecoflow.com/eu/product/stream-pro-and-ultra',
  },
  {
    // https://www.ankersolix.com/de/products/a17c5: "3600W PV-Eingang", "2,68-16kWh" (base + up to 5 packs
    // BP2700 à 2688 Wh), "Maximale Ladeleistung 1800W Nennleistung (Einzelgerät)", "3600W (Zusatzakku)",
    // "800W Netzgekoppelter AC-Ausgang". The PV input stays with the base unit. Discharging power not stated
    // separately: the grid-tied AC output (800 W) is used. Base unit counted as 2688 Wh like its packs.
    id: 'anker-solarbank-3-pro',
    label: 'Anker SOLIX Solarbank 3 E2700 Pro',
    maxUnits: 6,
    values: (n) => ({ unitCapacityWh: 2688, pvInputW: 3600, chargeW: n > 1 ? 3600 : 1800, dischargeW: 800 }),
    assumed: ['dischargeW'],
    url: 'https://www.ankersolix.com/de/products/a17c5',
  },
  {
    // https://www.zendure.de/products/solarflow-800-pro: "1920 Wh Batterie integriert", "MPPT 2640W (4 x 660W)",
    // "Lade-/Entladeleistung (ohne Zusatzbatterie) 1440W", "Max. Lade-/Entladeleistung (mit Zusatzbatterie)
    // 2000W", "1.920Wh × 6 = 11.520Wh", "Batteriestand nicht unter 5 %" (adjustable). Charging/discharging
    // with AB1000 packs (960 Wh) is not modelled: all units count as 1920 Wh.
    id: 'zendure-solarflow-800-pro',
    label: 'Zendure SolarFlow 800 Pro',
    maxUnits: 6,
    values: (n) => ({
      unitCapacityWh: 1920,
      pvInputW: 2640,
      chargeW: n > 1 ? 2000 : 1440,
      dischargeW: n > 1 ? 2000 : 1440,
      minSocPct: 5,
    }),
    assumed: [],
    url: 'https://www.zendure.de/products/solarflow-800-pro',
  },
];

export function batteryPreset(id: string): BatteryPreset | undefined {
  return BATTERY_PRESETS.find((p) => p.id === id);
}

/** `battery` with the values of preset `id` for its unit count (units clamped to the preset's maximum). */
export function applyBatteryPreset(battery: BatteryConfig, id: string): BatteryConfig {
  const preset = batteryPreset(id);
  if (!preset) return { ...battery, preset: CUSTOM_BATTERY_PRESET };
  const units = Math.min(Math.max(1, Math.round(battery.units)), preset.maxUnits);
  return { ...battery, ...preset.values(units), preset: id, units };
}

/** True if the config's device values are exactly those of its preset (else it has been edited). */
export function matchesBatteryPreset(battery: BatteryConfig): boolean {
  const preset = batteryPreset(battery.preset);
  if (!preset || battery.units > preset.maxUnits) return false;
  const v = preset.values(battery.units);
  return (Object.keys(v) as (keyof BatteryPresetValues)[]).every((k) => battery[k] === v[k]);
}
