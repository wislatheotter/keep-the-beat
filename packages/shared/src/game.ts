import { avoidSongArc, isAtSongArc } from './songArc.js';
import {
  BLOCK_REST_Y,
  COMMIT_HOLD_SECONDS,
  CRUSH_MS,
  DECK_CATCH_RADIUS,
  DECK_PLINTH_RADIUS,
  DECK_POSITION,
  DECK_EJECT_DISTANCE,
  DECK_EJECT_SPEED_Y,
  DECK_USE_RADIUS,
  ECHO_TRAVEL_MS,
  EJECT_DISTANCE,
  EJECT_LAUNCH_SPEED_Y,
  FILTER_MS,
  FLOOR_LIFETIME_MS,
  MAX_PLAYERS,
  MIN_SECTION_MS,
  PLAYER_COLORS,
  PLAYER_RADIUS_LIMIT,
  PLAYER_Y,
  RACKS,
  RACK_SLOTS,
  RECORD_REACH,
  REPLAY_HALF_WIDTH,
  REPLAY_INTRO_MS,
  SHOW_INTRO_MS,

  SHOW_OVERTIME_MS,
  SHOW_REGULAR_MS,
  STATIONS,
  STATION_BY_ID,
  STATION_HANDOFF_AT,
  STATION_USE_RADIUS,
  FALL_ACCEL,
  type StationDefinition,
} from './constants.js';
import {
  clamp,
  clampToStage,
  deckDistance,
  distanceXZ,
  isOnDeck,
  machineUnder,
  normalizeXZ,
  platterPosition,
  rackSlotPosition,
  stationEntry,
  stationExit,
  stationEjectDirection,
  stationNearestPoint,
  stationPosition,
  stationRadial,
} from './math.js';
import {
  LOOP_LAYERS,
  THEME_IDS,
  sample as gameSample,
  theme,
  type GameSample,
  type LoopLayer,
  type SampleRole,
  type ThemeId,
} from './themes.js';
import { dealRack, dedupe, makeRunSeed, openingRecord, sectionDeal } from './stock.js';
import { isAirborne, replaySlotX } from './replay.js';
import { POSE_STALE_MS } from './presence.js';
import { PACE_FADE_MS, PACE_GRACE_MS, evaluateSection, paceLine } from './evaluate.js';
import { mixSignature, plausibleReading, type MixReading } from './mix.js';
import {
  SECTION_COUNT,
  SECTION_PLAN,
  activeLayerCount,
  barPosition,
  barToTime,
  createSongState,
  LANDINGS_PER_LAYER,
  REWARD_RING,
  mixEnergy,
  songEnergy,
  nextBeatBar,
  nextPhraseBar,
  SILENT_LEAD_MS,
  snapshotLayers,
  songCursorBar,
  type Reward,
  type CommittedSection,
  type QueuedChange,
  type SongState,
} from './song.js';
import { FX_IDS, blankFx } from './types.js';
import type {
  BlockState,
  FxId,
  FxSet,
  GameAction,
  GameEvent,
  GameState,
  Gesture,
  PlayerState,
  StationState,
  Vec3,
} from './types.js';

const id = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
const rand = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;
const noFx = blankFx;

const STATION_FX: Partial<Record<StationDefinition['kind'], FxId>> = {
  echo: 'reverb',
  crusher: 'crush',
  filter: 'filter',
  space: 'space',
  wide: 'wide',
  swirl: 'swirl',
  warp: 'warp',
};

const isWasher = (kind: StationDefinition['kind']) => kind === 'washer';

export const isTreated = (fx: FxSet) => FX_IDS.some((id) => fx[id]);

const STATION_DURATION: Record<StationDefinition['kind'], number> = {
  rack: 0,
  echo: ECHO_TRAVEL_MS,
  crusher: CRUSH_MS,
  filter: FILTER_MS,
  space: 1900, wide: 1800, swirl: 1800, warp: 1800, washer: 1950,
};


const SURGE_MS = 620;

const event = <T extends GameEvent['type']>(
  at: number,
  type: T,
  payload: Omit<Extract<GameEvent, { type: T }>, 'id' | 'at' | 'type'>,
): Extract<GameEvent, { type: T }> => ({ id: id('evt'), at, type, ...payload } as Extract<GameEvent, { type: T }>);

function freshStations(now: number): Record<string, StationState> {
  return Object.fromEntries(STATIONS.map((station) => [station.id, {
    id: station.id,
    kind: station.kind,
    busyUntil: 0,
    busySince: now,
    blockId: null,
    restockedAt: now,
  } satisfies StationState]));
}

function spawnAngle(index: number) {
  const seat = index % MAX_PLAYERS;
  const side = seat === 0 ? 0 : seat % 2 === 1 ? 1 : -1;
  return side * Math.ceil(seat / 2) * 0.15;
}

const SPAWN_RADIUS = DECK_PLINTH_RADIUS + 2.4;

function spawnPosition(index: number): Vec3 {
  const angle = spawnAngle(index);
  return { x: DECK_POSITION.x + Math.sin(angle) * SPAWN_RADIUS, y: PLAYER_Y, z: DECK_POSITION.z + Math.cos(angle) * SPAWN_RADIUS };
}

function spawnRotation(index: number) {
  return spawnAngle(index) + Math.PI;
}

function freeSpawn(state: GameState, self: string): number {
  const others = Object.values(state.players).filter((player) => player.id !== self);
  let best = 0;
  let bestClearance = -Infinity;
  for (let seat = 0; seat < MAX_PLAYERS; seat += 1) {
    const mark = spawnPosition(seat);
    const clearance = Math.min(Infinity, ...others.map((player) => distanceXZ(player.position, mark)));
    if (clearance > bestClearance + 1e-6) {
      best = seat;
      bestClearance = clearance;
    }
  }
  return best;
}

function arrivalPose(state: GameState, self: string, index: number): { position: Vec3; rotationY: number } {
  if (state.phase === 'complete') {
    const count = Object.keys(state.players).length;
    return { position: platformPosition(replaySlotX(index, Math.max(count, index + 1))), rotationY: 0 };
  }
  const seat = freeSpawn(state, self);
  return { position: spawnPosition(seat), rotationY: spawnRotation(seat) };
}

function freeColor(players: Record<string, PlayerState>, wanted?: string) {
  const taken = new Set(Object.values(players).map((player) => player.color));
  if (wanted && !taken.has(wanted)) return wanted;
  return PLAYER_COLORS.find((color) => !taken.has(color)) ?? wanted ?? PLAYER_COLORS[0]!;
}

function platformPosition(x: number): Vec3 {
  return { x: clamp(x, -REPLAY_HALF_WIDTH, REPLAY_HALF_WIDTH), y: PLAYER_Y, z: 0 };
}

export function applyPlayerPose(
  state: GameState,
  playerId: string,
  pose: { t: number; x: number; y: number; z: number; yaw: number; moving?: boolean },
): boolean {
  const player = state.players[playerId];
  if (!player) return false;

  let next: Vec3;
  if (state.phase === 'complete') {
    if (state.completedAt !== null && pose.t < state.completedAt + REPLAY_INTRO_MS) return false;
    next = platformPosition(pose.x);
  } else {
    next = avoidSongArc(clampToStage({ x: pose.x, y: PLAYER_Y, z: pose.z }, PLAYER_RADIUS_LIMIT));
  }

  const stepped = distanceXZ(player.position, next) > 0.025;
  player.position = next;
  player.rotationY = pose.yaw;
  player.movingUntil = pose.moving === undefined
    ? (stepped ? pose.t + POSE_STALE_MS : player.movingUntil)
    : (pose.moving ? pose.t + POSE_STALE_MS : 0);
  if (player.heldBlockId) {
    const block = state.blocks[player.heldBlockId];
    if (block) block.position = { x: player.position.x, y: 1.8, z: player.position.z };
  }
  return true;
}

export function roomHasSeat(state: Pick<GameState, 'players'>): boolean {
  return Object.keys(state.players).length < MAX_PLAYERS;
}

export function createInitialGame(
  host: { id: string; name: string; color?: string },
  roomCode: string | null = null,
  now = Date.now(),
  opening: { themeId?: ThemeId; runSeed?: number } = {},
): GameState {
  const themeId = opening.themeId ?? rand(THEME_IDS);
  const player: PlayerState = {
    id: host.id,
    name: cleanPlayerName(host.name) || 'Player',
    color: host.color ?? PLAYER_COLORS[0]!,
    position: spawnPosition(0),
    rotationY: spawnRotation(0),
    heldBlockId: null,
    useUntil: 0,
    gesture: null,
    gestureAt: 0,
    movingUntil: 0,
    joinedAt: now,
    jumpAt: 0,
  };
  return {
    roomCode,
    hostId: host.id,
    phase: 'lobby',
    revision: 0,
    serverNow: now,
    themeId,
    runSeed: opening.runSeed ?? makeRunSeed(),
    bpm: theme(themeId).bpm,
    matchStartedAt: null,
    transportStartedAt: null,
    showEndsAt: null,
    hardEndsAt: null,
    completedAt: null,
    players: { [host.id]: player },
    blocks: {},
    stations: freshStations(now),
    song: createSongState(themeId),
    shelfShown: {},
    commitProgress: 0,
    lastEvent: null,
  };
}

const MAX_NAME = 24;

export function cleanPlayerName(raw: string) {
  const folded = Array.from(raw.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim());
  if (folded.length <= MAX_NAME) return folded.join('');
  return `${folded.slice(0, MAX_NAME - 1).join('').trim()}…`;
}

function cloneState(input: GameState): GameState {
  const { committed, rewards, distinctSamples } = input.song;
  const state = structuredClone({
    ...input,
    shelfShown: EMPTY_SHELF,
    song: { ...input.song, committed: EMPTY_LIST, rewards: EMPTY_LIST, distinctSamples: EMPTY_LIST },
  }) as GameState;
  state.shelfShown = { ...input.shelfShown };
  state.song.committed = committed.slice();
  state.song.rewards = rewards.slice();
  state.song.distinctSamples = distinctSamples.slice();
  return state;
}
const EMPTY_SHELF: GameState['shelfShown'] = {};
const EMPTY_LIST: never[] = [];

export function applyGameAction(input: GameState, action: GameAction): GameState {
  const state = cloneState(input);
  state.serverNow = action.now;
  state.revision += 1;

  const editing = state.phase === 'playing'
    && action.now >= (state.transportStartedAt ?? -Infinity)
    && action.now < (state.hardEndsAt ?? Infinity);

  switch (action.type) {
    case 'JOIN_PLAYER': {
      if (state.players[action.player.id]) break;
      if (!roomHasSeat(state)) break;
      const index = Object.keys(state.players).length;
      const arrival = arrivalPose(state, action.player.id, index);
      state.players[action.player.id] = {
        id: action.player.id,
        name: cleanPlayerName(action.player.name) || 'Player',
        color: freeColor(state.players, action.player.color),
        position: arrival.position,
        rotationY: arrival.rotationY,
        heldBlockId: null,
        useUntil: 0,
        gesture: null,
        gestureAt: 0,
        movingUntil: 0,
        joinedAt: action.now,
        jumpAt: 0,
      };
      if (!state.players[state.hostId]) state.hostId = action.player.id;
      break;
    }
    case 'LEAVE_PLAYER': {
      const player = state.players[action.playerId];
      if (!player) break;
      if (player.heldBlockId) dropHeldBlock(state, player, action.now);
      delete state.players[action.playerId];
      if (state.hostId === action.playerId) {
        const left = Object.keys(state.players);
        state.hostId = left.length ? rand(left) : '';
      }
      break;
    }
    case 'RESPAWN_PLAYER': {
      const player = state.players[action.playerId];
      if (!player) break;
      if (player.heldBlockId) dropHeldBlock(state, player, action.now);
      const arrival = arrivalPose(state, player.id, Object.keys(state.players).indexOf(player.id));
      player.position = arrival.position;
      player.rotationY = arrival.rotationY;
      player.heldBlockId = null;
      player.useUntil = 0;
      player.gesture = null;
      player.gestureAt = 0;
      player.movingUntil = 0;
      player.jumpAt = 0;
      player.joinedAt = action.now;
      break;
    }
    case 'SET_THEME': {
      if (state.phase !== 'lobby') break;
      const themeId: ThemeId = action.themeId && THEME_IDS.includes(action.themeId)
        ? action.themeId
        : rand(THEME_IDS);
      state.themeId = themeId;
      state.bpm = theme(themeId).bpm;
      state.song = createSongState(themeId);
      break;
    }
    case 'START_GAME': {
      if (state.phase === 'playing') break;
      startRound(state, action.now);
      break;
    }
    case 'PLAYER_TRANSFORM': {
      applyPlayerPose(state, action.playerId, {
        t: action.now,
        x: action.position.x,
        y: action.position.y,
        z: action.position.z,
        yaw: action.rotationY,
      });
      break;
    }
    case 'QUEUE_DROP': {
      if (!editing) break;
      const player = state.players[action.playerId];
      const block = player?.heldBlockId ? state.blocks[player.heldBlockId] : null;
      if (!player || !block || block.id !== action.blockId) break;
      if (deckDistance(player.position) > DECK_USE_RADIUS) break;
      placeRecord(state, block, player.id, action.now);
      if (!player.heldBlockId) gesture(player, 'place', action.now);
      break;
    }
    case 'QUEUE_CLEAR': {
      if (!editing) break;
      const player = state.players[action.playerId];
      if (!player || player.heldBlockId) break;
      if (deckDistance(player.position) > DECK_USE_RADIUS) break;
      const onPlatter = recordOnPlatter(state, action.layer);
      if (!onPlatter && !state.song.layers[action.layer]?.sampleName) break;
      if (onPlatter) ejectFromDeck(state, onPlatter, player.position);
      gesture(player, 'eject', action.now);
      queueChange(state, action.layer, null, null, noFx(), player.id, action.now);
      break;
    }
    case 'COMMIT_SECTION': {
      if (!editing) break;
      const player = state.players[action.playerId];
      if (!player || player.heldBlockId) break;
      if (!isAtSongArc(player.position)) break;
      if (!Number.isFinite(action.deltaMs) || action.deltaMs <= 0) break;
      if (!canPrint(state, action.now)) break;
      player.useUntil = action.now + 260;
      gesture(player, 'lever', action.now);
      state.commitProgress = clamp(
        state.commitProgress + action.deltaMs / (COMMIT_HOLD_SECONDS * 1000),
        0,
        1,
      );
      if (state.commitProgress >= 1) {
        const reading = action.reading && action.reading.signature === mixSignature(state.song.layers)
          ? plausibleReading(action.reading)
          : null;
        printSection(state, action.now, player.id, reading);
        if (state.song.sectionIndex >= SECTION_COUNT) endShow(state, action.now, false);
        else restockRacks(state, action.now);
      }
      break;
    }
    case 'TAKE_RECORD': {
      if (!editing) break;
      const player = state.players[action.playerId];
      if (!player || player.heldBlockId) break;
      takeFromRack(state, player, action.stationId, action.now);
      break;
    }
    case 'PICKUP_BLOCK': {
      if (!editing) break;
      const player = state.players[action.playerId];
      const block = state.blocks[action.blockId];
      if (!player || !block || player.heldBlockId) break;
      if (block.status === 'racked') {
        if (block.rackId) takeFromRack(state, player, block.rackId, action.now);
        break;
      }
      const machine = handingBack(state, block, action.now);
      if (machine) {
        if (distanceXZ(player.position, stationExit(machine)) > RECORD_REACH) break;
        finishJob(state, machine, state.stations[machine.id]!, action.now);
        gesture(player, 'catch', action.now);
        lift(state, player, block, action.now);
        break;
      }
      if (block.status !== 'world' && block.status !== 'thrown') break;
      if (distanceXZ(player.position, block.position) > RECORD_REACH) break;
      gesture(player, block.status === 'thrown' ? 'catch' : 'grab', action.now);
      lift(state, player, block, action.now);
      break;
    }
    case 'LOB_RECORD': {
      if (!editing) break;
      const player = state.players[action.playerId];
      const block = state.blocks[action.blockId];
      if (!player || !block || player.heldBlockId !== block.id) break;
      player.heldBlockId = null;
      gesture(player, 'lob', action.now);
      block.status = 'thrown';
      block.holderId = player.id;
      block.beacon = false;
      block.position = { ...action.position };
      block.velocity = { ...action.velocity };
      break;
    }
    case 'DROP_BLOCK': {
      if (!editing) break;
      const player = state.players[action.playerId];
      const block = state.blocks[action.blockId];
      if (!player || !block || player.heldBlockId !== block.id) break;
      player.heldBlockId = null;
      gesture(player, 'drop', action.now);
      restOnFloor(block, action.now);
      block.holderId = null;
      block.beacon = false;
      block.position = clampToStage({ x: action.position.x, y: BLOCK_REST_Y, z: action.position.z });
      block.velocity = { x: 0, y: 0, z: 0 };
      break;
    }
    case 'USE_STATION': {
      if (!editing) break;
      useStation(state, action.playerId, action.stationId, action.now);
      break;
    }
    case 'JUMP': {
      if (state.phase !== 'complete') break;
      if (state.completedAt !== null && action.now < state.completedAt + REPLAY_INTRO_MS) break;
      const player = state.players[action.playerId];
      if (!player || isAirborne(player.jumpAt, action.now)) break;
      player.jumpAt = action.now;
      break;
    }
    case 'RESTART_GAME': {
      state.runSeed = makeRunSeed();
      startRound(state, action.now);
      break;
    }
    case 'OPEN_LOBBY': {
      if (state.phase !== 'complete' || action.playerId !== state.hostId) break;
      openLobby(state, action.now);
      break;
    }
    case 'SET_AUDIOTOOL_USER': {
      const player = state.players[action.playerId];
      if (!player) break;
      const name = cleanPlayerName(action.displayName ?? '');
      if (name) player.name = name;
      break;
    }
  }
  return state;
}

function openLobby(state: GameState, now: number) {
  state.phase = 'lobby';
  state.runSeed = makeRunSeed();
  state.bpm = theme(state.themeId).bpm;
  state.matchStartedAt = null;
  state.transportStartedAt = null;
  state.showEndsAt = null;
  state.hardEndsAt = null;
  state.completedAt = null;
  state.blocks = {};
  state.stations = freshStations(now);
  state.song = createSongState(state.themeId);
  state.shelfShown = {};
  state.commitProgress = 0;
  state.lastEvent = null;
  let index = 0;
  for (const player of Object.values(state.players)) {
    player.heldBlockId = null;
    player.useUntil = 0;
    player.gesture = null;
    player.gestureAt = 0;
    player.movingUntil = 0;
    player.jumpAt = 0;
    player.position = spawnPosition(index);
    player.rotationY = spawnRotation(index);
    index += 1;
  }
}

function startRound(state: GameState, now: number) {
  const kit = theme(state.themeId);
  state.phase = 'playing';
  state.bpm = kit.bpm;
  const start = now + SHOW_INTRO_MS;
  state.matchStartedAt = start;
  state.transportStartedAt = start;
  state.showEndsAt = start + SHOW_REGULAR_MS;
  state.hardEndsAt = start + SHOW_REGULAR_MS + SHOW_OVERTIME_MS;
  state.completedAt = null;
  state.blocks = {};
  state.stations = freshStations(now);
  state.commitProgress = 0;
  state.song = createSongState(state.themeId);
  state.song.sectionStartedAt = start;
  state.shelfShown = {};

  const opening = openingRecord(state.themeId, state.runSeed);
  if (opening) {
    const block = createBlock(state, opening.sampleName, opening.role, platterPosition('DRUMS'), 0, now);
    block.status = 'deck';
    block.layer = 'DRUMS';
    block.beacon = false;
    state.song.layers.DRUMS = {
      sampleName: opening.sampleName,
      fx: noFx(),
      blockId: block.id,
      startedAtBar: 0,
      changedBy: null,
    };
    state.song.distinctSamples.push(opening.sampleName);
  }

  state.song.baseline = snapshotLayers(state.song);
  state.song.sectionSounded = LOOP_LAYERS.map((layer) => state.song.layers[layer].sampleName).filter((name): name is string => !!name);
  restockRacks(state, now);
  state.song.energy = mixEnergy(state.song);
  state.song.energyAt = now;
  state.lastEvent = null;
  let index = 0;
  for (const player of Object.values(state.players)) {
    player.heldBlockId = null;
    player.useUntil = 0;
    player.gesture = null;
    player.gestureAt = 0;
    player.jumpAt = 0;
    player.position = spawnPosition(index);
    player.rotationY = spawnRotation(index);
    index += 1;
  }
}

export function physicalSamples(state: GameState): Set<string> {
  const names = new Set(Object.values(state.blocks).map((block) => block.sampleName));
  for (const layer of LOOP_LAYERS) {
    const playing = state.song.layers[layer].sampleName;
    if (playing) names.add(playing);
  }
  for (const change of state.song.queued) if (change.sampleName) names.add(change.sampleName);
  return names;
}

function restockRacks(state: GameState, now: number) {
  for (const block of Object.values(state.blocks)) {
    if (block.status === 'racked') delete state.blocks[block.id];
  }

  const section = state.song.sectionIndex;
  const deal = sectionDeal(state.themeId, state.runSeed, section, physicalSamples(state), [
    shownIn(state, section - 1),
    shownIn(state, section - 2),
  ]);
  for (const rack of RACKS) {
    const role = rack.role as LoopLayer;
    const offered = deal[role] ?? [];
    for (let slot = 0; slot < Math.min(RACK_SLOTS, offered.length); slot += 1) {
      rackRecord(state, rack.id, slot, offered[slot]!, now);
    }
    const station = state.stations[rack.id];
    if (station) station.restockedAt = now;
  }
}

function lift(state: GameState, player: PlayerState, block: BlockState, now: number) {
  player.heldBlockId = block.id;
  block.status = 'held';
  block.holderId = player.id;
  block.stationId = null;
  block.rackId = null;
  block.slot = 0;
  block.layer = null;
  block.beacon = false;
  block.velocity = { x: 0, y: 0, z: 0 };
  block.position = { x: player.position.x, y: 1.8, z: player.position.z };
  player.useUntil = now + 260;
}

function takeFromRack(state: GameState, player: PlayerState, rackId: string, now: number) {
  const rack = STATION_BY_ID[rackId];
  if (!rack || rack.kind !== 'rack') return;
  const [top] = rackContents(state, rackId);
  if (!top) return;
  if (distanceXZ(player.position, top.position) > RECORD_REACH) return;
  gesture(player, 'grab-high', now);
  lift(state, player, top, now);
  const entry = gameSample(top.sampleName, state.themeId);
  state.lastEvent = event(now, 'taken', {
    name: entry?.name ?? 'record',
    role: top.role,
    rackId,
  });
  feedCrate(state, rackId, now);
}

function feedCrate(state: GameState, rackId: string, now: number) {
  const rack = STATION_BY_ID[rackId]!;
  const contents = rackContents(state, rackId);
  contents.forEach((block, slot) => {
    if (block.slot === slot) return;
    block.slot = slot;
    block.position = rackSlotPosition(rack, slot);
    if (slot === 0) block.dealtAt = now;
  });
  if (state.phase !== 'playing' || contents.length >= RACK_SLOTS) return;
  const [next] = refillCandidates(state, rackId, 1);
  if (next) rackRecord(state, rackId, contents.length, next, now);
}

export function refillCandidates(state: GameState, rackId: string, count: number): GameSample[] {
  const rack = STATION_BY_ID[rackId];
  if (!rack?.role) return [];
  const section = Math.min(state.song.sectionIndex, SECTION_COUNT - 1);
  const alongside = rackContents(state, rackId)
    .map((block) => gameSample(block.sampleName, state.themeId))
    .filter((entry): entry is GameSample => !!entry);
  return dealRack(state.themeId, state.runSeed, section, rack.role, {
    unavailable: physicalSamples(state),
    avoid: [shownIn(state, section - 1)],
    alongside,
    count,
  });
}

function rackRecord(state: GameState, rackId: string, slot: number, entry: GameSample, now: number) {
  const rack = STATION_BY_ID[rackId]!;
  const block = createBlock(state, entry.sampleName, entry.role, rackSlotPosition(rack, slot), state.song.sectionIndex, now);
  block.status = 'racked';
  block.rackId = rackId;
  block.slot = slot;
  block.beacon = true;
  state.shelfShown[entry.sampleName] = state.song.sectionIndex;
  return block;
}

function shownIn(state: GameState, section: number): Set<string> {
  const names = new Set<string>();
  if (section < 0) return names;
  for (const [sampleName, shown] of Object.entries(state.shelfShown)) {
    if (shown === section) names.add(sampleName);
  }
  return names;
}

export function stockForecast(state: GameState): GameSample[] {
  const known = (name: string | null | undefined) => (name ? gameSample(name, state.themeId) : null);
  const urgent: GameSample[] = [];
  for (const layer of LOOP_LAYERS) {
    const entry = known(state.song.layers[layer].sampleName);
    if (entry) urgent.push(entry);
  }
  for (const change of state.song.queued) {
    const entry = known(change.sampleName);
    if (entry) urgent.push(entry);
  }
  const physical: GameSample[] = [];
  for (const block of Object.values(state.blocks)) {
    const entry = known(block.sampleName);
    if (entry) physical.push(entry);
  }

  const refills = RACKS.flatMap((rack) => refillCandidates(state, rack.id, 2));

  const section = state.song.sectionIndex;
  const ahead: GameSample[] = [];
  if (section + 1 < SECTION_COUNT) {
    const staying = new Set(Object.values(state.blocks)
      .filter((block) => block.status !== 'racked')
      .map((block) => block.sampleName));
    const next = sectionDeal(state.themeId, state.runSeed, section + 1, staying,
      [shownIn(state, section), shownIn(state, section - 1)], RACK_SLOTS + 1);
    ahead.push(...LOOP_LAYERS.flatMap((layer) => next[layer]));
    if (section + 2 < SECTION_COUNT) {
      const after = sectionDeal(state.themeId, state.runSeed, section + 2, staying,
        [new Set(ahead.map((entry) => entry.sampleName))]);
      ahead.push(...LOOP_LAYERS.flatMap((layer) => after[layer]));
    }
  }
  return dedupe([...urgent, ...physical, ...refills, ...ahead]);
}

export function rackContents(state: GameState, rackId: string): BlockState[] {
  return Object.values(state.blocks)
    .filter((block) => block.status === 'racked' && block.rackId === rackId)
    .sort((a, b) => a.slot - b.slot);
}

export function stationAvailability(
  state: GameState,
  playerId: string,
  stationId: string,
  now: number,
): { ok: boolean; reason?: string } {
  const player = state.players[playerId];
  if (!player) return { ok: false, reason: 'unavailable' };
  const held = player.heldBlockId ? state.blocks[player.heldBlockId] : null;
  return machineTakes(state, stationId, held?.fx ?? null, now);
}

export function machineTakes(
  state: Pick<GameState, 'phase' | 'stations'>,
  stationId: string,
  fx: FxSet | null,
  now: number,
): { ok: boolean; reason?: string } {
  const definition = STATION_BY_ID[stationId];
  const station = state.stations[stationId];
  if (!definition || !station) return { ok: false, reason: 'unavailable' };
  if (state.phase !== 'playing') return { ok: false, reason: 'not playing' };
  if (definition.kind === 'rack') return { ok: false, reason: 'take a record' };
  if (now < station.busyUntil) return { ok: false, reason: 'busy' };
  if (!fx) return { ok: false, reason: 'bring a record' };
  if (isWasher(definition.kind)) return isTreated(fx) ? { ok: true } : { ok: false, reason: 'nothing to strip' };
  const stamp = STATION_FX[definition.kind];
  if (stamp && fx[stamp]) return { ok: false, reason: 'already done' };
  return { ok: true };
}

export function handingBack(
  state: Pick<GameState, 'stations'>,
  block: Pick<BlockState, 'status' | 'stationId'>,
  now: number,
): StationDefinition | null {
  if (block.status !== 'station' || !block.stationId) return null;
  const station = state.stations[block.stationId];
  const definition = STATION_BY_ID[block.stationId];
  if (!station || !definition || !station.busyUntil) return null;
  return now >= station.busySince + (station.busyUntil - station.busySince) * STATION_HANDOFF_AT ? definition : null;
}

function useStation(state: GameState, playerId: string, stationId: string, now: number) {
  const player = state.players[playerId];
  const definition = STATION_BY_ID[stationId];
  const station = state.stations[stationId];
  if (!player || !definition || !station) return;
  if (distanceXZ(player.position, stationPosition(definition)) > STATION_USE_RADIUS * 2.2) return;
  if (!stationAvailability(state, playerId, stationId, now).ok) return;

  player.useUntil = now + Math.max(240, STATION_DURATION[definition.kind]);
  gesture(player, 'feed', now);
  const block = state.blocks[player.heldBlockId!]!;
  player.heldBlockId = null;
  feedMachine(definition, station, block, now);
}

function feedMachine(definition: StationDefinition, station: StationState, block: BlockState, now: number) {
  station.busySince = now;
  station.busyUntil = now + STATION_DURATION[definition.kind];
  block.status = 'station';
  block.holderId = null;
  block.stationId = station.id;
  block.beacon = false;
  block.velocity = { x: 0, y: 0, z: 0 };
  const entry = stationEntry(definition);
  block.position = { x: entry.x, y: 1.25, z: entry.z };
  station.blockId = block.id;
}

function finishJob(state: GameState, definition: StationDefinition, station: StationState, now: number) {
  station.busyUntil = 0;
  const fx = STATION_FX[definition.kind];
  const block = station.blockId ? state.blocks[station.blockId] : null;
  station.blockId = null;
  if (!block || block.status !== 'station') return;
  if (isWasher(definition.kind)) block.fx = noFx();
  else if (fx) block.fx[fx] = true;
  block.beacon = true;
  popOut(block, definition);
  const entry = gameSample(block.sampleName, state.themeId);
  state.lastEvent = event(now, 'processed', {
    fx: fx ?? null,
    kind: definition.kind,
    name: entry?.name ?? 'record',
    stationId: station.id,
  });
  registerActivity(state, now);
}

function createBlock(
  state: GameState,
  sampleName: string,
  role: SampleRole,
  position: Vec3,
  dealtInSection: number,
  now: number,
): BlockState {
  const blockId = id('rec');
  const block: BlockState = {
    id: blockId,
    sampleName,
    role,
    fx: noFx(),
    status: 'world',
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    holderId: null,
    stationId: null,
    rackId: null,
    slot: 0,
    layer: null,
    dealtInSection,
    dealtAt: now,
    floorSince: now,
    beacon: true,
  };
  state.blocks[blockId] = block;
  return block;
}

function placeRecord(state: GameState, block: BlockState, playerId: string, now: number) {
  const layer = block.role as LoopLayer;
  if (!LOOP_LAYERS.includes(layer)) return;
  const holder = block.holderId ? state.players[block.holderId] : null;
  if (holder && holder.heldBlockId === block.id) holder.heldBlockId = null;
  const previous = recordOnPlatter(state, layer);
  if (previous && previous.id !== block.id) ejectFromDeck(state, previous, holder?.position ?? null);
  block.status = 'deck';
  block.layer = layer;
  block.holderId = null;
  block.beacon = false;
  block.velocity = { x: 0, y: 0, z: 0 };
  block.position = platterPosition(layer);
  queueChange(state, layer, block.sampleName, block.id, block.fx, playerId, now);
}

function queueChange(
  state: GameState,
  layer: LoopLayer,
  sampleName: string | null,
  blockId: string | null,
  fx: FxSet,
  playerId: string,
  now: number,
) {
  const atBar = sampleName ? landingBar(state, layer, now) : nextPhraseBar(state.transportStartedAt, state.bpm, now, state.song.phaseBar);
  for (const change of state.song.queued) {
    if (change.layer !== layer) continue;
    const displaced = change.blockId ? state.blocks[change.blockId] : null;
    if (displaced && displaced.id !== blockId) ejectFromDeck(state, displaced);
  }
  state.song.queued = state.song.queued.filter((change) => change.layer !== layer);
  state.song.queued.push({ id: id('q'), layer, sampleName, blockId, fx: { ...fx }, atBar, byPlayerId: playerId });
  registerActivity(state, now);
  state.lastEvent = event(now, 'queued', { layer, atBar, clearing: sampleName === null });
}

function landingBar(state: GameState, layer: LoopLayer, now: number) {
  const song = state.song;
  const phrase = nextPhraseBar(state.transportStartedAt, state.bpm, now, song.phaseBar);
  const bar = barPosition(state.transportStartedAt, state.bpm, now);
  let coming = Infinity;
  for (const other of LOOP_LAYERS) {
    const pending = song.queued.find((change) => change.layer === other);
    const due = !!pending && pending.atBar <= bar;
    if ((due ? pending.sampleName : song.layers[other].sampleName) !== null) return phrase;
    if (other !== layer && pending?.sampleName && !due) coming = Math.min(coming, pending.atBar);
  }
  if (coming !== Infinity) {
    return barToTime(state.transportStartedAt, state.bpm, coming) - now >= SILENT_LEAD_MS ? coming : phrase;
  }
  song.phaseBar = nextBeatBar(state.transportStartedAt, state.bpm, now);
  return song.phaseBar;
}

function applyDueChanges(state: GameState, now: number): boolean {
  const song = state.song;
  if (song.queued.length === 0) return false;
  const bar = barPosition(state.transportStartedAt, state.bpm, now);

  const due = song.queued.filter((change) => change.atBar <= bar);
  if (due.length === 0) return false;
  song.queued = song.queued.filter((change) => change.atBar > bar);

  const byBar = new Map<number, QueuedChange[]>();
  for (const change of due) {
    if (!byBar.has(change.atBar)) byBar.set(change.atBar, []);
    byBar.get(change.atBar)!.push(change);
  }

  for (const [atBar, batch] of [...byBar.entries()].sort((a, b) => a[0] - b[0])) {
    const coordinated = new Set(batch.map((change) => change.layer)).size >= 2;
    for (const change of batch) {
      const outgoing = song.layers[change.layer].blockId;
      if (outgoing && outgoing !== change.blockId) {
        const previous = state.blocks[outgoing];
        if (previous && previous.status === 'deck' && previous.layer === change.layer) ejectFromDeck(state, previous);
      }
      song.layers[change.layer] = {
        sampleName: change.sampleName,
        fx: { ...change.fx },
        blockId: change.blockId,
        startedAtBar: atBar,
        changedBy: change.byPlayerId,
      };
      song.sectionChanges += 1;
      if (change.sampleName && !song.distinctSamples.includes(change.sampleName)) {
        song.distinctSamples.push(change.sampleName);
      }
      rewardLanding(state, change, now);
    }
    if (coordinated) {
      song.sectionCoordinated += 1;
      const extra = batch.filter((change) => change.sampleName).length - 1;
      if (extra > 0) pushReward(state, { playerId: batch[batch.length - 1]!.byPlayerId, layer: batch[batch.length - 1]!.layer, kind: 'together' }, now);
    }
    state.lastEvent = event(now, 'dropped', { layers: batch.map((change) => change.layer), coordinated });
  }
  return true;
}

function ejectFromDeck(state: GameState, block: BlockState, toward: Vec3 | null = null) {
  const from = block.layer ? platterPosition(block.layer) : block.position;
  const bearing = normalizeXZ(fromDeck(toward ?? from));
  const reach = Math.max(DECK_CATCH_RADIUS + 0.9, toward ? deckDistance(toward) : 0, deckDistance(from) + DECK_EJECT_DISTANCE * 0.8);
  const landing = { x: DECK_POSITION.x + bearing.x * reach, y: 0, z: DECK_POSITION.z + bearing.z * reach };
  const direction = normalizeXZ({ x: landing.x - from.x, y: 0, z: landing.z - from.z });
  const distance = distanceXZ(landing, from);
  block.status = 'thrown';
  block.layer = null;
  block.holderId = null;
  block.beacon = true;
  block.position = { x: from.x, y: 1.55, z: from.z };
  const drop = Math.max(0, 1.55 - BLOCK_REST_Y);
  const airtime = (DECK_EJECT_SPEED_Y + Math.sqrt(DECK_EJECT_SPEED_Y ** 2 + 2 * FALL_ACCEL * drop)) / FALL_ACCEL;
  const speed = distance / airtime;
  block.velocity = { x: direction.x * speed, y: DECK_EJECT_SPEED_Y, z: direction.z * speed };
}

const fromDeck = (position: Vec3): Vec3 => ({ x: position.x - DECK_POSITION.x, y: 0, z: position.z - DECK_POSITION.z });

export function recordOnPlatter(state: Pick<GameState, 'blocks'>, layer: LoopLayer): BlockState | null {
  for (const block of Object.values(state.blocks)) {
    if (block.status === 'deck' && block.layer === layer) return block;
  }
  return null;
}

export function targetLayers(song: SongState): LoopLayer[] {
  return LOOP_LAYERS.filter((layer) => {
    const pending = song.queued.find((change) => change.layer === layer);
    return (pending ? pending.sampleName : song.layers[layer].sampleName) !== null;
  });
}

export function canPrint(state: GameState, now: number): boolean {
  if (state.phase !== 'playing') return false;
  if (state.song.sectionIndex >= SECTION_COUNT) return false;
  return now - state.song.sectionStartedAt >= MIN_SECTION_MS;
}

export function msUntilPrintable(state: GameState, now: number): number {
  return Math.max(0, MIN_SECTION_MS - (now - state.song.sectionStartedAt));
}

function printSection(state: GameState, now: number, printedBy: string | null = null, reading: MixReading | null = null) {
  const song = state.song;
  const goal = SECTION_PLAN[song.sectionIndex];
  if (!goal) return;
  const layers = snapshotLayers(song);
  const evaluation = evaluateSection({
    themeId: state.themeId,
    runSeed: state.runSeed,
    goal,
    sectionIndex: song.sectionIndex,
    layers,
    baseline: song.baseline,
    history: song.committed.map((section) => ({ name: section.name, mix: section.mix })),
    reading,
    coordinated: song.sectionCoordinated,
    printedAt: now,
    transportStartedAt: state.transportStartedAt ?? now,
    showEndsAt: state.showEndsAt ?? now,
    sectionCount: SECTION_COUNT,
  });
  const score = evaluation.total;

  const startBar = songCursorBar(song);
  song.committed.push({
    index: song.sectionIndex,
    name: goal.name,
    startBar,
    endBar: startBar + goal.songBars,
    layers,
    score,
    evaluation: evaluation.lines,
    mix: evaluation.mix,
    printedBy,
    changes: song.sectionChanges,
    coordinated: song.sectionCoordinated,
    authoredMs: Math.max(0, now - song.sectionStartedAt),
  });
  pushReward(state, { playerId: printedBy, layer: null, kind: 'print' }, now);
  state.lastEvent = event(now, 'section-printed', {
    index: song.sectionIndex,
    name: goal.name,
    score,
    bars: goal.songBars,
    playerId: printedBy,
  });

  song.sectionIndex += 1;
  song.sectionChanges = 0;
  song.sectionCoordinated = 0;
  song.sectionSounded = LOOP_LAYERS.map((layer) => song.layers[layer].sampleName).filter((name): name is string => !!name);
  song.sectionLandings = {};
  song.baseline = layers;
  song.sectionStartBar = barPosition(state.transportStartedAt, state.bpm, now);
  song.sectionStartedAt = now;
  state.commitProgress = 0;
  state.song.surgeUntil = now + SURGE_MS * 2;
}

function rewardLanding(state: GameState, change: QueuedChange, now: number) {
  const song = state.song;
  if (!change.sampleName) return;
  if (song.sectionSounded.includes(change.sampleName)) return;
  song.sectionSounded.push(change.sampleName);
  const landings = song.sectionLandings[change.layer] ?? 0;
  if (landings >= LANDINGS_PER_LAYER) return;
  song.sectionLandings[change.layer] = landings + 1;
  pushReward(state, { playerId: change.byPlayerId, layer: change.layer, kind: 'land' }, now);
  if (isTreated(change.fx)) pushReward(state, { playerId: change.byPlayerId, layer: change.layer, kind: 'treated' }, now);
}

function pushReward(state: GameState, reward: Omit<Reward, 'id' | 'at'>, now: number) {
  state.song.rewards.push({ id: id('rw'), at: now, ...reward });
  if (state.song.rewards.length > REWARD_RING) state.song.rewards.splice(0, state.song.rewards.length - REWARD_RING);
}

function worthKeeping(song: SongState): boolean {
  if (song.sectionIndex >= SECTION_COUNT) return false;
  if (activeLayerCount(song) === 0) return false;
  if (song.committed.length === 0) return true;
  if (song.sectionChanges > 0) return true;
  const previous = song.committed[song.committed.length - 1]!;
  return LOOP_LAYERS.some((layer) => previous.layers[layer].sampleName !== song.layers[layer].sampleName);
}

function endShow(state: GameState, now: number, autoCommit: boolean) {
  if (autoCommit && worthKeeping(state.song)) printSection(state, now);
  state.phase = 'complete';
  state.completedAt = now;
  state.song.queued = [];
  state.commitProgress = 0;
  const players = Object.values(state.players);
  players.forEach((player, index) => {
    if (player.heldBlockId) dropHeldBlock(state, player, now);
    player.position = platformPosition(replaySlotX(index, players.length));
    player.rotationY = 0;
    player.movingUntil = 0;
    player.jumpAt = 0;
  });

  state.lastEvent = event(now, 'song-complete', { sections: state.song.committed.length });
}

export function isOvertime(state: GameState, now: number): boolean {
  return state.phase === 'playing' && state.showEndsAt !== null && now >= state.showEndsAt;
}

export type PaceStatus = {
  section: number;
  dueAt: number;
  graceEndsAt: number;
  lateMs: number;
  behind: number;
};

export function paceStatus(state: GameState, now: number): PaceStatus | null {
  if (state.phase !== 'playing' || !state.transportStartedAt || !state.showEndsAt) return null;
  const section = Math.min(state.song.sectionIndex, SECTION_COUNT - 1);
  const dueAt = paceLine(section, SECTION_COUNT, state.transportStartedAt, state.showEndsAt);
  const lateMs = now - dueAt;
  return {
    section,
    dueAt,
    graceEndsAt: dueAt + PACE_GRACE_MS,
    lateMs,
    behind: clamp((lateMs - PACE_GRACE_MS) / PACE_FADE_MS, 0, 1),
  };
}

export function showRemainingMs(state: GameState, now: number): number {
  if (state.phase !== 'playing') return 0;
  const target = isOvertime(state, now) ? state.hardEndsAt : state.showEndsAt;
  return Math.max(0, (target ?? now) - now);
}

export function showProgress(state: GameState, now: number): number {
  if (!state.transportStartedAt || !state.showEndsAt) return 0;
  const span = state.showEndsAt - state.transportStartedAt;
  if (span <= 0) return 1;
  return clamp((now - state.transportStartedAt) / span, 0, 1);
}

function stepShowClock(state: GameState, previousNow: number, now: number): boolean {
  if (state.phase !== 'playing' || !state.hardEndsAt) return false;
  if (now >= state.hardEndsAt) {
    endShow(state, now, true);
    return true;
  }
  if (state.showEndsAt && previousNow < state.showEndsAt && now >= state.showEndsAt) {
    state.lastEvent = event(now, 'overtime', {});
    return true;
  }
  return false;
}

function registerActivity(state: GameState, now: number) {
  state.song.surgeUntil = now + SURGE_MS;
}

export function stepGame(input: GameState, now: number, deltaMs: number): GameState {
  if (input.phase !== 'playing') {
    if (input.serverNow === now) return input;
    return { ...input, serverNow: now };
  }
  const state = cloneState(input);
  advanceGame(state, now, deltaMs);
  return state;
}

export function advanceGame(state: GameState, now: number, deltaMs: number): boolean {
  const previousNow = state.serverNow;
  state.serverNow = now;
  if (state.phase !== 'playing') return false;
  const dt = Math.min(deltaMs / 1000, 0.1);

  let changed = applyDueChanges(state, now);
  if (state.commitProgress > 0 && !Object.values(state.players).some((player) =>
    player.gesture === 'lever' && player.useUntil > now && !player.heldBlockId && isAtSongArc(player.position))) {
    state.commitProgress = 0;
    changed = true;
  }
  changed = stepShowClock(state, previousNow, now) || changed;
  changed = stepStations(state, now) || changed;
  changed = stepFlight(state, now, dt) || changed;
  changed = stepFloor(state, now) || changed;
  state.song.energy = songEnergy(state.song, now);
  state.song.energyAt = now;

  if (changed) state.revision += 1;
  return changed;
}

function stepStations(state: GameState, now: number) {
  let changed = false;
  for (const definition of STATIONS) {
    const station = state.stations[definition.id];
    if (!station) continue;
    if (!station.busyUntil || now < station.busyUntil) continue;
    changed = true;
    finishJob(state, definition, station, now);
  }
  return changed;
}

function stepFlight(state: GameState, now: number, dt: number) {
  let changed = false;
  const steps = Math.max(1, Math.ceil(dt * 60));
  const h = dt / steps;
  for (const block of Object.values(state.blocks)) {
    if (block.status !== 'thrown') continue;
    changed = true;
    for (let step = 0; step < steps && block.status === 'thrown'; step += 1) flyStep(state, block, now, h);
  }
  return changed;
}

function flyStep(state: GameState, block: BlockState, now: number, dt: number) {
  block.velocity.y -= FALL_ACCEL * dt;
  block.position.x += block.velocity.x * dt;
  block.position.y += block.velocity.y * dt;
  block.position.z += block.velocity.z * dt;
  clampToStage(block.position);

  let thrower = block.holderId ? state.players[block.holderId] : null;
  const machine = thrower && block.velocity.y < 0 ? machineUnder(block.position) : null;
  if (machine) {
    if (machineTakes(state, machine.id, block.fx, now).ok) {
      feedMachine(machine, state.stations[machine.id]!, block, now);
      return;
    }
    bounceOff(block, machine);
    thrower = null;
  }

  if (block.position.y > BLOCK_REST_Y) return;
  block.position.y = BLOCK_REST_Y;
  block.velocity = { x: 0, y: 0, z: 0 };
  if (thrower && isOnDeck(block.position) && state.phase === 'playing' && LOOP_LAYERS.includes(block.role as LoopLayer)) {
    placeRecord(state, block, thrower.id, now);
    return;
  }
  restOnFloor(block, now);
  block.holderId = null;
}

function bounceOff(block: BlockState, machine: StationDefinition) {
  const anchor = stationNearestPoint(machine, block.position);
  const away = { x: block.position.x - anchor.x, y: 0, z: block.position.z - anchor.z };
  const radial = stationRadial(machine);
  const out = Math.hypot(away.x, away.z) > 1e-3 ? normalizeXZ(away) : { x: -radial.x, y: 0, z: -radial.z };
  block.holderId = null;
  block.velocity = { x: out.x * BOUNCE_SPEED, y: BOUNCE_LIFT, z: out.z * BOUNCE_SPEED };
}

const BOUNCE_SPEED = 3.2;
const BOUNCE_LIFT = 3.4;

function restOnFloor(block: BlockState, now: number) {
  block.status = 'world';
  block.floorSince = now;
}

function stepFloor(state: GameState, now: number) {
  let changed = false;
  for (const block of Object.values(state.blocks)) {
    if (block.status !== 'world' || now - block.floorSince < FLOOR_LIFETIME_MS) continue;
    delete state.blocks[block.id];
    changed = true;
  }
  return changed;
}

function gesture(player: PlayerState, kind: Gesture, now: number) {
  player.gesture = kind;
  player.gestureAt = now;
}

function dropHeldBlock(state: GameState, player: PlayerState, now: number) {
  if (!player.heldBlockId) return;
  const block = state.blocks[player.heldBlockId];
  if (block) {
    restOnFloor(block, now);
    block.holderId = null;
    block.stationId = null;
    block.position = clampToStage({ x: player.position.x, y: BLOCK_REST_Y, z: player.position.z });
    block.velocity = { x: 0, y: 0, z: 0 };
  }
  player.heldBlockId = null;
}

export function popOut(block: Pick<BlockState, 'status' | 'holderId' | 'stationId' | 'position' | 'velocity'>, station: StationDefinition) {
  const from = stationExit(station);
  const direction = stationEjectDirection(station);
  block.status = 'thrown';
  block.holderId = null;
  block.stationId = null;
  block.position = { ...from };

  const drop = Math.max(0, from.y - BLOCK_REST_Y);
  const airtime = (EJECT_LAUNCH_SPEED_Y + Math.sqrt(EJECT_LAUNCH_SPEED_Y ** 2 + 2 * FALL_ACCEL * drop)) / FALL_ACCEL;
  const speed = EJECT_DISTANCE / airtime;
  block.velocity = { x: direction.x * speed, y: EJECT_LAUNCH_SPEED_Y, z: direction.z * speed };
}

export function activeLayers(state: Pick<GameState, 'song'>) {
  return activeLayerCount(state.song);
}

export function sessionSamples(state: Pick<GameState, 'song'>): string[] {
  return [...state.song.distinctSamples];
}
