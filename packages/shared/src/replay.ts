import { JUMP_HEIGHT, JUMP_MS, REPLAY_GAP_BARS, REPLAY_HALF_WIDTH, REPLAY_INTRO_MS, REPLAY_SPACING } from './constants.js';
import { clamp } from './math.js';
import { barDurationMs, songLengthBars, type CommittedSection } from './song.js';
import type { GameState } from './types.js';

export type ReplayClock = {
  startsAt: number;
  songBars: number;
  cycleBars: number;
  position: number;
  pass: number;
  bar: number;
  section: number;
};

export function replayStartsAt(state: Pick<GameState, 'completedAt'>): number | null {
  return state.completedAt === null ? null : state.completedAt + REPLAY_INTRO_MS;
}

export function replayClock(state: Pick<GameState, 'phase' | 'completedAt' | 'bpm' | 'song'>, now: number): ReplayClock | null {
  const startsAt = replayStartsAt(state);
  if (state.phase !== 'complete' || startsAt === null) return null;
  const sections = state.song.committed;
  const songBars = songLengthBars(sections);
  const cycleBars = songBars + REPLAY_GAP_BARS;
  const position = (now - startsAt) / barDurationMs(state.bpm);
  if (position < 0 || songBars === 0) {
    return { startsAt, songBars, cycleBars, position, pass: 0, bar: position, section: -1 };
  }
  const pass = Math.floor(position / cycleBars);
  const bar = position - pass * cycleBars;
  return { startsAt, songBars, cycleBars, position, pass, bar, section: sectionAtBar(sections, bar) };
}

export function sectionAtBar(sections: CommittedSection[], bar: number): number {
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index]!;
    if (bar >= section.startBar && bar < section.endBar) return index;
  }
  return -1;
}

export function replayPassStartsAt(clock: Pick<ReplayClock, 'startsAt' | 'cycleBars'>, pass: number, bpm: number) {
  return clock.startsAt + pass * clock.cycleBars * barDurationMs(bpm);
}

export function replaySlotX(index: number, count: number): number {
  const x = (index - (count - 1) / 2) * REPLAY_SPACING;
  return clamp(x, -REPLAY_HALF_WIDTH, REPLAY_HALF_WIDTH);
}

export function jumpHeight(ms: number): number {
  if (ms <= 0 || ms >= JUMP_MS) return 0;
  const t = ms / JUMP_MS;
  return 4 * JUMP_HEIGHT * t * (1 - t);
}

export function isAirborne(jumpAt: number, now: number): boolean {
  return jumpAt > 0 && now - jumpAt < JUMP_MS;
}
