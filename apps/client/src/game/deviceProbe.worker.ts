import { PROBE_CONTEXT, PROBE_SIZE, measureGpu, type GpuReading } from './deviceProbeGpu';

let hidden = false;
const pause = () => new Promise<boolean>((resolve) => setTimeout(() => resolve(!hidden), 16));

self.onmessage = async (event: MessageEvent<{ hidden?: boolean; start?: boolean }>) => {
  if (event.data.hidden !== undefined) hidden = event.data.hidden;
  if (!event.data.start) return;
  let reading: GpuReading | null = null;
  let supported = false;
  try {
    const canvas = new OffscreenCanvas(PROBE_SIZE, PROBE_SIZE);
    const gl = canvas.getContext('webgl2', PROBE_CONTEXT) as WebGL2RenderingContext | null;
    supported = gl !== null;
    if (gl) reading = await measureGpu(gl, pause);
  } catch {
    reading = null;
  }
  self.postMessage({ reading, supported, hidden });
};
