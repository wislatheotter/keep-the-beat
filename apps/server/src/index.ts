import { createHash, randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import type { HttpRequest, HttpResponse, WebSocket, us_listen_socket, us_socket_context_t } from 'uWebSockets.js';
import {
  ACK,
  HELLO,
  LIVE_PATH,
  MAX_PLAYERS,
  OUTDATED,
  PLAYER_COLORS,
  POSE_FRAME,
  PROTOCOL,
  REFUSED,
  SNAPSHOT_FRAME,
  advanceGame,
  applyGameAction,
  applyPlayerPose,
  createInitialGame,
  encodePoses,
  roomHasSeat,
  type ClientToServerEvents,
  type GameAction,
  type GameState,
  type PlayerPose,
  type ServerToClientEvents,
} from '@loop/shared';
import { readAction, readCode, readCreateCode, readEntry, readOpening, readPace, readPose, readSeq, type Entry } from './guard.js';
import { LIMITS, clientAddress, connectRate, createRate, joinRate, missRate, socketBudget } from './limits.js';
import { Load } from './load.js';
import { PollLink, mountPolling } from './poll.js';
import { PUBLIC_HOST, mountSite } from './site.js';

const uWS = createRequire(import.meta.url)('uWebSockets.js') as typeof import('uWebSockets.js');

type Room = {
  code: string;
  state: GameState;
  lastTickAt: number;
  lastBroadcastAt: number;
  unsent: boolean;
  disconnectedAt: Map<string, number>;
  sessions: Map<string, string>;
  acks: Map<string, number>;
  conns: Set<Conn>;
  paced: Set<Conn>;
  emptySince: number | null;
};

type Conn = {
  address: string;
  budget: ReturnType<typeof socketBudget>;
  refusal: [number, string] | null;
  ws: WebSocket<Conn> | null;
  poll: PollLink | null;
  open: boolean;
  roomCode?: string;
  playerId?: string;
  idleTimer?: NodeJS.Timeout;
  paceMs: number;
  stateAt: number;
  stateRevision: number;
  poseBox: Map<string, PlayerPose> | null;
  posesAt: number;
};

type Answer = (result: unknown) => void;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const clientDist = path.join(repoRoot, 'apps/client/dist');

const app = uWS.App();
mountSite(app, clientDist, () => ({
  audiotoolClientId: process.env.AUDIOTOOL_CLIENT_ID || process.env.VITE_AUDIOTOOL_CLIENT_ID || '',
  audiotoolRedirectUri: process.env.AUDIOTOOL_REDIRECT_URI || '',
}));

function originAllowed(origin: string, host: string) {
  if (!origin) return true;
  try {
    const from = new URL(origin).host.toLowerCase();
    return from === host.toLowerCase() || from === PUBLIC_HOST;
  } catch {
    return false;
  }
}

const rooms = new Map<string, Room>();
const openByAddress = new Map<string, number>();
let openConnections = 0;
const connects = connectRate();
const creates = createRate();
const joins = joinRate();
const misses = missRate();

const load = new Load((level) => logLoad(`now ${level}`));
const refusedRooms = { count: 0 };

function logLoad(why: string) {
  let players = 0;
  for (const room of rooms.values()) players += room.conns.size;
  const { elu, delayMs } = load.reading;
  const rss = Math.round(process.memoryUsage.rss() / 1048576);
  console.log(`[load] ${why}: ${rooms.size} rooms, ${players} players, ${openConnections} connections, loop ${Math.round(elu * 100)}% busy, delay p99 ${Math.round(delayMs)} ms, ${rss} MB, ${refusedRooms.count} rooms refused`);
  refusedRooms.count = 0;
}

setInterval(() => { if (openConnections > 0) logLoad(load.level); }, 5 * 60_000).unref();

const TOO_FAST = 'Too many tries. Wait a minute and try again.';
const EVERYONE = 'everyone';
const stateTopic = (code: string) => `state/${code}`;
const posesTopic = (code: string) => `poses/${code}`;

const utf8 = new TextDecoder();

const frame = <E extends keyof ServerToClientEvents>(event: E, payload: Parameters<ServerToClientEvents[E]>[0]) =>
  JSON.stringify([event, payload]);

function send<E extends keyof ServerToClientEvents>(conn: Conn, event: E, payload: Parameters<ServerToClientEvents[E]>[0]) {
  sendTo(conn, frame(event, payload));
}

function sendTo(conn: Conn, data: string | Uint8Array, binary = false) {
  if (!conn.open) return;
  if (conn.ws) conn.ws.send(data, binary);
  else conn.poll!.push(data, binary);
}

const pollTopics = new Map<string, Set<Conn>>();

function subscribe(conn: Conn, topic: string) {
  if (conn.ws) { conn.ws.subscribe(topic); return; }
  conn.poll!.topics.add(topic);
  let set = pollTopics.get(topic);
  if (!set) pollTopics.set(topic, (set = new Set()));
  set.add(conn);
}

function unsubscribe(conn: Conn, topic: string) {
  if (conn.ws) { conn.ws.unsubscribe(topic); return; }
  conn.poll!.topics.delete(topic);
  const set = pollTopics.get(topic);
  set?.delete(conn);
  if (set?.size === 0) pollTopics.delete(topic);
}

function publish(topic: string, data: string | Uint8Array, binary: boolean, except?: Conn) {
  if (except?.ws && except.open) except.ws.publish(topic, data, binary);
  else app.publish(topic, data, binary);
  const lines = pollTopics.get(topic);
  if (!lines) return;
  for (const conn of lines) if (conn !== except && conn.open) conn.poll!.push(data, binary);
}

function hangUp(conn: Conn) {
  if (!conn.open) return;
  if (conn.ws) conn.ws.close();
  else conn.poll!.kill();
}

function snapshot(room: Room, now: number) {
  const body = deflateRawSync(frame('room:state', { state: room.state, serverNow: now, acks: Object.fromEntries(room.acks) }), { level: 1 });
  const bytes = Buffer.allocUnsafe(body.length + 1);
  bytes[0] = SNAPSHOT_FRAME;
  body.copy(bytes, 1);
  return bytes;
}

app.ws<Conn>(LIVE_PATH, {
  maxPayloadLength: LIMITS.messageBytes,
  maxBackpressure: 512 * 1024,
  closeOnBackpressureLimit: false,
  idleTimeout: 32,
  sendPingsAutomatically: true,

  upgrade: (res: HttpResponse, req: HttpRequest, context: us_socket_context_t) => {
    const key = req.getHeader('sec-websocket-key');
    const protocol = req.getHeader('sec-websocket-protocol');
    const extensions = req.getHeader('sec-websocket-extensions');
    const conn = admit(req.getHeader('origin'), req.getHeader('host'), req.getQuery('v') ?? '', req.getHeader('x-forwarded-for'), Buffer.from(res.getRemoteAddressAsText()).toString());
    if (!conn) {
      res.writeStatus('403 Forbidden').end();
      return;
    }
    res.upgrade<Conn>(conn, key, protocol, extensions, context);
  },

  open: (ws) => {
    const conn = ws.getUserData();
    conn.ws = ws;
    if (conn.refusal) {
      ws.end(...conn.refusal);
      return;
    }
    opened(conn);
  },

  message: (ws, message, isBinary) => received(ws.getUserData(), new Uint8Array(message), isBinary),

  close: (ws) => closed(ws.getUserData()),
});

mountPolling<Conn>(app, {
  admit,
  refusal: (conn) => conn.refusal,
  attach: (conn, link) => { conn.poll = link; },
  opened,
  received,
  closed,
});

function admit(origin: string, host: string, version: string, forwardedFor: string, peer: string): Conn | null {
  if (!originAllowed(origin, host)) return null;
  const address = clientAddress(forwardedFor || undefined, peer);
  let refusal: [number, string] | null = null;
  if (version !== String(PROTOCOL)) {
    refusal = [version ? OUTDATED : REFUSED, 'Keep the Beat has just been updated. Reload the page to play.'];
  } else if (openConnections >= LIMITS.connections) {
    refusal = [REFUSED, 'The game is very busy right now. Try again in a minute.'];
  } else if ((openByAddress.get(address) ?? 0) >= LIMITS.connectionsPerAddress || !connects.take(address)) {
    refusal = [REFUSED, 'Too many connections from your network. Try again in a minute.'];
  }
  return {
    address, budget: socketBudget(), refusal, ws: null, poll: null, open: false,
    paceMs: 0, stateAt: 0, stateRevision: -1, poseBox: null, posesAt: 0,
  };
}

function opened(conn: Conn) {
  conn.open = true;
  openConnections += 1;
  openByAddress.set(conn.address, (openByAddress.get(conn.address) ?? 0) + 1);
  subscribe(conn, EVERYONE);
  expectRoom(conn);
  sendTo(conn, JSON.stringify([HELLO]));
}

function received(conn: Conn, message: Uint8Array, isBinary: boolean) {
  if (!conn.open) return;
  if (isBinary) {
    if (message[0] === POSE_FRAME) pose(conn, message);
    else strike(conn);
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8.decode(message));
  } catch {
    strike(conn);
    return;
  }
  if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') { strike(conn); return; }
  const [event, payload, ackId] = parsed as [string, unknown, unknown];
  const answer: Answer | undefined = Number.isSafeInteger(ackId)
    ? (result) => sendTo(conn, JSON.stringify([ACK, ackId, result]))
    : undefined;
  try {
    handle(conn, event, payload, answer);
  } catch (error) {
    console.error(`[server] ${event.slice(0, 32)} failed:`, error instanceof Error ? error.message : error);
  }
}

function closed(conn: Conn) {
  const counted = conn.open;
  conn.open = false;
  clearTimeout(conn.idleTimer);
  if (conn.poll) for (const topic of [...conn.poll.topics]) unsubscribe(conn, topic);
  if (!counted) return;
  openConnections -= 1;
  const open = (openByAddress.get(conn.address) ?? 1) - 1;
  if (open > 0) openByAddress.set(conn.address, open);
  else openByAddress.delete(conn.address);
  const room = roomOf(conn);
  const playerId = conn.playerId;
  if (!room || !playerId) return;
  room.conns.delete(conn);
  room.paced.delete(conn);
  if (!hasConnection(room, playerId)) room.disconnectedAt.set(playerId, Date.now());
}

function allow(conn: Conn, kind: 'pose' | 'action' | 'ping' | 'room') {
  if (conn.budget[kind].take()) return true;
  strike(conn);
  return false;
}

function strike(conn: Conn) {
  if (!conn.budget.strikes.take()) hangUp(conn);
}

function handle(conn: Conn, event: string, payload: unknown, answer: Answer | undefined) {
  switch (event as keyof ClientToServerEvents) {
    case 'time:ping':
      if (answer && allow(conn, 'ping')) answer(Date.now());
      return;
    case 'room:create':
      if (answer) createRoom(conn, payload, answer);
      return;
    case 'room:join':
      if (answer) joinRoom(conn, payload, answer);
      return;
    case 'room:start': {
      if (!allow(conn, 'room')) return;
      const room = roomOf(conn);
      const ok = !!room && room.state.hostId === conn.playerId;
      if (room && ok) {
        apply(room, { type: 'START_GAME', now: Date.now() });
        broadcastRoom(room, true);
      }
      answer?.(ok);
      return;
    }
    case 'game:action':
      gameAction(conn, payload, answer);
      return;
    case 'room:leave':
      leaveRoom(conn);
      return;
    case 'link:pace':
      if (allow(conn, 'ping')) setPace(conn, payload);
      return;
    default:
      strike(conn);
  }
}

function createRoom(conn: Conn, payload: unknown, answer: Answer) {
  if (!allow(conn, 'room')) return answer({ ok: false, error: TOO_FAST });
  const entry = readEntry(payload);
  if (!entry) return answer({ ok: false, error: 'That request did not make sense to the server.' });
  openRoom(conn, createRoomCode(), entry, payload, answer);
}

function openRoom(conn: Conn, code: string, entry: Entry, payload: unknown, answer: Answer) {
  if (rooms.size >= LIMITS.rooms || load.level === 'full') {
    refusedRooms.count += 1;
    return answer({ ok: false, error: 'The game is very busy right now. Try again in a minute.' });
  }
  if (!creates.take(conn.address)) return answer({ ok: false, error: 'Too many new rooms from your network. Wait a minute and try again.' });

  const playerId = playerIdFor(code, entry.playerKey);
  const now = Date.now();
  const room: Room = {
    code,
    state: createInitialGame({ id: playerId, name: entry.name, color: PLAYER_COLORS[0] }, code, now, readOpening(payload)),
    lastTickAt: now,
    lastBroadcastAt: 0,
    unsent: false,
    disconnectedAt: new Map(),
    sessions: new Map([[playerId, entry.session]]),
    acks: new Map(),
    conns: new Set(),
    paced: new Set(),
    emptySince: null,
  };
  rooms.set(code, room);
  attach(conn, room, playerId);
  answer({ ok: true, code, playerId, state: room.state });
  broadcastRoom(room, true);
}

function joinRoom(conn: Conn, payload: unknown, answer: Answer) {
  if (!allow(conn, 'room')) return answer({ ok: false, error: TOO_FAST });
  const entry = readEntry(payload);
  const code = readCode((payload as { code?: unknown } | null)?.code);
  if (!entry || code === null) return answer({ ok: false, error: 'That is not a room code. Check it, or start a room of your own.' });
  if (!joins.take(conn.address)) return answer({ ok: false, error: 'Too many tries from your network. Wait a minute and try again.' });
  if (!misses.can(conn.address)) return answer({ ok: false, error: 'Too many room codes that did not work. Wait a minute and try again.' });

  const room = rooms.get(code);
  if (!room) {
    misses.take(conn.address);
    if (readCreateCode(payload) === code) return openRoom(conn, code, entry, payload, answer);
    return answer({ ok: false, error: `There is no room ${code} any more. Check the code, or start a room of your own.` });
  }

  const now = Date.now();
  const playerId = playerIdFor(code, entry.playerKey);
  if (!room.state.players[playerId] && !roomHasSeat(room.state)) return answer({ ok: false, error: roomFullMessage(code) });
  if (!room.state.players[playerId]) {
    const index = Object.keys(room.state.players).length;
    apply(room, {
      type: 'JOIN_PLAYER',
      player: { id: playerId, name: entry.name, color: PLAYER_COLORS[index % PLAYER_COLORS.length]! },
      now,
    });
    if (!room.state.players[playerId]) return answer({ ok: false, error: roomFullMessage(code) });
  } else if (room.sessions.get(playerId) !== entry.session) {
    closeOtherConns(room, playerId, conn, 'This room was opened again in another tab or window.');
    apply(room, { type: 'RESPAWN_PLAYER', playerId, now });
    room.acks.delete(playerId);
  }
  room.sessions.set(playerId, entry.session);
  room.disconnectedAt.delete(playerId);
  attach(conn, room, playerId);
  answer({ ok: true, code, playerId, state: room.state });
  broadcastRoom(room, true);
}

function gameAction(conn: Conn, payload: unknown, answer: Answer | undefined) {
  const room = roomOf(conn);
  const playerId = conn.playerId;
  const seq = readSeq((payload as { seq?: unknown } | null)?.seq);
  if (room && playerId && seq !== null && seq > (room.acks.get(playerId) ?? 0)) room.acks.set(playerId, seq);
  if (!allow(conn, 'action')) return answer?.(null);
  if (!room || !playerId) return answer?.(null);

  const action = readAction((payload as { action?: unknown } | null)?.action, playerId, room.state, Date.now());
  if (!action || (action.type === 'SET_THEME' && room.state.hostId !== playerId)) return answer?.(null);
  if (action.type === 'PLAYER_TRANSFORM') {
    applyPlayerPose(room.state, playerId, { t: action.now, x: action.position.x, y: action.position.y, z: action.position.z, yaw: action.rotationY });
    if (answer) {
      sendState(conn, room, Date.now());
      answer(null);
    }
    return;
  }
  apply(room, action);
  broadcastRoom(room, true);
  if (answer && conn.paceMs) sendState(conn, room, Date.now());
  answer?.(null);
}

function pose(conn: Conn, bytes: Uint8Array) {
  if (!allow(conn, 'pose')) return;
  const room = roomOf(conn);
  const playerId = conn.playerId;
  const report = readPose(bytes);
  if (!room || !playerId || !report) return;
  const now = Date.now();
  const t = Math.abs(report.t - now) > 2000 ? now : report.t;
  if (!applyPlayerPose(room.state, playerId, { ...report, t })) return;
  relayPose(room, conn, { ...report, t, id: playerId });
}

function leaveRoom(conn: Conn) {
  if (!allow(conn, 'room')) return;
  const room = roomOf(conn);
  const playerId = conn.playerId;
  if (!room || !playerId) return;
  detach(conn);
  if (hasConnection(room, playerId)) return;
  apply(room, { type: 'LEAVE_PLAYER', playerId, now: Date.now() });
  room.disconnectedAt.delete(playerId);
  room.sessions.delete(playerId);
  room.acks.delete(playerId);
  broadcastRoom(room, true);
}

function roomOf(conn: Conn): Room | undefined {
  return conn.roomCode ? rooms.get(conn.roomCode) : undefined;
}

function apply(room: Room, action: GameAction) {
  try {
    room.state = applyGameAction(room.state, action);
  } catch (error) {
    console.error(`[server] ${action.type} failed:`, error instanceof Error ? error.message : error);
  }
}

function playerIdFor(code: string, playerKey: string) {
  return createHash('sha256').update(`${code}\n${playerKey}`).digest('base64url').slice(0, 16);
}

function roomFullMessage(code: string) {
  return `Room ${code} is full: all ${MAX_PLAYERS} places are taken. Try again when somebody leaves, or start a room of your own.`;
}

function hasConnection(room: Room, playerId: string) {
  for (const conn of room.conns) if (conn.playerId === playerId) return true;
  return false;
}

function closeOtherConns(room: Room, playerId: string, keep: Conn, reason: string) {
  for (const conn of [...room.conns]) {
    if (conn === keep || conn.playerId !== playerId) continue;
    detach(conn);
    send(conn, 'room:closed', reason);
  }
}

function attach(conn: Conn, room: Room, playerId: string) {
  const previous = roomOf(conn);
  const previousPlayer = conn.playerId;
  if (previous && previousPlayer && previous !== room) {
    detach(conn);
    if (!hasConnection(previous, previousPlayer)) previous.disconnectedAt.set(previousPlayer, Date.now());
  } else if (previous) {
    detach(conn);
  }
  clearTimeout(conn.idleTimer);
  conn.roomCode = room.code;
  conn.playerId = playerId;
  room.conns.add(conn);
  follow(conn, room);
}

function setPace(conn: Conn, payload: unknown) {
  const ms = readPace(payload);
  if (ms === null) { strike(conn); return; }
  if (ms === conn.paceMs) return;
  const was = conn.paceMs;
  conn.paceMs = ms;
  const room = roomOf(conn);
  if (!room) return;
  follow(conn, room);
  if (was && !ms) sendState(conn, room, Date.now());
}

function follow(conn: Conn, room: Room) {
  if (conn.paceMs) {
    unsubscribe(conn, stateTopic(room.code));
    unsubscribe(conn, posesTopic(room.code));
    room.paced.add(conn);
    conn.poseBox ??= new Map();
  } else {
    room.paced.delete(conn);
    conn.poseBox = null;
    subscribe(conn, stateTopic(room.code));
    subscribe(conn, posesTopic(room.code));
  }
}

const PACED_POSES_MS = 150;

function feedPaced(conn: Conn, room: Room, now: number) {
  const since = now - conn.stateAt;
  if (since >= conn.paceMs && (conn.stateRevision !== room.state.revision || since >= HEARTBEAT_MS)) sendState(conn, room, now);
  if (conn.poseBox?.size && now - conn.posesAt >= PACED_POSES_MS) {
    sendTo(conn, encodePoses([...conn.poseBox.values()]), true);
    conn.poseBox.clear();
    conn.posesAt = now;
  }
}

function detach(conn: Conn) {
  const room = roomOf(conn);
  if (room) {
    room.conns.delete(conn);
    room.paced.delete(conn);
  }
  if (conn.roomCode && conn.open) {
    unsubscribe(conn, stateTopic(conn.roomCode));
    unsubscribe(conn, posesTopic(conn.roomCode));
  }
  conn.roomCode = undefined;
  conn.playerId = undefined;
  expectRoom(conn);
}

function expectRoom(conn: Conn) {
  clearTimeout(conn.idleTimer);
  if (!conn.open) return;
  conn.idleTimer = setTimeout(() => {
    if (!conn.roomCode) hangUp(conn);
  }, LIMITS.idleMs);
}

function sendState(conn: Conn, room: Room, now: number) {
  conn.stateAt = now;
  conn.stateRevision = room.state.revision;
  sendTo(conn, snapshot(room, now), true);
}

function broadcastRoom(room: Room, force = false) {
  const now = Date.now();
  if (!force && now - room.lastBroadcastAt < 90) {
    room.unsent = true;
    return false;
  }
  room.lastBroadcastAt = now;
  room.unsent = false;
  publish(stateTopic(room.code), snapshot(room, now), true);
  return true;
}

const BUSY_POSE_GATHER_MS = 15;

type PoseBatch = { poses: PlayerPose[]; from: Conn | null };
const pendingPoses = new Map<Room, PoseBatch>();
let posesQueued = false;

function relayPose(room: Room, conn: Conn, pose: PlayerPose) {
  for (const paced of room.paced) if (paced !== conn) paced.poseBox?.set(pose.id, pose);
  const batch = pendingPoses.get(room);
  if (batch) {
    batch.poses.push(pose);
    if (batch.from !== conn) batch.from = null;
  } else {
    pendingPoses.set(room, { poses: [pose], from: conn });
  }
  if (posesQueued) return;
  posesQueued = true;
  if (load.level === 'calm') setImmediate(flushPoses);
  else setTimeout(flushPoses, BUSY_POSE_GATHER_MS);
}

function flushPoses() {
  posesQueued = false;
  for (const [room, { poses, from }] of pendingPoses) {
    if (rooms.get(room.code) !== room) continue;
    const bytes = encodePoses(poses);
    publish(posesTopic(room.code), bytes, true, from ?? undefined);
  }
  pendingPoses.clear();
}

const HEARTBEAT_MS = 1000;

function tickRoom(code: string, room: Room, now: number) {
  const delta = Math.min(100, Math.max(1, now - room.lastTickAt));
  room.lastTickAt = now;
  const beforeRevision = room.state.revision;
  const empty = Object.keys(room.state.players).length === 0;
  if (!empty) advanceGame(room.state, now, delta);

  for (const [playerId, disconnectedAt] of room.disconnectedAt) {
    if (hasConnection(room, playerId)) {
      room.disconnectedAt.delete(playerId);
    } else if (now - disconnectedAt > leaveGraceMs(room.state)) {
      apply(room, { type: 'LEAVE_PLAYER', playerId, now });
      room.disconnectedAt.delete(playerId);
      room.sessions.delete(playerId);
      room.acks.delete(playerId);
    }
  }

  if (room.state.revision !== beforeRevision || room.unsent) broadcastRoom(room);
  else if (now - room.lastBroadcastAt >= HEARTBEAT_MS) broadcastRoom(room);
  for (const conn of room.paced) feedPaced(conn, room, now);

  if (empty) {
    room.emptySince ??= now;
    if (now - room.emptySince > 120_000) closeRoom(room);
  } else {
    room.emptySince = null;
  }
}

function closeRoom(room: Room, reason?: string) {
  rooms.delete(room.code);
  pendingPoses.delete(room);
  for (const conn of [...room.conns]) {
    detach(conn);
    if (reason) send(conn, 'room:closed', reason);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    try {
      tickRoom(code, room, now);
    } catch (error) {
      console.error('[server] a room failed and was closed:', error instanceof Error ? error.message : error);
      closeRoom(room, 'Something went wrong in this room, so it has closed. Start a new one.');
    }
  }
}, 50).unref();

setInterval(() => {
  connects.prune();
  creates.prune();
  joins.prune();
  misses.prune();
}, 60_000).unref();

function leaveGraceMs(state: GameState) {
  return state.phase === 'playing' ? 30_000 : 4_000;
}

function createRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += alphabet[randomInt(alphabet.length)];
    if (!rooms.has(code)) return code;
  }
}

let listening: us_listen_socket | null = null;

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  if (listening) uWS.us_listen_socket_close(listening);
  listening = null;
  publish(EVERYONE, frame('room:closed', 'Keep the Beat was just restarted, so this room has closed. Start a new one — it only takes a moment.'), false);
  setTimeout(() => {
    app.close();
    process.exit(0);
  }, 1000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const port = Number(process.env.PORT || 3001);
app.listen('0.0.0.0', port, (socket) => {
  if (!socket) {
    console.error(`[server] could not listen on port ${port}`);
    process.exit(1);
  }
  listening = socket;
  console.log(`[server] listening on port ${port}`);
});
