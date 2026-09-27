import { probeDevice } from './game/deviceProbe';

let game: typeof import('./Game') | null = null;
export const loadGame = () => import('./Game').then((module) => {
  game = module;
  return module;
});
export const gameIfReady = () => game;

export const loadSocketRuntime = () => import('./runtime/SocketGameRuntime');

let localRuntime: typeof import('./runtime/LocalGameRuntime') | null = null;
export const loadLocalRuntime = () => import('./runtime/LocalGameRuntime').then((module) => {
  localRuntime = module;
  return module;
});
export const localRuntimeIfReady = () => localRuntime;

const STAGE_FILES = [
  '/draco/draco_wasm_wrapper.js',
  '/draco/draco_decoder.wasm',
  '/environment/room-pmrem.binz',
  '/stations/venue.glb',
  '/stations/deck.glb',
  '/stations/stations.glb',
  '/stations/machines.glb',
  '/stations/song-arc.glb',
  '/props/records.glb',
  '/props/disco-ball/disco-ball.glb',
  '/props/disco-ball/DiscoUV.png',
  '/characters/crowd.bin',
  '/characters/rabbit_anims.glb',
];

const RIG_FILES = ['Bald', 'Blond', 'Cyan', 'Green', 'Grey', 'Pink', 'Purple']
  .map((variant) => `/characters/Rabbit_${variant}.glb`);

function codeFiles(): string[] {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="ktb-game-code"]');
  return meta?.content.split(/\s+/).filter(Boolean) ?? [];
}

const PRELOAD_LANES = 3;

let started = false;
let stopped = false;
const aborted = new AbortController();

export function stopPreloading() {
  stopped = true;
  aborted.abort();
}

type Opening = { themeId: string; runSeed: number };
let opening: Opening | null = null;
export const openingIfChosen = () => opening;

function idle(timeout = 2000): Promise<void> {
  return new Promise((resolve) => {
    const request = (window as Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (request) request(() => resolve(), { timeout });
    else setTimeout(resolve, 32);
  });
}

function visible(): Promise<void> {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

function connectionAllows() {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}

async function warm(url: string) {
  try {
    const response = await fetch(url, { priority: 'low', cache: 'force-cache' } as RequestInit);
    await response.blob();
  } catch {
  }
}

export async function preloadGame() {
  if (started || stopped) return;
  started = true;
  if (!connectionAllows()) return;

  void probeDevice().catch(() => null);

  await idle(120);
  const queue = [...codeFiles(), ...STAGE_FILES, ...RIG_FILES];
  const lane = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      await visible();
      if (stopped) return;
      await warm(url);
    }
  };
  await Promise.all(Array.from({ length: PRELOAD_LANES }, lane));
  if (stopped) return;

  await visible();
  if (stopped) return;
  const { mayPrefetch } = await import('./audiotool/sampleUrls');
  if (!(await mayPrefetch()) || stopped) return;
  await idle(1000);
  if (stopped) return;
  const { chooseOpening, prefetchOpening } = await import('./audiotool/openingPrefetch');
  if (stopped) return;
  opening = chooseOpening();
  await prefetchOpening(opening, aborted.signal).catch(() => undefined);
}
