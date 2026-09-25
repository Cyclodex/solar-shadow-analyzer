import type { BatteryResult } from '../../model/types';

// Energy paths of the storage simulation per month (monthly chart, CSV export).

/** Energy paths of one month, kWh (stack order bottom → top). */
export interface MonthPaths {
  selfDirect: number;
  selfBattery: number;
  exported: number;
  /** Curtailed at the AC limit and lost above the PV input limit. */
  curtailed: number;
  /** Charging, discharging and standby losses. */
  losses: number;
  load: number;
}

export type PathKey = Exclude<keyof MonthPaths, 'load'>;
export const PATHS: readonly PathKey[] = ['selfDirect', 'selfBattery', 'exported', 'curtailed', 'losses'];

/** Monthly paths with storage (mode 'with') or of the same system without it. */
export function monthPaths(r: BatteryResult, mode: 'with' | 'without'): MonthPaths[] {
  return Array.from({ length: 12 }, (_, m) => {
    const f = r.monthly[m];
    if (mode === 'without') {
      const b = r.baseline.monthly[m];
      return {
        selfDirect: b.selfConsumed,
        selfBattery: 0,
        exported: b.exported,
        curtailed: b.curtailed,
        losses: 0,
        load: f.load,
      };
    }
    const standbyGrid = Math.max(0, f.imported - (f.load - f.selfDirect - f.selfBattery));
    return {
      selfDirect: f.selfDirect,
      selfBattery: f.selfBattery,
      exported: f.exported,
      curtailed: f.curtailed + f.pvInputLimited,
      // Standby drawn from the grid is not solar energy: only its PV/battery part counts.
      losses: f.chargeLoss + f.dischargeLoss + f.standby - standbyGrid,
      load: f.load,
    };
  });
}
