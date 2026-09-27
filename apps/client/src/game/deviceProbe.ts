import { DEV_HANDLE } from '../runtime/devFlag';
import { PROBE_CONTEXT, PROBE_SIZE, best, measureGpu, type GpuReading } from './deviceProbeGpu';

export type DeviceProbe = {
  fillMsPerMegapixel: number;
  drawMsPerThousand: number;
  cpuMs: number;
  renderer: string;
  cached: boolean;
};

const STORAGE_KEY = 'ktb-device-probe-v2';

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const request = (window as Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (request) request(() => resolve(), { timeout: 400 });
    else setTimeout(resolve, 16);
  });
}

const pageTurn = () => idle().then(() => !document.hidden);

function measureCpu() {
  const SIZE = 4096;
  const data = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i += 1) data[i] = Math.sin(i) * 0.5;
  const start = performance.now();
  let acc = 0;
  for (let pass = 0; pass < 220; pass += 1) {
    for (let i = 0; i < SIZE; i += 1) {
      const v = data[i]!;
      acc += v * 1.000001 + Math.sqrt(Math.abs(v) + 1);
      data[i] = acc > 1e12 ? 0 : v;
    }
  }
  return performance.now() - start + (acc === 12345.6789 ? 1 : 0);
}

async function run(): Promise<DeviceProbe | null> {
  const gpu = await measureInWorker() ?? await measureOnPage();
  if (!gpu) return null;
  await idle();
  if (document.hidden) return null;
  const cpuMs = await best(3, measureCpu, pageTurn);
  return { ...gpu, cpuMs, cached: false };
}

function measureInWorker(): Promise<GpuReading | null | undefined> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./deviceProbe.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(undefined);
      return;
    }
    const onVisibility = () => worker.postMessage({ hidden: document.hidden });
    const finish = (value: GpuReading | null | undefined) => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      worker.terminate();
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), 10_000);
    worker.onmessage = (event: MessageEvent<{ reading: GpuReading | null; supported: boolean; hidden: boolean }>) => {
      const { reading, supported, hidden } = event.data;
      finish(!supported ? undefined : hidden || document.hidden ? null : reading);
    };
    worker.onerror = () => finish(undefined);
    document.addEventListener('visibilitychange', onVisibility);
    worker.postMessage({ hidden: document.hidden, start: true });
  });
}

async function measureOnPage(): Promise<GpuReading | null> {
  await idle();
  const canvas = document.createElement('canvas');
  canvas.width = PROBE_SIZE;
  canvas.height = PROBE_SIZE;
  const gl = canvas.getContext('webgl2', PROBE_CONTEXT);
  if (!gl) return null;
  if (!(await pageTurn())) return null;
  return measureGpu(gl, pageTurn);
}

function mergeWithCache(fresh: DeviceProbe): DeviceProbe {
  const cached = readCache();
  if (!cached) return fresh;
  return {
    fillMsPerMegapixel: Math.min(cached.fillMsPerMegapixel, fresh.fillMsPerMegapixel),
    drawMsPerThousand: Math.min(cached.drawMsPerThousand, fresh.drawMsPerThousand),
    cpuMs: Math.min(cached.cpuMs, fresh.cpuMs),
    renderer: fresh.renderer,
    cached: false,
  };
}

function readCache(): DeviceProbe | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as DeviceProbe & { renderer: string };
    if (typeof value?.fillMsPerMegapixel !== 'number'
      || typeof value?.drawMsPerThousand !== 'number'
      || typeof value?.cpuMs !== 'number') return null;
    return { ...value, cached: true };
  } catch {
    return null;
  }
}

let pending: Promise<DeviceProbe | null> | null = null;
let settled: DeviceProbe | null = readCache();
if (settled) publish(settled);

function publish(result: DeviceProbe | null) {
  if (!DEV_HANDLE || !result) return;
  const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop ?? {};
  handle.probe = result;
  (window as unknown as { __loop?: unknown }).__loop = handle;
}

export function probeResult() {
  return settled;
}

export function probeDevice(): Promise<DeviceProbe | null> {
  if (settled) return Promise.resolve(settled);
  if (pending) return pending;
  pending = run()
    .then((result) => {
      if (result) {
        settled = mergeWithCache(result);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settled)); } catch {}
      }
      publish(result);
      return result;
    })
    .catch(() => null);
  return pending;
}
