import {
  LOOP_LAYERS,
  REPLAY_INTRO_MS,
  SHOW_INTRO_MS,
  isOvertime,
  layersEnergy,
  paceStatus,
  replayClock,
  songEnergy,
  type GameState,
} from '@loop/shared';

type Clocked = Pick<GameState, 'transportStartedAt' | 'bpm'> & Partial<Pick<GameState, 'phase' | 'completedAt'>>;
type Staged = Pick<GameState, 'song' | 'transportStartedAt'> & Partial<Pick<GameState, 'phase' | 'completedAt' | 'bpm'>>;

export function visualEpoch(state: Clocked): number | null {
  if (state.phase === 'complete' && state.completedAt) return state.completedAt + REPLAY_INTRO_MS;
  return state.transportStartedAt;
}

export type BeatInfo = {
  step: number;
  stepPhase: number;
  beat: number;
  beatPhase: number;
  barPhase: number;
  pulse: number;
  stepPulse: number;
};

export const DANCE_BPM = 120;
const DANCE_HOME_BPM = 125;

export function danceTempoFactor(bpm: number): number {
  let best = 1;
  for (const factor of [0.5, 1, 2]) {
    if (Math.abs(Math.log((bpm * factor) / DANCE_HOME_BPM)) < Math.abs(Math.log((bpm * best) / DANCE_HOME_BPM))) best = factor;
  }
  return best;
}

export function danceSeconds(state: Clocked, now: number): number {
  const epoch = visualEpoch(state) ?? now;
  const beats = (((now - epoch) * state.bpm) / 60_000) * danceTempoFactor(state.bpm);
  return beats * (60 / DANCE_BPM);
}

const RUN_HOME_BPM = 116;

export function runTempoFactor(bpm: number): number {
  let best = 1;
  for (const factor of [0.5, 1, 2]) {
    if (Math.abs(Math.log((bpm * factor) / RUN_HOME_BPM)) < Math.abs(Math.log((bpm * best) / RUN_HOME_BPM))) best = factor;
  }
  return best;
}

export function runStrideSpan(bpm: number): number {
  return (60 / DANCE_BPM) * danceTempoFactor(bpm) / runTempoFactor(bpm);
}

const IDLE: BeatInfo ={ step: 0, stepPhase: 0, beat: 0, beatPhase: 0, barPhase: 0, pulse: 0, stepPulse: 0 };

export function beatInfo(state: Clocked, now: number): BeatInfo {
  const epoch = visualEpoch(state);
  if (!epoch) return IDLE;
  const elapsed = now - epoch;
  if (elapsed < 0) return IDLE;

  const stepMs = 60_000 / state.bpm / 4;
  const stepFloat = elapsed / stepMs;
  const beatFloat = stepFloat / 4;
  const beatPhase = beatFloat - Math.floor(beatFloat);
  const stepPhase = stepFloat - Math.floor(stepFloat);

  return {
    step: Math.floor(stepFloat),
    stepPhase,
    beat: Math.floor(beatFloat),
    beatPhase,
    barPhase: (beatFloat / 4) % 1,
    pulse: (1 - beatPhase) ** 2.6,
    stepPulse: (1 - stepPhase) ** 3.2,
  };
}

export function trackDensity(state: Pick<GameState, 'song' | 'transportStartedAt'>): number {
  if (!state.transportStartedAt) return 0;
  let active = 0;
  for (const layer of LOOP_LAYERS) if (state.song.layers[layer].sampleName) active += 1;
  return (active / LOOP_LAYERS.length) ** 0.62;
}

export function showEnergy(state: Staged, now: number): number {
  if (!state.transportStartedAt) return 0;
  if (state.phase === 'complete') return replayEnergy(state, now);
  if (now < state.transportStartedAt) return stagePower(state, now) * 0.45;
  const remaining = Math.max(0, state.song.surgeUntil - now);
  const surge = (remaining / SURGE_MS) ** 1.6;
  return Math.min(1, songEnergy(state.song, now) + surge * 0.24 + crowdCheer(state, now) * 0.22);
}

export function stagePower(state: Partial<Pick<GameState, 'phase' | 'transportStartedAt'>>, now: number): number {
  if (!state.phase || state.phase === 'lobby' || !state.transportStartedAt) return 0;
  if (state.phase === 'complete') return 1;
  const t = (now - (state.transportStartedAt - SHOW_INTRO_MS)) / SHOW_INTRO_MS;
  if (t >= 1) return 1;
  const rig = smooth(0.22, 0.55, t) * 0.45;
  const all = smooth(0.7, 1, t) * 0.55;
  return rig + all;
}

function replayEnergy(state: Staged, now: number): number {
  const full = state as GameState;
  const clock = replayClock(full, now);
  if (!clock) return state.song.energy;
  if (clock.position < 0) {
    const settle = Math.min(1, (now - (full.completedAt ?? now)) / (REPLAY_INTRO_MS * 0.7));
    return state.song.energy * (1 - settle) + 0.12 * settle;
  }
  const section = state.song.committed[clock.section];
  if (!section) return 0.12;
  const into = clock.bar - section.startBar;
  const kick = into >= 0 && into < 1 ? (1 - into) ** 2 * 0.3 : 0;
  return Math.min(1, layersEnergy(section.layers) + kick);
}

function smooth(from: number, to: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

export function crowdCheer(state: Pick<GameState, 'song'> & Partial<Pick<GameState, 'transportStartedAt' | 'phase'>>, now: number): number {
  let cheer = 0;
  if (state.phase === 'playing' && state.transportStartedAt) {
    const age = now - state.transportStartedAt;
    if (age >= 0 && age < START_CHEER_MS) cheer = 0.85 * (1 - age / START_CHEER_MS) ** 1.2;
  }
  const printed = state.song.committed[state.song.committed.length - 1]?.score ?? 0;
  for (const reward of state.song.rewards) {
    const age = now - reward.at;
    if (age < 0) continue;
    if (reward.kind === 'print') {
      if (age < PRINT_CHEER_MS) cheer = Math.max(cheer, Math.min(1, Math.max(0.35, printed / 900)) * (1 - age / PRINT_CHEER_MS) ** 1.3);
    } else if (age < LAND_CHEER_MS) {
      cheer = Math.max(cheer, 0.32 * (1 - age / LAND_CHEER_MS));
    }
  }
  return cheer;
}

const START_CHEER_MS = 2600;
const PRINT_CHEER_MS = 3400;

const LAND_CHEER_MS = 1100;

const SURGE_MS = 620;

export function overtimeHeat(state: Pick<GameState, 'phase' | 'showEndsAt' | 'hardEndsAt' | 'transportStartedAt'>, now: number): number {
  if (state.phase !== 'playing' || !state.showEndsAt) return 0;
  if (isOvertime(state as Parameters<typeof isOvertime>[0], now)) return 1;
  const left = (state.showEndsAt - now) / WARNING_MS;
  return Math.max(0, Math.min(1, 1 - left)) ** 1.6;
}

const WARNING_MS = 45_000;

export function pressure(state: GameState, now: number): number {
  if (state.phase !== 'playing' || !state.showEndsAt || !state.hardEndsAt) return 0;
  if (now >= state.showEndsAt) {
    const left = (state.hardEndsAt - now) / Math.max(1, state.hardEndsAt - state.showEndsAt);
    return 0.8 + 0.2 * (1 - Math.max(0, left));
  }
  const pace = paceStatus(state, now);
  const behind = pace ? pace.behind * 0.75 + (pace.lateMs > 0 ? 0.15 : 0) : 0;
  const finalMinute = Math.max(0, 1 - (state.showEndsAt - now) / 60_000) ** 1.4 * 0.7;
  return Math.min(1, Math.max(behind, finalMinute));
}
