import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type PropsWithChildren } from 'react';
import type { GameState } from '@loop/shared';
import type { GameRuntime } from './GameRuntime';
import { exposeDevHandle } from './devHandle';

const RuntimeContext = createContext<GameRuntime | null>(null);
const StateContext = createContext<GameState | null>(null);

export function GameRuntimeProvider({ runtime, children }: PropsWithChildren<{ runtime: GameRuntime }>) {
  const [held, setHeld] = useState(() => ({ runtime, state: runtime.getState() }));
  useEffect(() => runtime.subscribe((state) => setHeld({ runtime, state })), [runtime]);
  const state = held.runtime === runtime ? held.state : runtime.getState();
  useEffect(() => () => runtime.dispose(), [runtime]);
  useEffect(() => exposeDevHandle(runtime), [runtime]);
  const runtimeValue = useMemo(() => runtime, [runtime]);
  return (
    <RuntimeContext.Provider value={runtimeValue}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </RuntimeContext.Provider>
  );
}

export function FrozenGameState({ frozen, children }: PropsWithChildren<{ frozen: boolean }>) {
  const state = useGameState();
  const held = useRef(state);
  if (!frozen) held.current = state;
  return <StateContext.Provider value={held.current}>{children}</StateContext.Provider>;
}

export function useGameRuntime() {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error('useGameRuntime must be used within GameRuntimeProvider');
  return value;
}

export function useGameState() {
  const value = useContext(StateContext);
  if (!value) throw new Error('useGameState must be used within GameRuntimeProvider');
  return value;
}

export function useGameSelector<T>(select: (state: GameState) => T, equal: (a: T, b: T) => boolean = sameValue): T {
  const runtime = useGameRuntime();
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const value = select(runtime.getState());
  const latest = useRef({ select, equal, value });
  latest.current = { select, equal, value };
  useEffect(() => runtime.subscribe((state) => {
    const { select: pick, equal: same, value: previous } = latest.current;
    if (!same(previous, pick(state))) rerender();
  }), [runtime]);
  return value;
}

export function useGameStateWhen(deps: (state: GameState) => unknown): GameState {
  const runtime = useGameRuntime();
  useGameSelector(deps);
  return runtime.getState();
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!sameValue(a[i], b[i])) return false;
    return true;
  }
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const key of keysA) {
    if (!sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}
