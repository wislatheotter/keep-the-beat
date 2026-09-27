import { advance, useStore, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { PERFORMANCE } from '../performance';
import { createGovernor, governorTick } from '../qualityGovernor';
import { DEV_HANDLE } from '../../runtime/devFlag';
import { PERF_READOUT, createPerfReadout } from '../perfReadout';
import { noteHitch, sampleHeap } from '../hitchLog';
import { useGameRuntime } from '../../runtime/GameRuntimeContext';
import { stageMode } from '../stage';
import { LIVE_QUALITY, SHEDDABLE, applyShed } from '../liveQuality';

export function FramePacer({ running, govern, gentle = false, onCalm }: {
  running: boolean;
  govern: boolean;
  gentle?: boolean;
  onCalm?: () => void;
}) {
  const get = useThree((three) => three.get);
  const gl = useThree((three) => three.gl);
  const store = useStore();
  const governor = useMemo(() => createGovernor({
    pacing: true, cap: PERFORMANCE.frameCap, maxShed: SHEDDABLE.length, aa: PERFORMANCE.smaaOnHeadroom,
  }), []);
  const governing = useRef(govern);
  governing.current = govern;
  const polite = useRef(gentle);
  polite.current = gentle;
  const calm = useRef(onCalm);
  calm.current = onCalm;
  const room = useRef(useGameRuntime());
  room.current = useGameRuntime();

  useEffect(() => {
    if (!DEV_HANDLE) return;
    const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop ?? {};
    handle.quality = () => ({
      tier: PERFORMANCE.quality,
      scale: governor.scale,
      pixelRatio: gl.getPixelRatio(),
      cap: governor.cap,
      medianMs: governor.lastMedian,
      cpuMs: governor.lastCpu,
      decision: governor.lastDecision,
      shed: SHEDDABLE.slice(0, governor.shed),
      smaa: governor.aa,
      fxaa: governor.fxaa,
    });
    handle.setSmaa = (on: boolean) => { governor.aa = on; LIVE_QUALITY.smaa = on; };
    handle.setFxaa = (on: boolean) => { governor.fxaa = on; LIVE_QUALITY.fxaa = on; };
    handle.setShed = (level: number) => { governor.shed = level; applyShed(level); };
    (window as unknown as { __loop?: unknown }).__loop = handle;
  }, [gl, governor]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastFrame = 0;
    let lastRefresh = 0;
    const refreshes = new Float32Array(REFRESH_WINDOW);
    let refreshCount = 0;
    const readout = PERF_READOUT ? createPerfReadout(gl, governor) : null;
    applyShed(governor.shed);
    LIVE_QUALITY.smaa = PERFORMANCE.smaaAlways || governor.aa;
    LIVE_QUALITY.fxaa = governor.fxaa;
    let display = 0;
    const context = gl.getContext();
    const fences = typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext ? context : null;
    const inFlight: WebGLSync[] = [];
    let waits = 0;
    let watchedSince = 0;
    let watched = 0;
    let steady = 0;
    const recent = new Float32Array(CALM_WINDOW);
    const usual = new Float32Array(CALM_WINDOW);
    let usualCount = 0;

    let lastCpu = 0;
    let waited = 0;
    let programs = gl.info.programs?.length ?? 0;
    let textures = gl.info.memory.textures;
    let pendingRatio = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const late = performance.now() - now;
      if (lastRefresh) refreshes[refreshCount++ % REFRESH_WINDOW] = now - lastRefresh;
      lastRefresh = now;

      if (fences) {
        while (inFlight.length && fences.getSyncParameter(inFlight[0]!, fences.SYNC_STATUS) === fences.SIGNALED) {
          fences.deleteSync(inFlight.shift()!);
        }
        const ahead = polite.current ? 0 : 1;
        if (inFlight.length > ahead) {
          if (waits < (polite.current ? Infinity : MAX_WAITS)) {
            waits += 1;
            return;
          }
          while (inFlight.length > ahead) fences.deleteSync(inFlight.shift()!);
        }
        waited = waits;
        waits = 0;
      }

      if (governor.cap && lastFrame) {
        const refresh = refreshCount >= 4 ? median(refreshes, refreshCount) : 1000 / 60;
        const every = Math.max(1, Math.floor((1000 / governor.cap) / refresh + 0.25));
        if (now - lastFrame < (every - 0.5) * refresh) return;
      }
      const delta = lastFrame ? now - lastFrame : 0;
      lastFrame = now;

      const programsBefore = DEV_HANDLE ? gl.info.programs?.length ?? 0 : 0;
      const texturesBefore = DEV_HANDLE ? gl.info.memory.textures : 0;
      if (pendingRatio) {
        if (Math.abs(gl.getPixelRatio() - pendingRatio) > 0.02) gl.setPixelRatio(pendingRatio);
        pendingRatio = 0;
      }
      const started = performance.now();
      advance(now / 1000, true, get());
      const cpu = performance.now() - started;
      const fence = fences?.fenceSync(fences.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (fence) inFlight.push(fence);
      if (DEV_HANDLE) recordFrameCost(cpu, now);
      readout?.frame(cpu, delta);

      const heapBefore = DEV_HANDLE ? sampleHeap() : 0;
      if (DEV_HANDLE && delta && governing.current && !calm.current && !document.hidden) {
        const typical = usualCount >= 8 ? median(usual, usualCount, CALM_WINDOW) : delta;
        if (usualCount >= 8 && delta > Math.max(typical * 1.7, typical + 8, 24)) {
          const runtime = room.current;
          noteHitch(delta, typical, now, stageMode(runtime.getState(), runtime.now()), {
            waited, lastCpu, late, heapBefore,
            programs: programsBefore - programs,
            textures: texturesBefore - textures,
          });
        }
        usual[usualCount++ % CALM_WINDOW] = delta;
      }
      programs = programsBefore;
      textures = texturesBefore;
      lastCpu = cpu;

      if (!calm.current) watchedSince = 0;
      else if (delta && !document.hidden) {
        if (!watchedSince) { watchedSince = now; watched = 0; steady = 0; }
        const typical = watched >= 6 ? median(recent, watched, CALM_WINDOW) : delta;
        const hitch = delta > Math.max(typical * 1.7, typical + 8, 20);
        recent[watched++ % CALM_WINDOW] = delta;
        steady = hitch ? 0 : steady + 1;
      }

      const judging = governing.current && !document.hidden && delta && !(watchedSince && watched <= CALM_SKIP);
      if (judging) {
        const before = governor.scale;
        const shedBefore = governor.shed;
        if (refreshCount >= REFRESH_WINDOW) {
          const refresh = median(refreshes, refreshCount);
          display = display ? Math.min(display, refresh) : refresh;
        }
        const scale = governorTick(governor, delta, performance.now(), cpu, display || undefined);
        if (governor.shed !== shedBefore) {
          steady = 0;
          applyShed(governor.shed);
        }
        LIVE_QUALITY.smaa = PERFORMANCE.smaaAlways || governor.aa;
        LIVE_QUALITY.fxaa = governor.fxaa;
        if (scale !== before) {
          steady = 0;
          pendingRatio = PERFORMANCE.dpr * scale;
        }
      }

      if (watchedSince && calm.current) {
        const settled = steady >= CALM_FRAMES;
        if (settled || now - watchedSince > CALM_LIMIT_MS) {
          watchedSince = 0;
          calm.current();
        }
      }
    };
    raf = requestAnimationFrame(loop);

    const unsubscribe = store.subscribe((state, before) => {
      const size = state.size;
      const was = before.size;
      if (size === was || (size.width === was.width && size.height === was.height)) return;
      const wanted = PERFORMANCE.dpr * governor.scale;
      if (Math.abs(gl.getPixelRatio() - wanted) > 0.02) gl.setPixelRatio(wanted);
      pendingRatio = 0;
      advance(performance.now() / 1000, true, get());
      const fence = fences?.fenceSync(fences.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (fence) inFlight.push(fence);
    });

    const forget = () => { lastFrame = 0; lastRefresh = 0; refreshCount = 0; display = 0; };
    document.addEventListener('visibilitychange', forget);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      document.removeEventListener('visibilitychange', forget);
      readout?.dispose();
      for (const fence of inFlight) fences?.deleteSync(fence);
    };
  }, [running, get, gl, governor, store]);

  return null;
}

const costs: number[] = [];
const drawn: number[] = [];
function recordFrameCost(ms: number, at: number) {
  costs.push(ms);
  drawn.push(at);
  if (costs.length > 20000) costs.splice(0, 10000);
  if (drawn.length > 40000) drawn.splice(0, 20000);
  const handle = (window as unknown as { __loop?: Record<string, unknown> }).__loop;
  if (handle && !handle.frameCosts) handle.frameCosts = costs;
  if (handle && !handle.drawnFrames) handle.drawnFrames = drawn;
}

const MAX_WAITS = 8;

const REFRESH_WINDOW = 15;

const CALM_FRAMES = 20;
const CALM_WINDOW = 16;
const CALM_SKIP = 8;
const CALM_LIMIT_MS = 4000;

const scratch = new Float32Array(Math.max(REFRESH_WINDOW, CALM_WINDOW));

function median(values: Float32Array, count: number, size = REFRESH_WINDOW) {
  const valid = Math.min(count, size);
  scratch.set(values.subarray(0, valid));
  const window = scratch.subarray(0, valid).sort();
  return window[valid >> 1]!;
}
