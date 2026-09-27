import { useProvisionalCause, type ProvisionalCause } from '../../hooks/useSurfaceModel';
import { useMessages, type Messages } from '../../i18n';

// ─────────────────────────────────────────────
// "PROVISIONAL" HINTS
// Shared text of the hints on provisional results (KPI bar, tilt optimum, heatmap): names what is still
// loading, the terrain horizon, the laser scan or both (hooks/useSurfaceModel.ts useProvisionalCause).
// ─────────────────────────────────────────────

const de: Record<ProvisionalCause, string> = {
  terrain: 'vorläufig – Geländehorizont wird geladen',
  surface: 'vorläufig – Laserscan-Umgebung wird geladen',
  both: 'vorläufig – Gelände und Laserscan werden geladen',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    terrain: 'provisional – loading terrain horizon',
    surface: 'provisional – loading laser-scan surroundings',
    both: 'provisional – loading terrain and laser scan',
  },
};

/** The hint for provisional results: what is still loading. */
export function useProvisionalNote(): string {
  return useMessages(messages)[useProvisionalCause()];
}
