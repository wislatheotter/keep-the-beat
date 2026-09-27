import { THEME_IDS, applyPlayerPose, type GameAction, type GameState, type PoseReport, type ThemeId } from '@loop/shared';

export const pickTheme = (): ThemeId => THEME_IDS[Math.floor(Math.random() * THEME_IDS.length)]!;

export type StateListener = (state: GameState) => void;

export interface GameRuntime {
  readonly mode: 'local' | 'socket';
  readonly playerId: string;
  readonly roomCode: string | null;
  getState(): GameState;
  dispatch(action: GameAction): void;
  settle(action: GameAction): Promise<GameState>;
  publishPose(pose: PoseReport): void;
  startGame(): void;
  setTheme(themeId: ThemeId | null): void;
  subscribe(listener: StateListener): () => void;
  now(): number;
  dispose(): void;
}

export function withOwnPose(state: GameState, playerId: string, pose: PoseReport): GameState | null {
  const player = state.players[playerId];
  if (!player) return null;
  const held = player.heldBlockId ? state.blocks[player.heldBlockId] : null;
  const next: GameState = {
    ...state,
    players: { ...state.players, [playerId]: { ...player } },
    blocks: held ? { ...state.blocks, [held.id]: { ...held } } : state.blocks,
  };
  return applyPlayerPose(next, playerId, pose) ? next : null;
}
