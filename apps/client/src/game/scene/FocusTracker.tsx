import { useFrame } from '@react-three/fiber';
import { useEffect } from 'react';
import { useGameRuntime } from '../../runtime/GameRuntimeContext';
import { livePlayer, resolveInteraction, useFocusStore } from '../interaction';
import { pulseRecordAuras } from '../aura';
import { DEV_HANDLE } from '../../runtime/devFlag';

export function FocusTracker() {
  const runtime = useGameRuntime();
  const set = useFocusStore((store) => store.set);
  const clear = useFocusStore((store) => store.clear);

  useEffect(() => {
    if (!DEV_HANDLE) return;
    const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop ?? {};
    handle.focus = () => useFocusStore.getState().focus;
    (window as unknown as { __loop?: unknown }).__loop = handle;
  }, []);

  useFrame(() => {
    const state = runtime.getState();
    const now = runtime.now();
    pulseRecordAuras(now);
    if (state.phase !== 'playing' || (state.transportStartedAt !== null && now < state.transportStartedAt)) {
      clear();
      return;
    }
    set(resolveInteraction(state, runtime.playerId, now, livePlayer.known ? livePlayer.position : null));
  });

  return null;
}
