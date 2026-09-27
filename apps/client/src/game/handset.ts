import { useSyncExternalStore } from 'react';

export const IS_HANDSET = (() => {
  const touchOnly = window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(any-pointer: fine)').matches;
  return !!touchOnly && Math.min(window.screen.width, window.screen.height) < 600;
})();

const landscape = window.matchMedia?.('(orientation: landscape)');

function subscribe(onChange: () => void) {
  landscape?.addEventListener('change', onChange);
  return () => landscape?.removeEventListener('change', onChange);
}

const isSideways = () => IS_HANDSET && !!landscape?.matches;

export function useHandsetSideways() {
  return useSyncExternalStore(subscribe, isSideways, () => false);
}
