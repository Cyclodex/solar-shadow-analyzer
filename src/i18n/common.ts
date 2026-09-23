import { useMessages, type Messages } from './index';

// ─────────────────────────────────────────────
// SHARED TEXTS (used by several components)
// ─────────────────────────────────────────────

const de = {
  appTitle: 'Verschattungsanalyse',
  appSubtitle: 'Balkon-Solarpanels',
  inProgress: 'Diese Ansicht ist in Arbeit.',
  loading: 'Wird geladen …',
  computing: 'Wird berechnet …',
  error: 'Fehler',
  close: 'Schliessen',
  cancel: 'Abbrechen',
  confirm: 'Bestätigen',
  apply: 'Übernehmen',
  reset: 'Zurücksetzen',
  more: 'Mehr',
  info: 'Info',
  exportPng: 'PNG',
  exportPngLabel: (title: string) => `${title} als PNG exportieren`,
  exportCsv: 'CSV',
  floor: 'Stockwerk',
  floors: 'Stockwerke',
  floorsCount: (n: number) => (n === 1 ? '1 Stockwerk' : `${n} Stockwerke`),
  modulesCount: (n: number) => (n === 1 ? '1 Modul' : `${n} Module`),
  total: 'Total',
  month: 'Monat',
  year: 'Jahr',
  perYear: 'pro Jahr',
  facade: 'Fassade',
  sunrise: 'Sonnenaufgang',
  sunset: 'Sonnenuntergang',
  solarNoon: 'Sonnenhöchststand',
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
  tiltFromVertical: 'Neigung ab Senkrechte',
  tiltFromHorizontalHint: (beta: string) => `β = ${beta} ab Horizontal`,
  never: 'nie',
  years: (v: string) => `${v} Jahre`,
};

export type CommonMessages = typeof de;

export const commonMessages: Messages<CommonMessages> = {
  de,
  en: {
    appTitle: 'Shading analysis',
    appSubtitle: 'Balcony solar panels',
    inProgress: 'This view is work in progress.',
    loading: 'Loading …',
    computing: 'Computing …',
    error: 'Error',
    close: 'Close',
    cancel: 'Cancel',
    confirm: 'Confirm',
    apply: 'Apply',
    reset: 'Reset',
    more: 'More',
    info: 'Info',
    exportPng: 'PNG',
    exportPngLabel: (title: string) => `Export ${title} as PNG`,
    exportCsv: 'CSV',
    floor: 'Floor',
    floors: 'Floors',
    floorsCount: (n: number) => (n === 1 ? '1 floor' : `${n} floors`),
    modulesCount: (n: number) => (n === 1 ? '1 module' : `${n} modules`),
    total: 'Total',
    month: 'Month',
    year: 'Year',
    perYear: 'per year',
    facade: 'Facade',
    sunrise: 'Sunrise',
    sunset: 'Sunset',
    solarNoon: 'Solar noon',
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
    tiltFromVertical: 'Tilt from vertical',
    tiltFromHorizontalHint: (beta: string) => `β = ${beta} from horizontal`,
    never: 'never',
    years: (v: string) => `${v} years`,
  },
};

/** Shared texts in the current language. */
export function useCommon(): CommonMessages {
  return useMessages(commonMessages);
}
