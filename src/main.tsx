import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';
import { initInstallPrompt } from './pwa/install';
import { initUrlSync } from './state/urlSync';

// A '#c=…' share link overrides the persisted config before the first render.
initUrlSync();
// The browser may offer app installation before the header has rendered.
initInstallPrompt();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
