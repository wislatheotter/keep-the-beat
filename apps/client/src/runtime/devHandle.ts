import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { RACKS, STATION_BY_ID, runPool, stationPosition, type LoopLayer } from '@loop/shared';
import type { GameRuntime } from './GameRuntime';
import { DEV_HANDLE } from './devFlag';

export function exposeDevHandle(runtime: GameRuntime) {
  if (!DEV_HANDLE) return;
  const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop ?? {};
  handle.runtime = runtime;
  const hurry = (runtime as { devHurry?: (ms: number) => void }).devHurry;
  if (hurry) handle.hurry = (ms: number) => hurry.call(runtime, ms);
  const age = (runtime as { devAge?: (ms: number) => void }).devAge;
  if (age) handle.age = (ms: number) => age.call(runtime, ms);
  Object.defineProperty(handle, 'state', { configurable: true, get: () => runtime.getState() });
  handle.pool = (layer: LoopLayer) => {
    const state = runtime.getState();
    return runPool(state.themeId, state.runSeed, layer).map((entry) => entry.sampleName);
  };
  handle.station = (id: string) => {
    const definition = STATION_BY_ID[id];
    return definition ? stationPosition(definition) : null;
  };
  handle.stations = () => RACKS.map((rack) => ({ id: rack.id, ...stationPosition(rack) }));
  handle.take = (stationId: string) => {
    const player = runtime.playerId;
    runtime.dispatch({ type: 'TAKE_RECORD', playerId: player, stationId, now: runtime.now() });
    return runtime.getState().players[player]?.heldBlockId ?? null;
  };
  (window as unknown as { __loop?: unknown }).__loop = handle;
}

export function registerDevTeleport(teleport: (x: number, z: number, yaw?: number) => void) {
  if (!DEV_HANDLE) return;
  const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop ?? {};
  handle.teleport = teleport;
  (window as unknown as { __loop?: unknown }).__loop = handle;
}

export function DevSceneHandle() {
  const three = useThree();
  useEffect(() => {
    if (!DEV_HANDLE) return;
    const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop ?? {};
    handle.three = three;
    (window as unknown as { __loop?: unknown }).__loop = handle;
  }, [three]);
  return null;
}
