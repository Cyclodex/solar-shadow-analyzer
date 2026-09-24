import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';
import { initInstallPrompt } from './pwa/install';
import { initStaleChunkReload } from './pwa/staleChunks';
import { initUrlSync } from './state/urlSync';

// A '#c=…' share link overrides the persisted config before the first render.
initUrlSync();
// The browser may offer app installation before the header has rendered.
initInstallPrompt();
// A lazily loaded chunk removed by a newer deploy: reload once to get the current version.
initStaleChunkReload();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
