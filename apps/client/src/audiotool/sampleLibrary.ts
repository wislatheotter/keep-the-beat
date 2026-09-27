import { loopPlan, type GameSample } from '@loop/shared';
import { transformPool } from '../audio/dsp/transformClient';
import { locateSamples, mayPrefetch, preferLosslessFiles, type SampleAddresses } from './sampleUrls';

const RETIRED_CACHE = 'audiotool-samples-v1';
if (typeof caches !== 'undefined') void caches.delete(RETIRED_CACHE).catch(() => undefined);

const BACKGROUND_CONCURRENCY = 3;
const RETRY_AFTER_MS = 15_000;
const MAX_RETRY_AFTER_MS = 5 * 60_000;

export type PrepareProgress = {
  total: number;
  ready: number;
  failed: number;
  current: string | null;
};

export type PrepareResult = {
  ready: string[];
  failed: Array<{ sampleName: string; reason: string }>;
  bytes: number;
};

export type PrepareOptions = {
  onProgress?: (progress: PrepareProgress) => void;
  signal?: AbortSignal;
  concurrency?: number;
};

const ADDRESS_WINDOW_MS = 60_000;

type Entry = {
  buffer: AudioBuffer;
  kit: GameSample | null;
  expiresAt: number | null;
};

export function playLosslessSamples() {
  preferLosslessFiles();
}

export class SampleLibrary {
  private entries = new Map<string, Entry>();
  private bpm = 126;
  private sig: number | null = null;
  private inflight = new Map<string, Promise<Entry>>();
  private context: AudioContext | null = null;

  private wishlist: GameSample[] = [];
  private wanted: GameSample[] = [];
  private retry: number | null = null;
  private active = 0;
  private failures = new Map<string, { retryAt: number; count: number }>();
  private listeners = new Set<() => void>();
  private addresses: SampleAddresses = new Map();
  private addressedAt = -Infinity;
  private locating = false;

  attachContext(context: AudioContext) {
    this.context = context;
  }

  setRun(bpm: number, sig: number | null) {
    if (bpm === this.bpm && sig === this.sig) return;
    this.bpm = bpm;
    this.sig = sig;
    this.wishlist = [];
    for (const [key, entry] of this.entries) if (entry.expiresAt === null) this.entries.delete(key);
  }

  private key(sampleName: string) {
    return `${this.bpm}|${this.sig ?? '-'}|${sampleName}`;
  }

  private entry(sampleName: string): Entry | null {
    const key = this.key(sampleName);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  getBuffer(sampleName: string): AudioBuffer | null {
    return this.entry(sampleName)?.buffer ?? null;
  }

  getGameSample(sampleName: string): GameSample | null {
    return this.entry(sampleName)?.kit ?? null;
  }

  has(sampleName: string) {
    return this.entry(sampleName) !== null;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async cacheBytes(input: GameSample[], options: Pick<PrepareOptions, 'signal' | 'concurrency'> = {}) {
    if (!(await mayPrefetch()) || options.signal?.aborted) return;
    const uuids = [...new Set(input.map((sample) => sample.uuid))];
    const addresses = await locateSamples(uuids);
    const concurrency = Math.max(1, Math.min(8, options.concurrency ?? BACKGROUND_CONCURRENCY));
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (!options.signal?.aborted) {
        const uuid = uuids[cursor++];
        if (!uuid) return;
        const url = addresses.get(uuid);
        if (url) await warmFile(url);
      }
    }));
  }

  want(samples: GameSample[]) {
    this.wanted = samples;
    const now = Date.now();
    this.wishlist = samples.filter((sample) => !this.has(sample.sampleName)
      && !this.inflight.has(this.key(sample.sampleName))
      && now >= (this.failures.get(sample.sampleName)?.retryAt ?? 0));
    this.scheduleRetry();
    this.pump();
  }

  private pump() {
    while (this.active < BACKGROUND_CONCURRENCY && this.wishlist.length > 0) {
      const sample = this.wishlist[0]!;
      if (this.has(sample.sampleName) || this.inflight.has(this.key(sample.sampleName))) {
        this.wishlist.shift();
        continue;
      }
      if (Date.now() - this.addressedAt > ADDRESS_WINDOW_MS || !this.addresses.has(sample.uuid)) {
        this.locateWishlist();
        return;
      }
      this.wishlist.shift();
      this.active += 1;
      void this.load(sample, this.addresses.get(sample.uuid) ?? null)
        .catch((error) => {
          this.noteFailure(sample);
          console.warn('[samples] background load failed', sample.sampleName, error);
        })
        .finally(() => {
          this.active -= 1;
          this.emit();
          this.pump();
        });
    }
  }

  private locateWishlist() {
    if (this.locating) return;
    this.locating = true;
    const uuids = [...new Set(this.wishlist.map((sample) => sample.uuid))].slice(0, 100);
    void locateSamples(uuids)
      .then((addresses) => {
        this.addresses = addresses;
        this.addressedAt = Date.now();
      })
      .finally(() => {
        this.locating = false;
        this.pump();
      });
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private noteFailure(sample: GameSample) {
    const count = (this.failures.get(sample.sampleName)?.count ?? 0) + 1;
    const delay = Math.min(MAX_RETRY_AFTER_MS, RETRY_AFTER_MS * 2 ** (count - 1));
    this.failures.set(sample.sampleName, { retryAt: Date.now() + delay, count });
    this.scheduleRetry();
  }

  private scheduleRetry() {
    const wanted = new Set(this.wanted.map((sample) => sample.sampleName));
    let due = Infinity;
    for (const [name, failure] of this.failures) if (wanted.has(name)) due = Math.min(due, failure.retryAt);
    if (this.retry !== null) window.clearTimeout(this.retry);
    this.retry = null;
    if (due === Infinity) return;
    this.retry = window.setTimeout(() => {
      this.retry = null;
      this.want(this.wanted);
    }, Math.max(0, due - Date.now()) + 50);
  }

  async prepareRound(input: GameSample[], options: PrepareOptions = {}): Promise<PrepareResult> {
    const manifest = input.filter((sample, index) =>
      input.findIndex((other) => other.sampleName === sample.sampleName) === index);
    const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
    const result: PrepareResult = { ready: [], failed: [], bytes: 0 };
    const progress: PrepareProgress = { total: manifest.length, ready: 0, failed: 0, current: null };
    options.onProgress?.({ ...progress });

    const addresses = await locateSamples([...new Set(manifest
      .filter((sample) => !this.has(sample.sampleName))
      .map((sample) => sample.uuid))]);

    let cursor = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        if (options.signal?.aborted) return;
        const index = cursor;
        cursor += 1;
        if (index >= manifest.length) return;
        const sample = manifest[index]!;

        progress.current = sample.name;
        options.onProgress?.({ ...progress });

        try {
          const { bytes } = await this.load(sample, addresses.get(sample.uuid) ?? null);
          result.bytes += bytes;
          result.ready.push(sample.sampleName);
          progress.ready += 1;
          this.emit();
        } catch (error) {
          if (options.signal?.aborted) return;
          result.failed.push({ sampleName: sample.sampleName, reason: error instanceof Error ? error.message : String(error) });
          progress.failed += 1;
          this.noteFailure(sample);
          console.warn('[samples] failed', sample.sampleName, error);
        }
        progress.current = null;
        options.onProgress?.({ ...progress });
      }
    });

    await Promise.all(workers);
    this.emit();
    return result;
  }

  private load(sample: GameSample, url: string | null) {
    const key = this.key(sample.sampleName);
    const existing = this.inflight.get(key);
    if (existing) return existing.then((entry) => ({ entry, bytes: 0 }));
    const cached = this.entry(sample.sampleName);
    if (cached) return Promise.resolve({ entry: cached, bytes: 0 });
    if (url === null) return Promise.reject(new Error(`Audiotool no longer serves ${sample.sampleName}.`));

    const work = this.fetchAndDecode(sample, url, this.bpm, this.sig).then((result) => {
      this.entries.set(key, result.entry);
      return result;
    });
    const shared = work.then((result) => result.entry);
    shared.catch(() => undefined);
    this.inflight.set(key, shared);
    return work.finally(() => { this.inflight.delete(key); });
  }

  readyCount(samples: GameSample[]) {
    return samples.reduce((total, sample) => total + (this.has(sample.sampleName) ? 1 : 0), 0);
  }

  private async fetchAndDecode(sample: GameSample, url: string, bpm: number, sig: number | null) {
    const context = this.context;
    if (!context) throw new Error('SampleLibrary has no AudioContext yet.');

    const { bytes, expiresAt } = await fetchFile(url);
    const decoded = await context.decodeAudioData(bytes.slice(0));

    if (sample.bars <= 0) return { entry: { buffer: decoded, kit: sample, expiresAt } satisfies Entry, bytes: bytes.byteLength };

    const plan = loopPlan(sample, bpm, sig);
    const rate = decoded.sampleRate;
    const sourceLength = Math.min(decoded.length, Math.max(1, Math.round(plan.sourceSeconds * rate)));
    const outLength = Math.max(1, Math.round(plan.outSeconds * rate));
    const result = await transformPool.run(
      decoded.numberOfChannels,
      sourceLength,
      (targets) => targets.forEach((target, c) => decoded.copyFromChannel(target as Float32Array<ArrayBuffer>, c)),
      rate,
      { mode: plan.mode, outLength, semitones: plan.semitones },
    );
    try {
      const buffer = context.createBuffer(result.channels.length, outLength, rate);
      result.channels.forEach((channel, c) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, c));
      return { entry: { buffer, kit: sample, expiresAt } satisfies Entry, bytes: bytes.byteLength };
    } finally {
      result.release();
    }
  }

  clear() {
    this.entries.clear();
  }
}

type SampleFile = { bytes: ArrayBuffer; expiresAt: number | null };

const fileInflight = new Map<string, Promise<SampleFile>>();

function fetchFile(url: string): Promise<SampleFile> {
  const existing = fileInflight.get(url);
  if (existing) return existing;
  const work = fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const maxAge = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(response.headers.get('cache-control') ?? '');
      const expiresAt = maxAge ? Date.now() + Number(maxAge[1]) * 1000 : null;
      return { bytes: await response.arrayBuffer(), expiresAt };
    })
    .finally(() => fileInflight.delete(url));
  fileInflight.set(url, work);
  return work;
}

async function warmFile(url: string) {
  if (fileInflight.has(url)) {
    await fileInflight.get(url)!.catch(() => undefined);
    return;
  }
  try {
    const response = await fetch(url);
    if (response.ok) await response.blob();
  } catch {
  }
}

export const sampleLibrary = new SampleLibrary();
