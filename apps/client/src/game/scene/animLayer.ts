import { LoopOnce, LoopRepeat, type AnimationAction } from 'three';

export class AnimLayer {
  current: AnimationAction | null = null;
  private readonly weights = new Map<AnimationAction, number>();
  private readonly onBeat = new Map<AnimationAction, BeatCycle>();
  private fadeFrom = 0;
  private restFrom = 0;
  private fadeStart = 0;
  private fadeLength = 0;

  get name() {
    return this.current?.getClip().name ?? '';
  }

  loop(next: AnimationAction | null | undefined, seconds: number, clock: number) {
    if (!next || next === this.current) return;
    next.reset();
    next.setLoop(LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.setEffectiveTimeScale(1);
    this.onBeat.delete(next);
    this.fadeTo(next, seconds, clock);
  }

  once(next: AnimationAction | null | undefined, seconds: number, clock: number, timeScale = 1) {
    if (!next) return false;
    next.reset();
    next.setLoop(LoopOnce, 1);
    next.clampWhenFinished = true;
    next.setEffectiveTimeScale(timeScale);
    this.onBeat.delete(next);
    this.fadeTo(next, seconds, clock, true);
    return true;
  }

  beat(next: AnimationAction | null | undefined, seconds: number, clock: number, cycle?: BeatCycle) {
    if (!next) return;
    const timing = cycle ?? { span: next.getClip().duration, phase: 0 };
    if (next === this.current) {
      const own = this.onBeat.get(next);
      if (own) Object.assign(own, timing);
      return;
    }
    next.reset();
    next.setLoop(LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.setEffectiveTimeScale(0);
    this.onBeat.set(next, { ...timing });
    this.fadeTo(next, seconds, clock);
  }

  held(next: AnimationAction | null | undefined, seconds: number, clock: number, phase: number) {
    if (!next) return;
    this.beat(next, seconds, clock, { span: next.getClip().duration, phase, room: true });
  }

  private fadeTo(next: AnimationAction, seconds: number, clock: number, restart = false) {
    this.settle(clock);
    if (restart) this.weights.delete(next);
    this.fadeFrom = this.weights.get(next) ?? 0;
    this.restFrom = 0;
    for (const [action, weight] of this.weights) if (action !== next) this.restFrom += weight;
    if (this.restFrom <= 1e-6) this.fadeFrom = 1;
    this.fadeStart = clock;
    this.fadeLength = Math.max(1e-3, seconds);
    next.enabled = true;
    next.play();
    this.current = next;
    this.apply(clock);
  }

  update(clock: number, beatSeconds: number, roomSeconds: number) {
    this.apply(clock);
    for (const [action, cycle] of this.onBeat) {
      if (!this.weights.has(action) && action !== this.current) {
        this.onBeat.delete(action);
        continue;
      }
      const at = (cycle.room ? roomSeconds : beatSeconds) / cycle.span + cycle.phase;
      action.time = (at - Math.floor(at)) * action.getClip().duration;
    }
  }

  progress(clock: number) {
    return Math.min(1, (clock - this.fadeStart) / this.fadeLength);
  }

  private apply(clock: number) {
    const current = this.current;
    if (!current) return;
    const eased = ease(this.progress(clock));
    const incoming = this.fadeFrom + (1 - this.fadeFrom) * eased;
    for (const [action, from] of this.weights) {
      if (action === current) continue;
      const weight = this.restFrom > 1e-6 ? (from / this.restFrom) * (1 - incoming) : 0;
      if (weight <= 1e-4) {
        action.stop();
        this.weights.delete(action);
      } else {
        action.setEffectiveWeight(weight);
      }
    }
    current.setEffectiveWeight(incoming);
  }

  private settle(clock: number) {
    const current = this.current;
    if (!current) return;
    this.apply(clock);
    const actions = [current, ...this.fading()];
    this.weights.clear();
    for (const action of actions) this.weights.set(action, action.getEffectiveWeight());
  }

  private fading() {
    return [...this.weights.keys()].filter((action) => action !== this.current);
  }
}

export type BeatCycle = { span: number; phase: number; room?: boolean };

function ease(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
