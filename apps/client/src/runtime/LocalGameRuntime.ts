import { applyGameAction, createInitialGame, setActiveTheme, stepGame, type GameAction, type GameState, type PoseReport, type ThemeId } from '@loop/shared';
import { pickTheme, withOwnPose, type GameRuntime, type StateListener } from './GameRuntime';

export class LocalGameRuntime implements GameRuntime {
  readonly mode = 'local' as const;
  readonly roomCode = null;
  private state: GameState;
  private listeners = new Set<StateListener>();
  private timer: number;
  private lastTickAt = Date.now();

  constructor(
    public readonly playerId: string,
    playerName: string,
    options: { standby?: boolean; opening?: { themeId?: ThemeId; runSeed?: number } } = {},
  ) {
    this.state = createInitialGame({ id: playerId, name: playerName }, null, Date.now(), options.opening);
    this.timer = 0;
    if (!options.standby) this.start();
  }

  start() {
    if (this.timer) return;
    this.lastTickAt = Date.now();
    this.timer = window.setInterval(() => {
      const now = Date.now();
      this.state = stepGame(this.state, now, Math.min(100, now - this.lastTickAt));
      this.lastTickAt = now;
      this.emit();
    }, 66);
  }

  getState() {
    setActiveTheme(this.state.themeId);
    return this.state;
  }
  now() { return Date.now(); }

  dispatch(action: GameAction) {
    this.state = applyGameAction(this.state, { ...action, now: this.now() } as GameAction);
    this.emit();
  }

  async settle(action: GameAction) {
    this.dispatch(action);
    return this.state;
  }

  publishPose(pose: PoseReport) {
    const next = withOwnPose(this.state, this.playerId, pose);
    if (next) this.state = next;
  }

  startGame() {
    this.dispatch({ type: 'START_GAME', now: this.now() });
  }

  setTheme(themeId: ThemeId | null) {
    this.dispatch({ type: 'SET_THEME', themeId: themeId ?? pickTheme(), now: this.now() });
  }

  subscribe(listener: StateListener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  devHurry(ms: number) {
    if (!this.state.showEndsAt || !this.state.hardEndsAt) return;
    this.state = {
      ...this.state,
      showEndsAt: this.state.showEndsAt - ms,
      hardEndsAt: this.state.hardEndsAt - ms,
    };
    this.emit();
  }

  devAge(ms: number) {
    const shift = (value: number | null) => (value === null ? null : value - ms);
    this.state = {
      ...this.state,
      matchStartedAt: shift(this.state.matchStartedAt),
      transportStartedAt: shift(this.state.transportStartedAt),
      showEndsAt: shift(this.state.showEndsAt),
      hardEndsAt: shift(this.state.hardEndsAt),
      song: { ...this.state.song, sectionStartedAt: this.state.song.sectionStartedAt - ms },
    };
    this.emit();
  }

  dispose() {
    clearInterval(this.timer);
    this.listeners.clear();
  }

  private emit() {
    setActiveTheme(this.state.themeId);
    for (const listener of this.listeners) listener(this.state);
  }
}
