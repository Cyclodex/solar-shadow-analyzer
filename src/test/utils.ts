import { DEFAULT_CONFIG } from '../model/defaults';
import { clearModelCaches } from '../hooks/useModel';
import { useConfigStore } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { INITIAL_SHARE_LINK, useShareLinkStore } from '../state/shareLinkStore';
import { DEFAULT_MINUTES, DEFAULT_SPEED, useTimeStore } from '../state/timeStore';
import { DEFAULT_VIEWS, useUiStore } from '../state/uiStore';

/** A fixed date for deterministic tests. */
export const TEST_DATE = '2025-06-21';

/**
 * Resets all stores (config = DEFAULT_CONFIG, lang 'de', dark theme, fixed test date/time, no link notices)
 * and model caches.
 */
export function resetStores(): void {
  useConfigStore.setState({ config: DEFAULT_CONFIG });
  useTimeStore.setState({ date: TEST_DATE, minutes: DEFAULT_MINUTES, playing: false, speed: DEFAULT_SPEED });
  useUiStore.setState({ lang: 'de', theme: 'dark', views: DEFAULT_VIEWS, openSections: {}, focusFloor: 0 });
  useDataStore.getState().resetData();
  useShareLinkStore.setState(INITIAL_SHARE_LINK);
  clearModelCaches();
}
