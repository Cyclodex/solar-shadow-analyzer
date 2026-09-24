import { useState } from 'react';

// Stand-in for 'virtual:pwa-register/react' in the UI tests (alias in vite.config.ts): no service worker,
// never an update or offline notice, options are ignored. Tests that need notices vi.mock the module.

export function useRegisterSW() {
  const needRefresh = useState(false);
  const offlineReady = useState(false);
  return { needRefresh, offlineReady, updateServiceWorker: () => Promise.resolve() };
}
