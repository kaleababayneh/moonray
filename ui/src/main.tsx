import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DeployPage } from './screens/Deploy';
import './theme.css';

// Unlinked station console at /deploy; every other path is the game.
const isDeploy = window.location.pathname.replace(/\/+$/, '') === '/deploy';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isDeploy ? <DeployPage /> : <App />}</React.StrictMode>,
);
