import {
  LOB_POWER_MAX,
  LOOP_LAYERS,
  THEME_IDS,
  distanceXZ,
  type GameAction,
  type GameState,
  type LoopLayer,
  type MixReading,
  type PoseReport,
  type ThemeId,
  type Vec3,
} from '@loop/shared';
import { decodePose } from '@loop/shared/wire';

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function text(value: unknown, max: number, min = 0): string | null {
  return typeof value === 'string' && value.length >= min && value.length <= max ? value : null;
}

function number(value: unknown, limit = 1e7): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

function point(value: unknown): Vec3 | null {
  if (!isObject(value)) return null;
  const x = number(value.x, 100);
  const y = number(value.y, 100);
  const z = number(value.z, 100);
  return x === null || y === null || z === null ? null : { x, y, z };
}

function ownKey(value: unknown, table: object): string | null {
  const key = text(value, 96, 1);
  return key !== null && Object.hasOwn(table, key) ? key : null;
}

const PLAYER_KEY = /^[\x21-\x7e]{1,128}$/;

export type Entry = { playerKey: string; name: string; session: string };

export function readEntry(payload: unknown): Entry | null {
  if (!isObject(payload)) return null;
  const playerKey = text(payload.playerKey, 128);
  if (playerKey === null || !PLAYER_KEY.test(playerKey)) return null;
  const name = payload.name === undefined ? '' : text(payload.name, 256);
  const session = payload.session === undefined ? '' : text(payload.session, 128);
  if (name === null || session === null) return null;
  return { playerKey, name, session };
}

export function readOpening(payload: unknown): { themeId?: ThemeId; runSeed?: number } {
  if (!isObject(payload)) return {};
  const themeId = THEME_IDS.includes(payload.themeId as ThemeId) ? payload.themeId as ThemeId : undefined;
  const seed = payload.runSeed;
  const runSeed = typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0x7fffffff ? seed : undefined;
  return { ...(themeId ? { themeId } : {}), ...(runSeed !== undefined ? { runSeed } : {}) };
}

export function readCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 16) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,8}$/.test(code) ? code : null;
}

export function readCreateCode(payload: unknown): string | null {
  if (!isObject(payload) || payload.create !== true) return null;
  const code = readCode(payload.code);
  return code !== null && /^[A-Z0-9]{4}$/.test(code) ? code : null;
}

export function readPose(bytes: Uint8Array): PoseReport | null {
  const pose = decodePose(bytes);
  if (!pose) return null;
  const t = number(pose.t, 1e14);
  const x = number(pose.x, 100);
  const y = number(pose.y, 100);
  const z = number(pose.z, 100);
  const yaw = number(pose.yaw, 1e4);
  if (t === null || x === null || y === null || z === null || yaw === null) return null;
  return { t, x, y, z, yaw, moving: pose.moving, aiming: pose.aiming };
}

export function readSeq(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function readPace(value: unknown): number | null {
  if (value === 0) return 0;
  return typeof value === 'number' && Number.isFinite(value) && value >= 100 && value <= 5000 ? Math.round(value) : null;
}

const HAND_REACH = 3;

function fromHands(state: GameState, playerId: string, at: Vec3, height: [number, number]): Vec3 {
  const player = state.players[playerId];
  const y = Math.min(height[1], Math.max(height[0], at.y));
  if (!player || distanceXZ(player.position, at) <= HAND_REACH) return { x: at.x, y, z: at.z };
  return { x: player.position.x, y, z: player.position.z };
}

function lobVelocity(velocity: Vec3): Vec3 {
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const cap = LOB_POWER_MAX * 1.05;
  if (speed <= cap) return velocity;
  const scale = cap / speed;
  return { x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale };
}

const MAX_COMMIT_TICK_MS = 250;

function readReading(value: unknown): (MixReading & { signature: string }) | null {
  if (!isObject(value)) return null;
  const loudnessDb = number(value.loudnessDb, 1000);
  const limitingDb = number(value.limitingDb, 1000);
  const signature = text(value.signature, 4096);
  if (loudnessDb === null || limitingDb === null || signature === null) return null;
  if (!Array.isArray(value.shares) || value.shares.length !== 4) return null;
  const shares = value.shares.map((share) => number(share, 10));
  if (shares.some((share) => share === null)) return null;
  return { loudnessDb, limitingDb, shares: shares as MixReading['shares'], source: 'measured', signature };
}

export function readAction(raw: unknown, playerId: string, state: GameState, now: number): GameAction | null {
  if (!isObject(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'PLAYER_TRANSFORM': {
      const position = point(raw.position);
      const rotationY = number(raw.rotationY, 1e4);
      if (!position || rotationY === null) return null;
      return { type: 'PLAYER_TRANSFORM', playerId, position, rotationY, now };
    }
    case 'TAKE_RECORD':
    case 'USE_STATION': {
      const stationId = ownKey(raw.stationId, state.stations);
      if (stationId === null) return null;
      return { type: raw.type, playerId, stationId, now };
    }
    case 'PICKUP_BLOCK':
    case 'QUEUE_DROP': {
      const blockId = ownKey(raw.blockId, state.blocks);
      if (blockId === null) return null;
      return { type: raw.type, playerId, blockId, now };
    }
    case 'QUEUE_CLEAR': {
      if (!LOOP_LAYERS.includes(raw.layer as LoopLayer)) return null;
      return { type: 'QUEUE_CLEAR', playerId, layer: raw.layer as LoopLayer, now };
    }
    case 'COMMIT_SECTION': {
      const deltaMs = number(raw.deltaMs, 1e7);
      if (deltaMs === null || deltaMs <= 0) return null;
      const reading = raw.reading === undefined || raw.reading === null ? null : readReading(raw.reading);
      return { type: 'COMMIT_SECTION', playerId, deltaMs: Math.min(deltaMs, MAX_COMMIT_TICK_MS), reading, now };
    }
    case 'LOB_RECORD': {
      const blockId = ownKey(raw.blockId, state.blocks);
      const position = point(raw.position);
      const velocity = point(raw.velocity);
      if (blockId === null || !position || !velocity) return null;
      return {
        type: 'LOB_RECORD', playerId, blockId, now,
        position: fromHands(state, playerId, position, [0.5, 3]),
        velocity: lobVelocity(velocity),
      };
    }
    case 'DROP_BLOCK': {
      const blockId = ownKey(raw.blockId, state.blocks);
      const position = point(raw.position);
      if (blockId === null || !position) return null;
      return { type: 'DROP_BLOCK', playerId, blockId, position: fromHands(state, playerId, position, [0, 3]), now };
    }
    case 'JUMP':
      return { type: 'JUMP', playerId, now };
    case 'OPEN_LOBBY':
      return { type: 'OPEN_LOBBY', playerId, now };
    case 'SET_THEME': {
      const themeId = raw.themeId === null ? null : THEME_IDS.includes(raw.themeId as ThemeId) ? raw.themeId as ThemeId : undefined;
      if (themeId === undefined) return null;
      return { type: 'SET_THEME', themeId, now };
    }
    case 'SET_AUDIOTOOL_USER': {
      const displayName = raw.displayName === null ? null : text(raw.displayName, 256);
      if (raw.displayName !== null && displayName === null) return null;
      return { type: 'SET_AUDIOTOOL_USER', playerId, displayName, now };
    }
    default:
      return null;
  }
}
