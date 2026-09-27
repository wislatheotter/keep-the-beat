import { applyGameAction } from './game.js';
import type { GameAction, GameState } from './types.js';

const PENDING_MS = 10_000;
const MAX_PENDING = 64;

type Pending = { seq: number; action: GameAction; sentAt: number };

export class Prediction {
  state!: GameState;
  private confirmed!: GameState;
  private pending: Pending[] = [];
  private nextSeq = 1;

  reset(state: GameState) {
    this.confirmed = state;
    this.state = state;
    this.pending = [];
    return state;
  }

  dispatch(action: GameAction, send: ((seq: number) => unknown) | null) {
    this.state = applyGameAction(this.state, action);
    if (send) {
      const seq = this.nextSeq++;
      this.pending.push({ seq, action, sentAt: Date.now() });
      if (this.pending.length > MAX_PENDING) this.pending.shift();
      send(seq);
    }
    return this.state;
  }

  receive(state: GameState, acked?: number) {
    this.confirmed = state;
    const now = Date.now();
    this.pending = acked === undefined
      ? []
      : this.pending.filter((entry) => entry.seq > acked && now - entry.sentAt < PENDING_MS);
    let next = state;
    for (const entry of this.pending) next = applyGameAction(next, entry.action);
    this.state = next;
    return next;
  }

  get room() {
    return this.confirmed;
  }

  get unanswered() {
    return this.pending.length;
  }
}
