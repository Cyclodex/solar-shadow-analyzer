import { useMessages, type Messages } from './index';

// ─────────────────────────────────────────────
// SHARED TEXTS (used by several components)
// ─────────────────────────────────────────────

const de = {
  appTitle: 'Verschattungsanalyse',
  appSubtitle: 'Balkon-Solarpanels',
  loading: 'Wird geladen …',
  computing: 'Wird berechnet …',
  close: 'Schliessen',
  exportPng: 'PNG',
  exportPngLabel: (title: string) => `${title} als PNG exportieren`,
  exportCsv: 'CSV',
  floorsCount: (n: number) => (n === 1 ? '1 Stockwerk' : `${n} Stockwerke`),
  modulesCount: (n: number) => (n === 1 ? '1 Modul' : `${n} Module`),
  total: 'Total',
  sunrise: 'Sonnenaufgang',
  sunset: 'Sonnenuntergang',
  polarDay: 'Polartag: Die Sonne geht nicht unter.',
  polarNight: 'Polarnacht: Die Sonne geht nicht auf.',
  sunStates: {
    night: 'Sonne unter dem Horizont',
    behind: 'Sonne hinter der Fassade',
    horizon: 'Sonne hinter Gelände/Hindernis',
    lit: 'Sonne auf dem Panel',
  },
  clearSky: 'Klarer Himmel',
  clearSkyHint: 'Theoretisches Maximum bei klarem Himmel',
  openMeteo: 'Open-Meteo',
  tiltSymbol: 'θ',
  tiltFromHorizontalHint: (beta: string) => `β = ${beta} ab Horizontal`,
  never: 'nie',
  years: (v: string) => `${v} Jahre`,
};

export type CommonMessages = typeof de;

const commonMessages: Messages<CommonMessages> = {
  de,
  en: {
    appTitle: 'Shading analysis',
    appSubtitle: 'Balcony solar panels',
    loading: 'Loading …',
    computing: 'Computing …',
    close: 'Close',
    exportPng: 'PNG',
    exportPngLabel: (title: string) => `Export ${title} as PNG`,
    exportCsv: 'CSV',
    floorsCount: (n: number) => (n === 1 ? '1 floor' : `${n} floors`),
    modulesCount: (n: number) => (n === 1 ? '1 module' : `${n} modules`),
    total: 'Total',
    sunrise: 'Sunrise',
    sunset: 'Sunset',
    polarDay: 'Polar day: the sun does not set.',
    polarNight: 'Polar night: the sun does not rise.',
    sunStates: {
      night: 'Sun below the horizon',
      behind: 'Sun behind the facade',
      horizon: 'Sun behind terrain/obstacle',
      lit: 'Sun on the panel',
    },
    clearSky: 'Clear sky',
    clearSkyHint: 'Theoretical maximum under clear skies',
    openMeteo: 'Open-Meteo',
    tiltSymbol: 'θ',
    tiltFromHorizontalHint: (beta: string) => `β = ${beta} from horizontal`,
    never: 'never',
    years: (v: string) => `${v} years`,
  },
};

/** Shared texts in the current language. */
export function useCommon(): CommonMessages {
  return useMessages(commonMessages);
}
