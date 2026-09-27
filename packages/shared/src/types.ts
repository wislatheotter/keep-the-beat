import type { SongState } from './song.js';
import type { MixReading } from './mix.js';
import type { LoopLayer, SampleRole, ThemeId } from './themes.js';
import type { PlayerPose } from './presence.js';

export type Vec3 = { x: number; y: number; z: number };

export type FxId = 'reverb' | 'crush' | 'filter' | 'space' | 'wide' | 'swirl' | 'warp';

export const FX_IDS = ['filter', 'crush', 'reverb', 'space', 'wide', 'swirl', 'warp'] as const;

export type FxSet = Record<FxId, boolean>;

export const blankFx = (): FxSet => Object.fromEntries(FX_IDS.map((fx) => [fx, false])) as FxSet;
export const everyFx = (): FxSet => Object.fromEntries(FX_IDS.map((fx) => [fx, true])) as FxSet;

export type StationKind =
  | 'rack'
  | 'echo'
  | 'crusher'
  | 'filter'
  | 'space'
  | 'wide'
  | 'swirl'
  | 'warp'
  | 'washer';

export type Gesture = 'grab' | 'grab-high' | 'catch' | 'place' | 'feed' | 'lob' | 'drop' | 'eject' | 'lever';

export type PlayerState = {
  id: string;
  name: string;
  color: string;
  position: Vec3;
  rotationY: number;
  heldBlockId: string | null;
  useUntil: number;
  gesture: Gesture | null;
  gestureAt: number;
  movingUntil: number;
  joinedAt: number;
  jumpAt: number;
};

export type BlockStatus =
  | 'racked'
  | 'world'
  | 'held'
  | 'thrown'
  | 'station'
  | 'deck';

export type BlockState = {
  id: string;
  sampleName: string;
  role: SampleRole;
  fx: FxSet;
  status: BlockStatus;
  position: Vec3;
  velocity: Vec3;
  holderId: string | null;
  stationId: string | null;
  rackId: string | null;
  slot: number;
  layer: LoopLayer | null;
  dealtInSection: number;
  dealtAt: number;
  floorSince: number;
  beacon: boolean;
};

export type StationState = {
  id: string;
  kind: StationKind;
  busyUntil: number;
  busySince: number;
  blockId: string | null;
  restockedAt: number;
};

export type MatchPhase = 'lobby' | 'playing' | 'complete';

export type GameState = {
  roomCode: string | null;
  hostId: string;
  phase: MatchPhase;
  revision: number;
  serverNow: number;
  themeId: ThemeId;
  runSeed: number;
  bpm: number;
  matchStartedAt: number | null;
  transportStartedAt: number | null;
  showEndsAt: number | null;
  hardEndsAt: number | null;
  completedAt: number | null;
  players: Record<string, PlayerState>;
  blocks: Record<string, BlockState>;
  stations: Record<string, StationState>;
  song: SongState;
  shelfShown: Record<string, number>;
  commitProgress: number;
  lastEvent: GameEvent | null;
};

export type GameEvent =
  | { id: string; at: number; type: 'taken'; name: string; role: SampleRole; rackId: string }
  | { id: string; at: number; type: 'processed'; fx: FxId | null; kind: StationKind; name: string; stationId: string }
  | { id: string; at: number; type: 'queued'; layer: LoopLayer; atBar: number; clearing: boolean }
  | { id: string; at: number; type: 'dropped'; layers: LoopLayer[]; coordinated: boolean }
  | { id: string; at: number; type: 'section-printed'; index: number; name: string; score: number; bars: number; playerId: string | null }
  | { id: string; at: number; type: 'overtime' }
  | { id: string; at: number; type: 'song-complete'; sections: number };

export type GameAction =
  | { type: 'JOIN_PLAYER'; player: Pick<PlayerState, 'id' | 'name' | 'color'>; now: number }
  | { type: 'LEAVE_PLAYER'; playerId: string; now: number }
  | { type: 'RESPAWN_PLAYER'; playerId: string; now: number }
  | { type: 'SET_THEME'; themeId: ThemeId | null; now: number }
  | { type: 'START_GAME'; now: number }
  | { type: 'PLAYER_TRANSFORM'; playerId: string; position: Vec3; rotationY: number; now: number }
  | { type: 'TAKE_RECORD'; playerId: string; stationId: string; now: number }
  | { type: 'PICKUP_BLOCK'; playerId: string; blockId: string; now: number }
  | { type: 'QUEUE_DROP'; playerId: string; blockId: string; now: number }
  | { type: 'QUEUE_CLEAR'; playerId: string; layer: LoopLayer; now: number }
  | { type: 'COMMIT_SECTION'; playerId: string; deltaMs: number; now: number; reading?: (MixReading & { signature: string }) | null }
  | { type: 'LOB_RECORD'; playerId: string; blockId: string; position: Vec3; velocity: Vec3; now: number }
  | { type: 'DROP_BLOCK'; playerId: string; blockId: string; position: Vec3; now: number }
  | { type: 'USE_STATION'; playerId: string; stationId: string; now: number }
  | { type: 'JUMP'; playerId: string; now: number }
  | { type: 'RESTART_GAME'; now: number }
  | { type: 'OPEN_LOBBY'; playerId: string; now: number }
  | { type: 'SET_AUDIOTOOL_USER'; playerId: string; displayName: string | null; now: number };

export type ClientToServerEvents = {
  'room:create': (payload: { playerKey: string; name: string; session: string; themeId?: ThemeId; runSeed?: number }, ack: (result: RoomJoinResult) => void) => void;
  'room:join': (payload: { code: string; playerKey: string; name: string; session: string; create?: boolean; themeId?: ThemeId; runSeed?: number }, ack: (result: RoomJoinResult) => void) => void;
  'room:leave': (payload: { code: string }) => void;
  'room:start': (payload: { code: string }, ack?: (ok: boolean) => void) => void;
  'game:action': (payload: { code: string; action: GameAction; seq?: number }, ack?: () => void) => void;
  'time:ping': (clientSentAt: number, ack: (serverNow: number) => void) => void;
  'link:pace': (ms: number) => void;
};

export type ServerToClientEvents = {
  'room:state': (payload: { state: GameState; serverNow: number; acks?: Record<string, number> }) => void;
  'player:poses': (payload: { poses: PlayerPose[] }) => void;
  'room:error': (message: string) => void;
  'room:closed': (message: string) => void;
};

export type RoomJoinResult =
  | { ok: true; code: string; playerId: string; state: GameState }
  | { ok: false; error: string };
