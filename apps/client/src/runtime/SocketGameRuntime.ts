import { LIVE_PATH, LinkPacer, Prediction, setActiveTheme, type GameAction, type GameState, type PoseReport, type RoomJoinResult, type ThemeId } from '@loop/shared';
import { RoomSocket, liveUrl } from './roomSocket';
import { pickTheme, withOwnPose, type GameRuntime, type StateListener } from './GameRuntime';
import { receivePoses } from '../game/presence';
import { setConnection } from './connection';
import { reloadForUpdate } from './reloadForUpdate';

const OWN_POSE_NOTIFY_MS = 80;

const CLOCK_PROBES = 5;
const CLOCK_INTERVAL_MS = 10_000;
const CLOCK_DECAY = 1.08;
const CLOCK_NUDGE = 0.06;

const SETTLE_TIMEOUT_MS = 8000;
const PING_TIMEOUT_MS = 5000;

type CreateOptions = { playerKey: string; playerName: string };
type OpenOptions = CreateOptions & { themeId?: ThemeId; runSeed?: number };
type JoinOptions = OpenOptions & { code: string; create?: boolean };

const CONNECT_TIMEOUT_MS = 20_000;

let warm: RoomSocket | null = null;

export function warmConnection() {
  if (warm) return;
  const socket = new RoomSocket(liveUrl(LIVE_PATH), { reconnect: false });
  warm = socket;
  socket.on('closed', () => { if (warm === socket) warm = null; });
}

function takeWarm(): RoomSocket | null {
  const socket = warm;
  warm = null;
  socket?.keepConnected();
  return socket;
}

function answered<T>(ask: (resolve: (value: T) => void) => void, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    ask((value) => { window.clearTimeout(timer); resolve(value); });
  });
}

const pageSession = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class SocketGameRuntime implements GameRuntime {
  readonly mode = 'socket' as const;
  private prediction = new Prediction();
  private ownPose: PoseReport | null = null;
  private ownPoseIn: { phase: GameState['phase']; joinedAt: number } | null = null;
  private pacer = new LinkPacer();
  private listeners = new Set<StateListener>();
  private clockOffsetMs = 0;
  private clockRtt = Infinity;
  private pingTimer: number;
  private lastPoseNotifyAt = 0;
  private closed = false;

  private constructor(
    public readonly playerId: string,
    public readonly roomCode: string,
    private socket: RoomSocket,
    initialState: GameState,
    private readonly session: string,
    private readonly playerName: string,
    private readonly playerKey: string,
  ) {
    this.prediction.reset(initialState);
    setConnection('live');
    this.clockOffsetMs = initialState.serverNow - Date.now();

    socket.on('player:poses', ({ poses }) => receivePoses(poses.filter((pose) => pose.id !== this.playerId), this.now()));

    socket.on('room:state', ({ state, acks, serverNow }) => {
      const pace = this.pacer.observe(serverNow, Date.now());
      if (pace !== null) this.socket.emit('link:pace', pace);
      this.prediction.receive(state, acks?.[this.playerId] ?? 0);
      this.layOwnPose();
      this.emit();
    });

    socket.on('lost', () => { if (!this.closed) setConnection('reconnecting'); });
    socket.on('open', (again) => { if (again) void this.rejoin(); });
    socket.on('room:closed', (reason) => this.close(reason));
    socket.on('outdated', (reason) => { if (!reloadForUpdate()) this.close(reason); });

    void this.probeClock();
    this.pingTimer = window.setInterval(() => void this.syncClock(), CLOCK_INTERVAL_MS);
  }

  private rejoining = false;

  private async rejoin() {
    if (this.closed || this.rejoining) return;
    this.rejoining = true;
    let result: RoomJoinResult | null = null;
    try {
      while (!this.closed && this.socket.connected && !result) {
        result = await answered<RoomJoinResult | null>((resolve) => {
          const asked = this.socket.emit('room:join', { code: this.roomCode, playerKey: this.playerKey, name: this.playerName, session: this.session }, resolve);
          if (!asked) resolve(null);
        }, SETTLE_TIMEOUT_MS, null);
      }
    } finally {
      this.rejoining = false;
    }
    if (this.closed || !result) return;
    if (!result.ok) {
      this.close(result.error);
      return;
    }
    this.prediction.reset(result.state);
    this.layOwnPose();
    this.pacer.reset();
    if (this.pacer.pace) this.socket.emit('link:pace', this.pacer.pace);
    setConnection('live');
    this.emit();
    this.clockRtt = Infinity;
    void this.probeClock();
  }

  private close(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.socket.close();
    setConnection('closed', reason);
  }

  static create(options: OpenOptions) {
    return SocketGameRuntime.enter(options, (socket, session, resolve) => {
      socket.emit('room:create', {
        playerKey: options.playerKey, name: options.playerName, session, themeId: options.themeId, runSeed: options.runSeed,
      }, resolve);
    });
  }

  static join(options: JoinOptions) {
    return SocketGameRuntime.enter(options, (socket, session, resolve) => {
      socket.emit('room:join', {
        code: options.code.toUpperCase(), playerKey: options.playerKey, name: options.playerName, session,
        ...(options.create ? { create: true, themeId: options.themeId, runSeed: options.runSeed } : {}),
      }, resolve);
    });
  }

  private static async enter(
    options: CreateOptions,
    ask: (socket: RoomSocket, session: string, resolve: (result: RoomJoinResult) => void) => void,
  ) {
    const socket = takeWarm() ?? new RoomSocket(liveUrl(LIVE_PATH));
    try {
      await waitForConnection(socket);
      const session = pageSession();
      const result = await new Promise<RoomJoinResult>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('The multiplayer server did not answer. Try again in a moment.')), SETTLE_TIMEOUT_MS);
        ask(socket, session, (answer) => { window.clearTimeout(timer); resolve(answer); });
      });
      if (!result.ok) throw new Error(result.error);
      return new SocketGameRuntime(result.playerId, result.code, socket, result.state, session, options.playerName, options.playerKey);
    } catch (error) {
      socket.close();
      throw error;
    }
  }

  private get state() {
    return this.prediction.state;
  }

  getState() {
    setActiveTheme(this.state.themeId);
    return this.state;
  }
  now() { return Date.now() + this.clockOffsetMs; }

  dispatch(action: GameAction) {
    const actionWithNow = { ...action, now: this.now() } as GameAction;
    this.prediction.dispatch(actionWithNow, this.socket.connected
      ? (seq) => this.socket.emit('game:action', { code: this.roomCode, action: actionWithNow, seq })
      : null);
    this.emit();
  }

  settle(action: GameAction) {
    const actionWithNow = { ...action, now: this.now() } as GameAction;
    return new Promise<GameState>((resolve, reject) => {
      if (!this.socket.connected) {
        this.prediction.dispatch(actionWithNow, null);
        this.emit();
        reject(new Error('The connection to the room dropped. Try again in a moment.'));
        return;
      }
      const timer = window.setTimeout(() => reject(new Error('The room did not answer.')), SETTLE_TIMEOUT_MS);
      this.prediction.dispatch(actionWithNow, (seq) => this.socket.emit('game:action', { code: this.roomCode, action: actionWithNow, seq }, () => {
        window.clearTimeout(timer);
        resolve(this.prediction.room);
      }));
      this.emit();
    });
  }

  publishPose(pose: PoseReport) {
    this.socket.sendPose(pose);
    this.ownPose = pose;
    const self = this.state.players[this.playerId];
    this.ownPoseIn = self ? { phase: this.state.phase, joinedAt: self.joinedAt } : null;
    const next = withOwnPose(this.state, this.playerId, pose);
    if (!next) return;
    this.prediction.state = next;
    const now = Date.now();
    if (now - this.lastPoseNotifyAt < OWN_POSE_NOTIFY_MS) return;
    this.lastPoseNotifyAt = now;
    this.emit();
  }

  startGame() {
    this.socket.emit('room:start', { code: this.roomCode });
  }

  setTheme(themeId: ThemeId | null) {
    this.dispatch({ type: 'SET_THEME', themeId: themeId ?? pickTheme(), now: this.now() });
  }

  subscribe(listener: StateListener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    clearInterval(this.pingTimer);
    if (!this.closed) this.socket.emit('room:leave', { code: this.roomCode });
    this.closed = true;
    this.socket.close();
    this.listeners.clear();
    setConnection('live');
  }

  private layOwnPose() {
    if (!this.ownPose) return;
    const self = this.state.players[this.playerId];
    if (!self || self.joinedAt !== this.ownPoseIn?.joinedAt || this.state.phase !== this.ownPoseIn.phase) {
      this.ownPose = null;
      this.ownPoseIn = null;
      return;
    }
    const next = withOwnPose(this.state, this.playerId, this.ownPose);
    if (next) this.prediction.state = next;
  }

  private emit() {
    setActiveTheme(this.state.themeId);
    for (const listener of this.listeners) listener(this.state);
  }

  private async probeClock() {
    for (let probe = 0; probe < CLOCK_PROBES; probe += 1) await this.syncClock();
  }

  private async syncClock() {
    if (!this.socket.connected) return;
    const sentAt = Date.now();
    const serverNow = await answered<number | null>((resolve) => this.socket.emit('time:ping', sentAt, resolve), PING_TIMEOUT_MS, null);
    if (serverNow === null) return;
    const receivedAt = Date.now();
    const rtt = receivedAt - sentAt;
    const offset = serverNow - (sentAt + rtt / 2);
    this.clockRtt *= CLOCK_DECAY;
    if (rtt <= this.clockRtt) {
      this.clockRtt = rtt;
      this.clockOffsetMs = offset;
    } else {
      this.clockOffsetMs += (offset - this.clockOffsetMs) * CLOCK_NUDGE;
    }
  }
}

function waitForConnection(socket: RoomSocket) {
  if (socket.connected) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Could not connect to the multiplayer server.'));
    }, CONNECT_TIMEOUT_MS);
    const onOpen = () => { cleanup(); resolve(); };
    const onRefused = (reason: string) => { cleanup(); reject(new Error(reason || 'The multiplayer server is busy. Try again in a minute.')); };
    const onOutdated = (reason: string) => {
      cleanup();
      if (!reloadForUpdate()) reject(new Error(reason));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('open', onOpen);
      socket.off('refused', onRefused);
      socket.off('outdated', onOutdated);
    };
    socket.on('open', onOpen);
    socket.on('refused', onRefused);
    socket.on('outdated', onOutdated);
  });
}
