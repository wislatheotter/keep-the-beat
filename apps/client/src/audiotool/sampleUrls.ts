import type { AuthenticatedClient } from '@audiotool/nexus';
import { DEV_HANDLE } from '../runtime/devFlag';
import { getAudiotoolSession, subscribeAudiotoolSession, type AudiotoolAuthSession } from './sessionStore';

type Format = 'preview' | 'flac';

const BATCH = 100;
const MIN_GAP_MS = 1_000;
const BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 10 * 60_000;
const SESSION_WAIT_MS = 5_000;

let format: Format = 'preview';

export function preferLosslessFiles() {
  format = 'flac';
}

export type SampleAddresses = Map<string, string | null>;

function cdnUrl(uuid: string) {
  return `https://cdn.audiotool.com/samples/${uuid}/${format === 'flac' ? 's.flac' : 'preview.mp3'}`;
}

const PENDING: ReadonlyArray<AudiotoolAuthSession['status']> = ['idle', 'configuring', 'connecting'];

function signedInClient(waitMs = SESSION_WAIT_MS): Promise<AuthenticatedClient | null> {
  const now = getAudiotoolSession();
  if (!PENDING.includes(now.status)) return Promise.resolve(now.client);
  return new Promise((resolve) => {
    let done = false;
    let off: (() => void) | null = null;
    const finish = (client: AuthenticatedClient | null) => {
      if (done) return;
      done = true;
      if (timer !== null) window.clearTimeout(timer);
      off?.();
      resolve(client);
    };
    const timer = Number.isFinite(waitMs) ? window.setTimeout(() => finish(null), waitMs) : null;
    off = subscribeAudiotoolSession((session) => {
      if (!PENDING.includes(session.status)) finish(session.client);
    });
    if (done) off();
  });
}

export function mayPrefetch(): Promise<boolean> {
  return signedInClient(Infinity).then((client) => client !== null || DEV_HANDLE);
}

type Waiter = { uuids: string[]; resolve: (found: SampleAddresses) => void };

let queued: Waiter[] = [];
let flushTimer: number | null = null;
let chain: Promise<void> = Promise.resolve();
let lastRequestAt = -Infinity;
let backoff = 0;
let resumeAt = 0;
let announced = false;

export function locateSamples(uuids: string[]): Promise<SampleAddresses> {
  if (uuids.length === 0) return Promise.resolve(new Map());
  return new Promise((resolve) => {
    queued.push({ uuids, resolve });
    flushTimer ??= window.setTimeout(flush, 0);
  });
}

function flush() {
  flushTimer = null;
  const waiters = queued;
  queued = [];
  const uuids = [...new Set(waiters.flatMap((waiter) => waiter.uuids))];
  chain = chain.then(async () => {
    const found: SampleAddresses = new Map();
    for (let i = 0; i < uuids.length; i += BATCH) {
      const batch = uuids.slice(i, i + BATCH);
      const answer = await lookup(batch);
      for (const uuid of batch) found.set(uuid, answer ? answer.get(uuid) ?? null : cdnUrl(uuid));
    }
    for (const waiter of waiters) {
      waiter.resolve(new Map(waiter.uuids.map((uuid) => [uuid, found.has(uuid) ? found.get(uuid)! : cdnUrl(uuid)])));
    }
  });
}

async function lookup(uuids: string[]): Promise<SampleAddresses | null> {
  const client = await signedInClient();
  if (!client || Date.now() < resumeAt) return null;

  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();

  const filter = `sample.name in [${uuids.map((uuid) => `'samples/${uuid}'`).join(',')}]`;
  let result: Awaited<ReturnType<AuthenticatedClient['samples']['list']>>;
  try {
    result = await client.samples.list({ filter, pageSize: BATCH });
  } catch (error) {
    result = error instanceof Error ? error : new Error(String(error));
  }

  if (result instanceof Error) {
    backoff = backoff ? Math.min(MAX_BACKOFF_MS, backoff * 2) : BACKOFF_MS;
    resumeAt = Date.now() + backoff;
    console.warn(`[samples] account lookup failed; CDN addresses for ${Math.round(backoff / 1000)} s`, result.message);
    return null;
  }

  backoff = 0;
  if (!announced) {
    announced = true;
    console.info('[samples] looked up with the signed-in Audiotool account');
  }
  const found: SampleAddresses = new Map();
  const complete = result.samples.length < BATCH || !result.nextPageToken;
  for (const sample of result.samples) {
    const uuid = sample.name.replace(/^samples\//, '');
    found.set(uuid, (format === 'flac' ? sample.flacUrl : sample.previewMp3Url) || cdnUrl(uuid));
  }
  for (const uuid of uuids) if (!found.has(uuid)) found.set(uuid, complete ? null : cdnUrl(uuid));
  return found;
}
