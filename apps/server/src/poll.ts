import { randomBytes } from 'node:crypto';
import type { HttpRequest, HttpResponse, TemplatedApp } from 'uWebSockets.js';
import {
  BATCH_BINARY,
  BATCH_CLOSE,
  BATCH_TEXT,
  POLL_PATH,
  POSES_FRAME,
  SNAPSHOT_FRAME,
  decodeBatch,
  encodeBatch,
} from '@loop/shared/wire';

const HOLD_MS = 20_000;
const GONE_MS = 15_000;
const GATHER_MS = 25;
const VOLATILE_BYTES = 32 * 1024;
const MAX_QUEUED_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_BYTES = 256 * 1024;

type Queued = { seq: number; kind: number; data: Uint8Array };

export type PollHooks<C> = {
  admit(origin: string, host: string, version: string, forwardedFor: string, peer: string): C | null;
  refusal(conn: C): [number, string] | null;
  attach(conn: C, link: PollLink): void;
  opened(conn: C): void;
  received(conn: C, data: Uint8Array, binary: boolean): void;
  closed(conn: C): void;
};

const utf8 = new TextEncoder();

export class PollLink {
  readonly topics = new Set<string>();
  private queue: Queued[] = [];
  private nextSeq = 1;
  private sentUpTo = 0;
  private queuedBytes = 0;
  inSeq = 0;
  private waiting: HttpResponse | null = null;
  private holdTimer: NodeJS.Timeout | null = null;
  private goneTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private lastResponseAt = 0;
  ended = false;

  constructor(readonly id: string, private readonly onGone: (link: PollLink) => void) {
    this.expectPoll();
  }

  push(data: string | Uint8Array, binary: boolean) {
    if (this.ended) return;
    const bytes = typeof data === 'string' ? utf8.encode(data) : data;
    if (binary && bytes[0] === POSES_FRAME && this.queuedBytes > VOLATILE_BYTES) return;
    if (binary && bytes[0] === SNAPSHOT_FRAME) {
      const last = this.lastUnsentSnapshot();
      if (last) {
        this.queuedBytes += bytes.byteLength - last.data.byteLength;
        last.data = bytes;
        this.wake();
        return;
      }
    }
    this.enqueue(binary ? BATCH_BINARY : BATCH_TEXT, bytes);
    if (this.queuedBytes > MAX_QUEUED_BYTES) {
      this.kill();
      return;
    }
    this.wake();
  }

  kill() {
    this.ended = true;
    this.forget();
  }

  poll(res: HttpResponse, ack: number) {
    this.clearGone();
    if (this.waiting) this.respond(this.waiting, []);
    this.acknowledge(ack);
    this.waiting = res;
    res.onAborted(() => {
      res.aborted = true;
      if (this.waiting === res) {
        this.waiting = null;
        this.clearHold();
        this.expectPoll();
      }
    });
    const pending = this.queue.length > 0;
    if (pending) this.wake();
    else this.holdTimer = setTimeout(() => this.flush(), HOLD_MS);
  }

  private enqueue(kind: number, data: Uint8Array) {
    this.queue.push({ seq: this.nextSeq++, kind, data });
    this.queuedBytes += data.byteLength;
  }

  private lastUnsentSnapshot(): Queued | null {
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      const entry = this.queue[i]!;
      if (entry.seq <= this.sentUpTo) return null;
      if (entry.kind === BATCH_BINARY && entry.data[0] === SNAPSHOT_FRAME) return entry;
    }
    return null;
  }

  private acknowledge(ack: number) {
    let drop = 0;
    while (drop < this.queue.length && this.queue[drop]!.seq <= ack) {
      this.queuedBytes -= this.queue[drop]!.data.byteLength;
      drop += 1;
    }
    if (drop) this.queue.splice(0, drop);
    this.sentUpTo = Math.min(this.sentUpTo, ack);
  }

  private wake() {
    if (!this.waiting || this.flushTimer) return;
    const wait = Math.max(0, this.lastResponseAt + GATHER_MS - Date.now());
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, wait);
  }

  private flush() {
    this.clearHold();
    const res = this.waiting;
    if (!res) return;
    this.waiting = null;
    this.respond(res, this.queue);
  }

  private respond(res: HttpResponse, frames: readonly Queued[]) {
    const last = frames.length ? frames[frames.length - 1]!.seq : this.sentUpTo;
    const body = encodeBatch(frames, 4);
    new DataView(body.buffer).setUint32(0, last, true);
    if (frames.length) this.sentUpTo = Math.max(this.sentUpTo, last);
    this.lastResponseAt = Date.now();
    if (!res.aborted) {
      res.cork(() => {
        res.writeStatus('200 OK').writeHeader('Content-Type', 'application/octet-stream').writeHeader('Cache-Control', 'no-store').end(body);
      });
    }
    this.expectPoll();
  }

  private expectPoll() {
    if (this.ended) return;
    this.clearGone();
    this.goneTimer = setTimeout(() => this.forget(), GONE_MS);
  }

  private clearGone() {
    if (this.goneTimer) clearTimeout(this.goneTimer);
    this.goneTimer = null;
  }

  private clearHold() {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private forgotten = false;
  private forget() {
    if (this.forgotten) return;
    this.forgotten = true;
    this.ended = true;
    this.clearGone();
    this.clearHold();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const res = this.waiting;
    this.waiting = null;
    if (res && !res.aborted) res.cork(() => res.writeStatus('410 Gone').writeHeader('Cache-Control', 'no-store').end());
    this.queue = [];
    this.onGone(this);
  }
}

function reply(res: HttpResponse, status: string, body = '', type = 'text/plain') {
  if (res.aborted) return;
  res.cork(() => {
    res.writeStatus(status).writeHeader('Content-Type', type).writeHeader('Cache-Control', 'no-store').end(body);
  });
}

function readBody(res: HttpResponse, limit: number, done: (body: Uint8Array | null) => void) {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  res.onData((chunk, isLast) => {
    if (!over) {
      size += chunk.byteLength;
      if (size > limit) over = true;
      else chunks.push(Buffer.from(chunk.slice(0)));
    }
    if (isLast) done(over || res.aborted ? null : Buffer.concat(chunks));
  });
}

export function mountPolling<C>(app: TemplatedApp, hooks: PollHooks<C>) {
  const lines = new Map<string, { link: PollLink; conn: C }>();

  const lineFor = (req: HttpRequest) => {
    const id = req.getParameter(0) ?? '';
    return lines.get(id) ?? null;
  };

  app.post(POLL_PATH, (res, req) => {
    res.onAborted(() => { res.aborted = true; });
    const conn = hooks.admit(
      req.getHeader('origin'),
      req.getHeader('host'),
      req.getQuery('v') ?? '',
      req.getHeader('x-forwarded-for'),
      Buffer.from(res.getRemoteAddressAsText()).toString(),
    );
    if (!conn) return reply(res, '403 Forbidden');
    const refusal = hooks.refusal(conn);
    if (refusal) return reply(res, '200 OK', JSON.stringify({ refused: refusal }), 'application/json');
    const id = randomBytes(16).toString('base64url');
    const link = new PollLink(id, (gone) => {
      if (lines.get(gone.id)?.link !== gone) return;
      lines.delete(gone.id);
      hooks.closed(conn);
    });
    lines.set(id, { link, conn });
    hooks.attach(conn, link);
    hooks.opened(conn);
    reply(res, '200 OK', JSON.stringify({ id }), 'application/json');
  });

  app.get(`${POLL_PATH}/:id`, (res, req) => {
    res.onAborted(() => { res.aborted = true; });
    const line = lineFor(req);
    const ack = Number(req.getQuery('ack'));
    if (!line) return reply(res, '410 Gone');
    if (!Number.isSafeInteger(ack) || ack < 0) return reply(res, '400 Bad Request');
    line.link.poll(res, ack);
  });

  app.post(`${POLL_PATH}/:id`, (res, req) => {
    res.onAborted(() => { res.aborted = true; });
    const line = lineFor(req);
    const seq = Number(req.getQuery('seq'));
    readBody(res, MAX_BATCH_BYTES, (body) => {
      if (res.aborted) return;
      if (!line || line.link.ended) return reply(res, '410 Gone');
      if (!body || !Number.isSafeInteger(seq)) {
        line.link.kill();
        return reply(res, '400 Bad Request');
      }
      if (seq <= line.link.inSeq) return reply(res, '204 No Content');
      const frames = decodeBatch(body);
      if (seq !== line.link.inSeq + 1 || !frames) {
        line.link.kill();
        return reply(res, '400 Bad Request');
      }
      line.link.inSeq = seq;
      for (const frame of frames) {
        if (line.link.ended) break;
        if (frame.kind === BATCH_CLOSE) {
          line.link.kill();
          break;
        }
        hooks.received(line.conn, frame.data, frame.kind === BATCH_BINARY);
      }
      reply(res, '204 No Content');
    });
  });

  return { count: () => lines.size };
}
