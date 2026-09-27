import { MathUtils, Quaternion, Vector3 } from 'three';
import { create } from 'zustand';
import {
  DECK_PLINTH_RADIUS,
  DECK_POSITION,
  JUMP_MS,
  REPLAY_HALF_WIDTH,
  REPLAY_INTRO_MS,
  SHOW_INTRO_MS,
  barDurationMs,
  replayClock,
  type GameState,
  type PlayerState,
} from '@loop/shared';
import { cameraFraming } from './camera';

export type StageMode = 'lobby' | 'intro' | 'show' | 'outro' | 'replay';

type Timed = Pick<GameState, 'phase' | 'transportStartedAt' | 'completedAt'>;

export function stageMode(state: Timed, now: number): StageMode {
  if (state.phase === 'lobby') return 'lobby';
  if (state.phase === 'playing') {
    return state.transportStartedAt !== null && now < state.transportStartedAt ? 'intro' : 'show';
  }
  return state.completedAt !== null && now < state.completedAt + REPLAY_INTRO_MS ? 'outro' : 'replay';
}

export const useStageReady = create<{
  settled: boolean;
  holds: number;
  ready: boolean;
  setSettled: () => void;
  setReady: () => void;
  reset: () => void;
}>((set) => ({
  settled: false,
  holds: 0,
  ready: false,
  setSettled: () => set({ settled: true }),
  setReady: () => set({ ready: true }),
  reset: () => set({ settled: false, ready: false }),
}));

export function holdReveal(): () => void {
  useStageReady.setState((store) => ({ holds: store.holds + 1 }));
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    window.clearTimeout(timer);
    useStageReady.setState((store) => ({ holds: Math.max(0, store.holds - 1) }));
  };
  const timer = window.setTimeout(release, HOLD_LIMIT_MS);
  return release;
}

const HOLD_LIMIT_MS = 4000;

export function introProgress(state: Timed, now: number): number {
  if (state.phase === 'lobby') return 0;
  if (state.phase !== 'playing' || state.transportStartedAt === null) return 1;
  return MathUtils.clamp((now - (state.transportStartedAt - SHOW_INTRO_MS)) / SHOW_INTRO_MS, 0, 1);
}

export function outroProgress(state: Timed, now: number): number {
  if (state.phase !== 'complete' || state.completedAt === null) return 0;
  return MathUtils.clamp((now - state.completedAt) / REPLAY_INTRO_MS, 0, 1);
}

export const FINALE = {
  dimFrom: 900,
  cut: 1500,
  riseFrom: 1700,
  riseTo: 2900,
} as const;

export function finaleCut(state: Timed, now: number): boolean {
  return state.phase === 'complete' && state.completedAt !== null && now >= state.completedAt + FINALE.cut;
}

export function finaleDark(state: Timed, now: number): number {
  if (state.phase !== 'complete' || state.completedAt === null) return 0;
  const t = now - state.completedAt;
  if (t < FINALE.cut) return MathUtils.smoothstep(t, FINALE.dimFrom, FINALE.cut);
  return 1 - MathUtils.smoothstep(t, FINALE.riseFrom, FINALE.riseTo);
}

export function finaleRise(state: Timed, now: number): number {
  if (state.phase !== 'complete' || state.completedAt === null) return 0;
  return MathUtils.clamp((now - state.completedAt - FINALE.riseFrom) / (REPLAY_INTRO_MS - FINALE.riseFrom), 0, 1);
}

export function window01(t: number, from: number, to: number) {
  return MathUtils.smootherstep(t, from, to);
}

export const easeOutBack = (t: number, overshoot = 1.7) => {
  const u = t - 1;
  return 1 + (overshoot + 1) * u * u * u + overshoot * u * u;
};

export const LOBBY_Z = DECK_POSITION.z + DECK_PLINTH_RADIUS + 2.05;
const LOBBY_SPACING = 2.4;

export function lobbySeats(players: Record<string, PlayerState>, localId: string): string[] {
  const others = Object.values(players)
    .filter((player) => player.id !== localId)
    .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
    .map((player) => player.id);
  return players[localId] ? [localId, ...others] : others;
}

export type Slot = { x: number; z: number; yaw: number };

export function lobbySlot(seat: number, _aspect: number, out: Slot): Slot {
  const side = seat === 0 ? 0 : seat % 2 === 1 ? 1 : -1;
  const rank = Math.ceil(seat / 2);
  out.x = side * rank * LOBBY_SPACING;
  out.z = LOBBY_Z + 0.045 * out.x * out.x;
  out.yaw = Math.atan2(-out.x * 0.55, 9);
  return out;
}

export const REPLAY_PITCH = MathUtils.degToRad(90);
export const REPLAY_SCALE = 1.3;
export const RIG_FEET = 0.72;
export const REPLAY_ORIGIN = new Vector3(DECK_POSITION.x, 4.2, DECK_POSITION.z + 7.75 - RIG_FEET * REPLAY_SCALE);
export const REPLAY_FRAME = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -REPLAY_PITCH);
export const REPLAY_SPEED = 6.4;

const Y_AXIS = new Vector3(0, 1, 0);
const yawScratch = new Quaternion();

export function replayWorld(x: number, height: number, out: Vector3): Vector3 {
  return out.set(x, height, 0).applyQuaternion(REPLAY_FRAME).add(REPLAY_ORIGIN);
}

export function replayRotation(yaw: number, out: Quaternion): Quaternion {
  yawScratch.setFromAxisAngle(Y_AXIS, yaw);
  return out.copy(REPLAY_FRAME).multiply(yawScratch);
}

export function sectionAgeMs(state: Pick<GameState, 'phase' | 'completedAt' | 'bpm' | 'song'>, now: number): number {
  const clock = replayClock(state, now);
  if (!clock || clock.section < 0) return Infinity;
  const section = state.song.committed[clock.section]!;
  return (clock.bar - section.startBar) * barDurationMs(state.bpm);
}

export function hopScale(ms: number): [number, number] {
  if (ms < 0 || ms > JUMP_MS + LAND_MS) return [1, 1];
  if (ms < 70) {
    const k = Math.sin((ms / 70) * Math.PI) * 0.16;
    return [1 + k * 0.6, 1 - k];
  }
  if (ms <= JUMP_MS) {
    const t = ms / JUMP_MS;
    const stretch = Math.max(0, 1 - Math.abs(t - 0.25) / 0.3) * 0.1;
    return [1 - stretch * 0.5, 1 + stretch];
  }
  const k = Math.sin(((ms - JUMP_MS) / LAND_MS) * Math.PI) * 0.18;
  return [1 + k * 0.6, 1 - k];
}
const LAND_MS = 150;

export type Shot = { position: Vector3; target: Vector3; fov: number };

export const makeShot = (): Shot => ({ position: new Vector3(), target: new Vector3(), fov: 45 });

export function lobbyShot(aspect: number, count: number, out: Shot): Shot {
  const narrow = aspect < 1;
  const fov = 34;
  const halfFov = Math.tan(MathUtils.degToRad(fov / 2));
  const rows = Math.ceil(Math.max(0, count - 1) / 2) * LOBBY_SPACING;
  const halfWidth = Math.max(3.6, rows + 2.1);
  const halfHeight = 2.7;
  const distance = Math.max(halfWidth / (halfFov * LOBBY_ASPECT), halfHeight / halfFov);
  out.fov = fov;
  out.target.set(0, narrow ? 0.6 : 1.55, LOBBY_Z - 0.8);
  out.position.set(0, 2.2 + distance * 0.12, LOBBY_Z + distance);
  return out;
}

const LOBBY_ASPECT = 16 / 9;

export function followShot(at: Vector3, aspect: number, out: Shot): Shot {
  const framing = cameraFraming(aspect);
  out.fov = framing.fov;
  out.position.set(at.x, at.y + framing.height, at.z + framing.depth);
  out.target.set(at.x, at.y + 0.55, at.z - framing.lookAhead);
  return out;
}

export function replayShot(aspect: number, out: Shot, zoom = 1): Shot {
  const lift = REPLAY_DISTANCE / (REPLAY_DISTANCE - (REPLAY_ORIGIN.y - DECK_FACE_Y));
  const halfWidth = Math.max(DECK_PLINTH_RADIUS + 0.9, (REPLAY_HALF_WIDTH + 0.9) * lift + 0.2);
  const halfHeight = Math.max(REPLAY_HALF_HEIGHT, halfWidth / Math.max(aspect, 0.3));
  out.fov = MathUtils.radToDeg(2 * Math.atan(halfHeight / REPLAY_DISTANCE));
  out.target.set(DECK_POSITION.x, DECK_FACE_Y, DECK_POSITION.z);
  out.position.set(out.target.x, out.target.y + REPLAY_DISTANCE * zoom, out.target.z);
  return out;
}

const REPLAY_DISTANCE = 38;
const DECK_FACE_Y = 1.2;
const REPLAY_HALF_HEIGHT = 10.2;
