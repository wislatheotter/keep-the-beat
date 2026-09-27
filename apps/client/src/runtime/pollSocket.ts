import {
  BATCH_BINARY,
  BATCH_CLOSE,
  BATCH_TEXT,
  POLL_PATH,
  POSE_FRAME,
  decodeBatch,
  decodeClose,
  encodeBatch,
  encodeClose,
  type BatchFrame,
} from '@loop/shared/wire';

const RETRY_FOR_MS = 7000;
const POLL_TIMEOUT_MS = 28_000;
const SEND_TIMEOUT_MS = 10_000;
const OPEN_TIMEOUT_MS = 10_000;
const MAX_QUEUED_POSES = 12;

const utf8Out = new TextEncoder();
const utf8In = new TextDecoder();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url: string, init: RequestInit, ms: number) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: abort.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

export class PollSocket {
  readyState = 0;
  binaryType = 'arraybuffer';
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  private readonly base: string;
  private readonly query: string;
  private id: string | null = null;
  private ack = 0;
  private outbox: BatchFrame[] = [];
  private inFlight = 0;
  private sendSeq = 0;
  private sending = false;
  private finished = false;

  constructor(url: string) {
    const parsed = new URL(url);
    const secure = parsed.protocol === 'wss:' || parsed.protocol === 'https:';
    this.base = `${secure ? 'https' : 'http'}://${parsed.host}${POLL_PATH}`;
    this.query = parsed.search;
    void this.start();
  }

  get bufferedAmount() {
    let bytes = this.inFlight;
    for (const frame of this.outbox) bytes += frame.data.byteLength;
    return bytes;
  }

  send(data: string | Uint8Array) {
    if (this.readyState !== 1) return;
    const bytes = typeof data === 'string' ? utf8Out.encode(data) : new Uint8Array(data);
    const kind = typeof data === 'string' ? BATCH_TEXT : BATCH_BINARY;
    if (kind === BATCH_BINARY && bytes[0] === POSE_FRAME) {
      let poses = 0;
      for (const frame of this.outbox) if (frame.kind === BATCH_BINARY && frame.data[0] === POSE_FRAME) poses += 1;
      if (poses >= MAX_QUEUED_POSES) {
        const oldest = this.outbox.findIndex((frame) => frame.kind === BATCH_BINARY && frame.data[0] === POSE_FRAME);
        this.outbox.splice(oldest, 1);
      }
    }
    this.outbox.push({ kind, data: bytes });
    void this.flush();
  }

  close(code = 1000, reason = '') {
    if (this.finished) return;
    if (this.id) {
      const body = encodeBatch([{ kind: BATCH_CLOSE, data: encodeClose(code, reason) }]);
      fetch(`${this.base}/${this.id}?seq=${this.sendSeq + 1}`, { method: 'POST', body: body as BodyInit, keepalive: true, cache: 'no-store' }).catch(() => {});
    }
    this.finish(code, reason);
  }

  private async start() {
    try {
      const response = await request(`${this.base}${this.query}`, { method: 'POST' }, OPEN_TIMEOUT_MS);
      if (!response.ok) throw new Error(String(response.status));
      const answer = await response.json() as { id?: string; refused?: [number, string] };
      if (this.finished) return;
      if (answer.refused) {
        this.finish(answer.refused[0], answer.refused[1]);
        return;
      }
      if (typeof answer.id !== 'string') throw new Error('no line');
      this.id = answer.id;
      this.readyState = 1;
      this.onopen?.({});
      void this.receive();
    } catch (error) {
      if (this.finished) return;
      this.onerror?.(error);
      this.finish(1006, '');
    }
  }

  private async receive() {
    let failingSince = 0;
    while (!this.finished) {
      try {
        const response = await request(`${this.base}/${this.id}?ack=${this.ack}`, {}, POLL_TIMEOUT_MS);
        if (this.finished) return;
        if (response.status === 410 || response.status === 404 || response.status === 400) { this.finish(1006, ''); return; }
        if (!response.ok) throw new Error(String(response.status));
        const bytes = new Uint8Array(await response.arrayBuffer());
        failingSince = 0;
        if (!this.deliver(bytes)) return;
      } catch {
        if (this.finished) return;
        failingSince ||= Date.now();
        if (Date.now() - failingSince > RETRY_FOR_MS) { this.finish(1006, ''); return; }
        await sleep(250 + Math.random() * 500);
      }
    }
  }

  private deliver(bytes: Uint8Array) {
    if (bytes.length < 4) return !this.finished;
    const last = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
    const frames = decodeBatch(bytes, 4);
    if (!frames) { this.finish(1006, ''); return false; }
    let seq = last - frames.length + 1;
    for (const frame of frames) {
      if (seq > this.ack) {
        this.ack = seq;
        if (frame.kind === BATCH_CLOSE) {
          const { code, reason } = decodeClose(frame.data);
          this.finish(code, reason);
          return false;
        }
        const data = frame.kind === BATCH_TEXT ? utf8In.decode(frame.data) : frame.data.slice().buffer;
        this.onmessage?.({ data });
        if (this.finished) return false;
      }
      seq += 1;
    }
    return true;
  }

  private async flush() {
    if (this.sending || !this.id || this.finished) return;
    this.sending = true;
    try {
      while (this.outbox.length && !this.finished) {
        const frames = this.outbox;
        this.outbox = [];
        const body = encodeBatch(frames);
        const seq = ++this.sendSeq;
        this.inFlight = body.byteLength;
        let failingSince = 0;
        for (;;) {
          try {
            const response = await request(`${this.base}/${this.id}?seq=${seq}`, {
              method: 'POST',
              body: body as BodyInit,
              headers: { 'Content-Type': 'application/octet-stream' },
            }, SEND_TIMEOUT_MS);
            if (this.finished) return;
            if (response.status === 410 || response.status === 404 || response.status === 400) { this.finish(1006, ''); return; }
            if (!response.ok) throw new Error(String(response.status));
            break;
          } catch {
            if (this.finished) return;
            failingSince ||= Date.now();
            if (Date.now() - failingSince > RETRY_FOR_MS) { this.finish(1006, ''); return; }
            await sleep(250 + Math.random() * 500);
          }
        }
        this.inFlight = 0;
      }
    } finally {
      this.sending = false;
    }
  }

  private finish(code: number, reason: string) {
    if (this.finished) return;
    this.finished = true;
    this.readyState = 3;
    this.outbox = [];
    this.onclose?.({ code, reason });
  }
}
