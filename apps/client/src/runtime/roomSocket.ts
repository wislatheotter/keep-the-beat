import type { ClientToServerEvents, PoseReport, ServerToClientEvents } from '@loop/shared';
import { inflateSync } from 'fflate';
import { ACK, HELLO, OUTDATED, POSES_FRAME, PROTOCOL, REFUSED, SNAPSHOT_FRAME, decodePoses, encodePose } from '@loop/shared/wire';
import { PollSocket } from './pollSocket';

export type Transport = 'websocket' | 'polling';

type Listener = (...args: never[]) => void;
type Events = { [K in keyof ServerToClientEvents]: ServerToClientEvents[K] };
type Lifecycle = {
  open: (again: boolean) => void;
  lost: () => void;
  refused: (reason: string) => void;
  outdated: (reason: string) => void;
  closed: (code: number, reason: string) => void;
};

type SocketLike = {
  readyState: number;
  binaryType: string;
  bufferedAmount: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
};
type SocketCtor = new (url: string, options?: unknown) => SocketLike;

export type RoomSocketOptions = {
  WebSocket?: SocketCtor;
  socketOptions?: unknown;
  reconnect?: boolean;
  transport?: Transport;
};

const GREET_MS: Record<Transport, number> = { websocket: 6000, polling: 15_000 };
const PROBE_MS = 30_000;
const PROBE_MAX_MS = 5 * 60_000;
const SHORT_LIVED_MS = 20_000;

const PREFERENCE_KEY = 'ktb-transport';

let preferred: Transport = (() => {
  try {
    return globalThis.sessionStorage?.getItem(PREFERENCE_KEY) === 'polling' ? 'polling' : 'websocket';
  } catch {
    return 'websocket';
  }
})();

export function forgetTransport() {
  preferred = 'websocket';
}

function prefer(transport: Transport) {
  if (preferred === transport) return;
  preferred = transport;
  try { globalThis.sessionStorage?.setItem(PREFERENCE_KEY, transport); } catch {}
}

const VOLATILE_LIMIT = 16 * 1024;
const SILENT_MS = 8000;

export class RoomSocket {
  connected = false;
  transport: Transport;
  private next: Transport;
  private greetTimer: ReturnType<typeof setTimeout> | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private probeDelay = PROBE_MS;
  private probing: SocketLike | null = null;
  private greetedAt = 0;
  private shortLived = 0;
  private socket: SocketLike | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private answers = new Map<number, (result: unknown) => void>();
  private nextAck = 1;
  private attempts = 0;
  private opened = false;
  private closed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly Impl: SocketCtor;
  private reconnect: boolean;

  private readonly url: string;

  constructor(url: string, private readonly options: RoomSocketOptions = {}) {
    this.url = `${url}${url.includes('?') ? '&' : '?'}v=${PROTOCOL}`;
    this.Impl = options.WebSocket ?? (globalThis.WebSocket as unknown as SocketCtor);
    this.reconnect = options.reconnect !== false;
    this.next = this.transport = options.transport ?? preferred;
    globalThis.addEventListener?.('online', this.online);
    this.open();
  }

  private readonly online = () => {
    if (this.closed) return;
    if (!this.socket && this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.attempts = 0;
      this.open();
    } else if (this.connected && this.transport === 'polling') {
      this.probeDelay = PROBE_MS;
      this.probe();
    }
  };

  keepConnected() {
    this.reconnect = true;
  }

  on<E extends keyof Events>(event: E, listener: Events[E]): this;
  on<E extends keyof Lifecycle>(event: E, listener: Lifecycle[E]): this;
  on(event: string, listener: Listener) {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return this;
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit<E extends keyof ClientToServerEvents>(event: E, ...args: Parameters<ClientToServerEvents[E]>): boolean {
    const [payload, answer] = args as [unknown, ((result: unknown) => void) | undefined];
    if (!this.connected || !this.socket) return false;
    if (typeof answer === 'function') {
      const id = this.nextAck++;
      this.answers.set(id, answer);
      this.socket.send(JSON.stringify([event, payload, id]));
    } else {
      this.socket.send(JSON.stringify([event, payload]));
    }
    return true;
  }

  sendPose(pose: PoseReport) {
    if (!this.connected || !this.socket || this.socket.bufferedAmount > VOLATILE_LIMIT) return false;
    this.socket.send(encodePose(pose));
    return true;
  }

  close() {
    this.closed = true;
    globalThis.removeEventListener?.('online', this.online);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.greetTimer) clearTimeout(this.greetTimer);
    this.stopProbing();
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    this.answers.clear();
    if (socket && socket.readyState <= 1) socket.close(1000);
  }

  private fire(event: string, ...args: unknown[]) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      (listener as (...values: unknown[]) => void)(...args);
    }
  }

  private open() {
    if (this.closed) return;
    const transport = this.next;
    const socket: SocketLike = transport === 'polling'
      ? new PollSocket(this.url)
      : new this.Impl(this.url, this.options.socketOptions);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.transport = transport;
    if (this.greetTimer) clearTimeout(this.greetTimer);
    this.greetTimer = setTimeout(() => {
      if (this.socket !== socket || this.connected) return;
      this.dropped(socket, 1006, '');
      try { socket.close(); } catch {}
    }, GREET_MS[transport]);
    this.wire(socket);
  }

  private wire(socket: SocketLike) {
    let reached = false;
    socket.onopen = () => { reached = true;};
    socket.onmessage = (message) => {
      if (this.socket !== socket) return;
      this.heard();
      let frame: unknown;
      try {
        if (typeof message.data === 'string') {
          frame = JSON.parse(message.data);
        } else {
          const bytes = bytesOf(message.data);
          if (bytes[0] === POSES_FRAME) {
            const poses = this.connected ? decodePoses(bytes) : null;
            if (poses) this.fire('player:poses', { poses });
            return;
          }
          if (bytes[0] !== SNAPSHOT_FRAME) return;
          frame = JSON.parse(utf8.decode(inflateSync(bytes.subarray(1))));
        }
      } catch {
        return;
      }
      if (!Array.isArray(frame)) return;
      if (frame[0] === HELLO) {
        if (this.connected) return;
        this.connected = true;
        this.attempts = 0;
        this.greetedAt = Date.now();
        if (this.greetTimer) clearTimeout(this.greetTimer);
        if (!this.options.transport) prefer(this.transport);
        if (this.transport === 'polling') this.scheduleProbe();
        const again = this.opened;
        this.opened = true;
        this.fire('open', again);
      } else if (!this.connected) {
        return;
      } else if (frame[0] === ACK) {
        const answer = this.answers.get(frame[1] as number);
        this.answers.delete(frame[1] as number);
        answer?.(frame[2]);
      } else if (typeof frame[0] === 'string') {
        this.fire(frame[0], frame[1]);
      }
    };
    socket.onerror = () => {
      setTimeout(() => { if (!reached || socket.readyState >= 2) this.dropped(socket, 1006, ''); }, 0);
    };
    socket.onclose = (event) => this.dropped(socket, event.code, event.reason);
  }

  private dropped(socket: SocketLike, code: number, reason: string) {
    if (this.socket !== socket) return;
    const was = this.connected;
    this.connected = false;
    this.socket = null;
    this.answers.clear();
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.greetTimer) clearTimeout(this.greetTimer);
    this.stopProbing();
    this.chooseNext(was, code);
    if (code === REFUSED) this.fire('refused', reason);
    if (code === OUTDATED) {
      this.closed = true;
      this.fire('outdated', reason);
    }
    if (was) this.fire('lost');
    this.fire('closed', code, reason);
    if (this.closed || !this.reconnect) return;
    const delay = Math.min(5000, 500 * 2 ** this.attempts) * (0.75 + Math.random() * 0.5);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private chooseNext(greeted: boolean, code: number) {
    if (this.options.transport) return;
    const other: Transport = this.transport === 'websocket' ? 'polling' : 'websocket';
    if (!greeted) {
      if (code !== REFUSED && code !== OUTDATED) this.next = other;
      return;
    }
    this.next = this.transport;
    if (this.transport !== 'websocket') return;
    this.shortLived = Date.now() - this.greetedAt < SHORT_LIVED_MS ? this.shortLived + 1 : 0;
    if (this.shortLived >= 2) {
      this.shortLived = 0;
      this.next = 'polling';
    }
  }

  private scheduleProbe() {
    if (this.probeTimer || !this.Impl || this.options.transport) return;
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      this.probe();
    }, this.probeDelay);
  }

  private stopProbing() {
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = null;
    const probe = this.probing;
    this.probing = null;
    if (probe) {
      probe.onclose = probe.onmessage = probe.onerror = null;
      try { probe.close(); } catch {}
    }
  }

  private probe() {
    if (this.closed || !this.connected || this.transport !== 'polling' || this.probing) return;
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = null;
    let socket: SocketLike;
    try {
      socket = new this.Impl(this.url, this.options.socketOptions);
    } catch {
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.probing = socket;
    const failed = () => {
      if (this.probing !== socket) return;
      this.probing = null;
      clearTimeout(giveUp);
      socket.onclose = socket.onmessage = socket.onerror = null;
      try { socket.close(); } catch {}
      this.probeDelay = Math.min(PROBE_MAX_MS, this.probeDelay * 2);
      if (this.connected && this.transport === 'polling') this.scheduleProbe();
    };
    const giveUp = setTimeout(failed, GREET_MS.websocket);
    socket.onerror = () => {};
    socket.onclose = failed;
    socket.onmessage = (message) => {
      if (this.probing !== socket || typeof message.data !== 'string') return;
      let frame: unknown;
      try { frame = JSON.parse(message.data); } catch { return; }
      if (!Array.isArray(frame) || frame[0] !== HELLO) return;
      clearTimeout(giveUp);
      this.probing = null;
      this.adopt(socket);
    };
  }

  private adopt(socket: SocketLike) {
    const old = this.socket;
    this.socket = socket;
    this.transport = this.next = 'websocket';
    this.probeDelay = PROBE_MS;
    this.answers.clear();
    this.greetedAt = Date.now();
    prefer('websocket');
    this.wire(socket);
    this.heard();
    this.fire('open', true);
    if (old) {
      old.onclose = old.onmessage = old.onerror = null;
      try { old.close(1000); } catch {}
    }
  }

  private heard() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    const socket = this.socket;
    this.silenceTimer = setTimeout(() => {
      if (!socket) return;
      this.dropped(socket, 0, '');
      try { socket.close(4000, 'silent'); } catch {}
    }, SILENT_MS);
  }
}

const utf8 = new TextDecoder();

function bytesOf(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error('unreadable frame');
}

export function liveUrl(path: string) {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}${path}`;
}
