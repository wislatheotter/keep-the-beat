import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import Shell from './Shell';
import { reloadForUpdate } from './runtime/reloadForUpdate';
import './audiotool/bootSearch';
import './fonts.css';
import './styles.css';
import './overlay/hud.css';

import { BOOT_PARAMS } from './audiotool/bootSearch';

const SampleBrowser = import.meta.env.DEV || import.meta.env.VITE_DEV_HANDLE === '1'
  ? lazy(() => import('./overlay/SampleBrowser').then((m) => ({ default: m.SampleBrowser })))
  : null;

function route() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/samples' && SampleBrowser) return <Suspense fallback={null}><SampleBrowser /></Suspense>;
  return <Shell />;
}

window.addEventListener('vite:preloadError', (event) => {
  if (reloadForUpdate()) event.preventDefault();
});

const typeface = Promise.race([
  document.fonts.load('1em "Space Grotesk"').catch(() => undefined),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]);

void typeface.then(() => {
  createRoot(document.getElementById('root')!).render(route());
  afterFirstFrame();
});

document.addEventListener('contextmenu', (event) => {
  if ((event.target as Element | null)?.closest?.('.game-shell')) event.preventDefault();
});

function afterFirstFrame() {
  requestAnimationFrame(() => {
    setTimeout(() => {
      const oauthReturn = BOOT_PARAMS.has('code') || BOOT_PARAMS.has('error');
      const handshake = import('./audiotool/authSession').then((m) => m.startAudiotoolAuth());
      const preload = () => void import('./preload').then((m) => m.preloadGame());
      const settled = Promise.race([handshake.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 4000))]);
      if (oauthReturn) void settled.then(preload);
      else preload();
    }, 0);
  });
}
