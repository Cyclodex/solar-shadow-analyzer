import { useMessages, type Messages } from '../../i18n';
import type { SimulationResult } from '../../model/types';

const de = {
  openMeteo: (year: number) => `Datenbasis: Open-Meteo, Wetter ${year}.`,
  clearSky: (year: number) =>
    `Datenbasis: klarer Himmel ${year} – theoretisches Maximum, kein reales Wetter.`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    openMeteo: (year) => `Data: Open-Meteo, ${year} weather.`,
    clearSky: (year) => `Data: clear sky ${year} – theoretical maximum, not real weather.`,
  },
};

/** "Data: Open-Meteo, 2025 weather" / "Data: clear sky 2025 – theoretical maximum" for a simulation result. */
export function useSourceLabel(
  source: Pick<SimulationResult, 'source' | 'year'> | null | undefined,
): string | null {
  const t = useMessages(messages);
  if (!source) return null;
  return source.source === 'open-meteo' ? t.openMeteo(source.year) : t.clearSky(source.year);
}
