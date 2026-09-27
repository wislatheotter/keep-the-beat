const RPC_BASE = 'https://rpc.audiotool.com/audiotool.sample.v1.SampleService';

export type SampleMetaLite = {
  name: string;
  displayName: string;
  description: string;
  ownerName: string;
  durationSeconds: number;
  bpm: number;
  kind: 'one-shot' | 'loop' | 'unspecified';
  clearance: 'safe' | 'unsafe' | 'unspecified';
  tags: string[];
  numUsages: number;
  numFavorites: number;
  previewMp3Url: string;
  mp3Url: string;
  wavUrl: string;
  flacUrl: string;
};

export type SampleListOptions = {
  filter?: string;
  textSearch?: string;
  orderBy?: string;
  pageSize?: number;
  pageToken?: string;
};

export type SampleFormat = 'preview' | 'mp3' | 'wav' | 'flac';

type RawSample = {
  name?: string;
  displayName?: string;
  description?: string;
  ownerName?: string;
  numFavorites?: number;
  numUsages?: number;
  bpm?: number;
  sampleType?: string;
  playDuration?: string;
  clearance?: string;
  usage?: string;
  tags?: string[];
  mp3Url?: string;
  wavUrl?: string;
  previewMp3Url?: string;
  flacUrl?: string;
};

export function parseDurationSeconds(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value.endsWith('s') ? value.slice(0, -1) : value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toSampleMetaLite(raw: RawSample): SampleMetaLite {
  return {
    name: raw.name ?? '',
    displayName: raw.displayName ?? '',
    description: raw.description ?? '',
    ownerName: raw.ownerName ?? '',
    durationSeconds: parseDurationSeconds(raw.playDuration),
    bpm: raw.bpm ?? 0,
    kind: raw.sampleType === 'SAMPLE_TYPE_LOOP' ? 'loop' : raw.sampleType === 'SAMPLE_TYPE_ONE_SHOT' ? 'one-shot' : 'unspecified',
    clearance: raw.clearance === 'SAMPLE_CLEARANCE_SAFE' ? 'safe' : raw.clearance === 'SAMPLE_CLEARANCE_UNSAFE' ? 'unsafe' : 'unspecified',
    tags: raw.tags ?? [],
    numUsages: raw.numUsages ?? 0,
    numFavorites: raw.numFavorites ?? 0,
    previewMp3Url: raw.previewMp3Url ?? '',
    mp3Url: raw.mp3Url ?? '',
    wavUrl: raw.wavUrl ?? '',
    flacUrl: raw.flacUrl ?? '',
  };
}

const MIN_REQUEST_GAP_MS = 350;
let chain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = chain.then(async () => {
    const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return work();
  });
  chain = result.catch(() => undefined);
  return result;
}

async function rpc<T>(method: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${RPC_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Audiotool ${method} failed: ${response.status} ${text.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

export async function listSamples(options: SampleListOptions = {}, signal?: AbortSignal) {
  const payload = await enqueue(() => rpc<{ samples?: RawSample[]; nextPageToken?: string }>('ListSamples', {
    pageSize: options.pageSize ?? 20,
    pageToken: options.pageToken ?? '',
    filter: options.filter ?? '',
    orderBy: options.orderBy ?? '',
    textSearch: options.textSearch ?? '',
  }, signal));
  return {
    samples: (payload.samples ?? []).map(toSampleMetaLite),
    nextPageToken: payload.nextPageToken ?? '',
  };
}

export async function getSample(name: string, signal?: AbortSignal): Promise<SampleMetaLite> {
  const payload = await enqueue(() => rpc<{ sample?: RawSample }>('GetSample', { name }, signal));
  if (!payload.sample) throw new Error(`Audiotool sample not found: ${name}`);
  return toSampleMetaLite(payload.sample);
}

export function sampleUrl(meta: SampleMetaLite, format: SampleFormat): string {
  switch (format) {
    case 'preview': return meta.previewMp3Url;
    case 'mp3': return meta.mp3Url;
    case 'wav': return meta.wavUrl;
    case 'flac': return meta.flacUrl;
  }
}

export async function downloadSample(meta: SampleMetaLite, format: SampleFormat = 'preview', signal?: AbortSignal): Promise<Blob> {
  const url = sampleUrl(meta, format);
  if (!url) throw new Error(`Audiotool sample ${meta.name} has no ${format} URL.`);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Audiotool download failed: ${response.status} ${url}`);
  return response.blob();
}
