const WINDOW = 64;

const MIN_SAMPLES = 20;

const MAX_PLAUSIBLE_FRAME_MS = 1000;

const BAD_MS = 20.5;
const GOOD_MS = 17.2;
const PACED_BAD_MS = 18;
const MILD_MS = BAD_MS;

const MIN_SCALE = 0.55;
const MAX_SCALE = 1;
const FXAA_OFF_AT = 0.7;
const STEP_DOWN = 0.1;
const STEP_UP = 0.05;

const COOLDOWN_MS = 1200;
const UPSHIFT_PATIENCE_MS = 4000;
const MAX_FAILED_UPSHIFTS = 2;
const FAILURE_MEMORY_MS = 30000;
const SHED_MEMORY_MS = 60000;
const SLOW_PATIENCE_MS = 2000;

export type FrameCap = 0 | 30 | 60;

const CPU_BOUND_FRACTION = 0.7;
const CPU_SUSPECT_FRACTION = 0.5;
const AA_FPS = 70;
const AA_HOLD = 1.03;
const AA_CPU_FRACTION = 0.6;

function aaTarget(refreshMs: number) {
  return Math.max(refreshMs, 1000 / AA_FPS);
}

const AA_KEY = -1000;
const STEP_MUST_HELP = 0.05;
const STEP_MUST_NOT_HURT = 0.08;
const RESOLUTION_IDLE_MS = 20000;
const MILD_IDLE_MS = 60000;
const FXAA_KEY = -2000;
const RECENT = 16;

export type GovernorState = {
  scale: number;
  frames: Float32Array;
  cpu: Float32Array;
  count: number;
  cpuCount: number;
  filled: boolean;
  changedAt: number;
  goodSince: number;
  failedUpshifts: Map<number, number>;
  failedAt: Map<number, number>;
  slowSince: number;
  lastDecision: string;
  lastMedian: number;
  lastCpu: number;
  pacing: boolean;
  cap: FrameCap;
  step: {
    dial: 'scale' | 'shed' | 'aa' | 'fxaa'; from: number; to: number; before: number; forCpu: boolean;
    origin?: number;
    cpuBefore?: number;
  } | null;
  shed: number;
  maxShed: number;
  shedIdleUntil: number;
  aaAllowed: boolean;
  aa: boolean;
  fxaa: boolean;
  resolutionIdleUntil: number;
  mildFailures: number;
};

export function createGovernor(options: { pacing?: boolean; cap?: FrameCap; maxShed?: number; aa?: boolean } = {}): GovernorState {
  return {
    scale: MAX_SCALE,
    frames: new Float32Array(WINDOW),
    cpu: new Float32Array(WINDOW),
    count: 0,
    cpuCount: 0,
    filled: false,
    changedAt: 0,
    goodSince: 0,
    failedUpshifts: new Map(),
    failedAt: new Map(),
    slowSince: 0,
    lastDecision: 'holding',
    lastMedian: 0,
    lastCpu: 0,
    pacing: options.pacing ?? false,
    cap: options.cap ?? 0,
    step: null,
    resolutionIdleUntil: 0,
    shed: 0,
    maxShed: options.pacing ? options.maxShed ?? 0 : 0,
    shedIdleUntil: 0,
    aaAllowed: !!options.pacing && !!options.aa,
    aa: false,
    fxaa: true,
    mildFailures: 0,
  };
}

const FRAME_60 = 1000 / 60;

export function targetMs(state: GovernorState) {
  return state.cap === 30 ? 1000 / 30 : FRAME_60;
}

const sorted = new Float32Array(WINDOW);

function median(values: Float32Array, count: number) {
  const valid = Math.min(count, WINDOW);
  sorted.set(values);
  sorted.subarray(0, valid).sort();
  return sorted[valid >> 1]!;
}

function noteFailed(state: GovernorState, scale: number, now: number, count = (state.failedUpshifts.get(scale) ?? 0) + 1) {
  state.failedUpshifts.set(scale, count);
  state.failedAt.set(scale, now);
}

function barred(state: GovernorState, scale: number, now: number, memory = FAILURE_MEMORY_MS) {
  const count = state.failedUpshifts.get(scale) ?? 0;
  if (count < MAX_FAILED_UPSHIFTS) return false;
  return now < (state.failedAt.get(scale) ?? 0) + memory * 2 ** (count - MAX_FAILED_UPSHIFTS);
}

function pacedMean(values: Float32Array, count: number, target: number) {
  const valid = Math.min(count, WINDOW);
  let sum = 0;
  for (let i = 0; i < valid; i += 1) sum += Math.min(values[i]!, target * 3);
  return sum / valid;
}

function restart(state: GovernorState, now: number) {
  state.changedAt = now;
  state.goodSince = 0;
  state.count = 0;
  state.cpuCount = 0;
  state.filled = false;
  state.frames.fill(0);
  state.cpu.fill(0);
}

function setScale(state: GovernorState, scale: number, now: number, why: string) {
  state.scale = scale;
  restart(state, now);
  state.lastDecision = why;
}

function setShed(state: GovernorState, shed: number, now: number, why: string) {
  state.shed = shed;
  restart(state, now);
  state.lastDecision = why;
}

function setAa(state: GovernorState, on: boolean, now: number, why: string) {
  state.aa = on;
  restart(state, now);
  state.lastDecision = why;
}

function setFxaa(state: GovernorState, on: boolean, now: number, why: string) {
  state.fxaa = on;
  restart(state, now);
  state.lastDecision = why;
}

function recentMean(state: GovernorState, target: number) {
  const valid = Math.min(state.count, RECENT);
  let sum = 0;
  for (let i = 1; i <= valid; i += 1) sum += Math.min(state.frames[(state.count - i) % WINDOW]!, target * 3);
  return sum / valid;
}

function mildIdle(state: GovernorState) {
  state.mildFailures += 1;
  return MILD_IDLE_MS * 2 ** Math.min(state.mildFailures - 1, 4);
}

const shedKey = (level: number) => -level;

export function governorTick(state: GovernorState, deltaMs: number, now: number, cpuMs?: number, refreshMs?: number): number {
  if (deltaMs > MAX_PLAUSIBLE_FRAME_MS || deltaMs <= 0) return state.scale;

  state.frames[state.count % WINDOW] = deltaMs;
  state.count += 1;
  if (cpuMs !== undefined) {
    state.cpu[state.cpuCount % WINDOW] = cpuMs;
    state.cpuCount += 1;
  }
  if (state.count >= WINDOW) state.filled = true;
  if (state.count < MIN_SAMPLES) return state.scale;

  if (now - state.changedAt < COOLDOWN_MS) return state.scale;

  const cpu = state.cpuCount >= MIN_SAMPLES ? median(state.cpu, state.cpuCount) : undefined;
  state.lastCpu = cpu ?? 0;

  if (!state.pacing) {
    const current = median(state.frames, state.count);
    state.lastMedian = current;
    return legacyTick(state, current, now);
  }

  const target = targetMs(state);
  const current = pacedMean(state.frames, state.count, target);
  state.lastMedian = current;
  const bad = target * (PACED_BAD_MS / FRAME_60);
  const good = target * (GOOD_MS / FRAME_60);
  const mild = target * (MILD_MS / FRAME_60);
  const cpuBound = cpu !== undefined && cpu > target * CPU_BOUND_FRACTION;
  const cpuText = () => (cpu === undefined ? '' : `, cpu ${cpu.toFixed(1)} ms`);

  const step = state.step;
  let chain: { from: number; before: number } | null = null;
  if (step) {
    state.step = null;
    if (step.dial === 'fxaa') {
      if (step.to === 1 && (current > bad || current > step.before * (1 + STEP_MUST_NOT_HURT))) {
        noteFailed(state, FXAA_KEY, now, Math.max(MAX_FAILED_UPSHIFTS, (state.failedUpshifts.get(FXAA_KEY) ?? 0) + 1));
        setFxaa(state, false, now, `FXAA off again: it cost too much (mean ${current.toFixed(1)} ms)`);
        return state.scale;
      }
    } else if (step.dial === 'aa') {
      if (step.to === 1 && current > good) {
        noteFailed(state, AA_KEY, now, Math.max(MAX_FAILED_UPSHIFTS, (state.failedUpshifts.get(AA_KEY) ?? 0) + 1));
        setAa(state, false, now, `back to FXAA: SMAA took the frames under 60 (mean ${current.toFixed(1)} ms)`);
        return state.scale;
      }
    } else if (step.dial === 'shed') {
      const shedding = step.to > step.from;
      const eased = step.forCpu && cpu !== undefined && step.cpuBefore !== undefined
        && cpu < step.cpuBefore * (1 - STEP_MUST_HELP);
      if (shedding && !eased && current > bad && current > step.before * (1 - STEP_MUST_HELP)) {
        if (step.to < state.maxShed) {
          setShed(state, step.to + 1, now, `shed pass ${step.to + 1}: pass ${step.to} alone did not help (mean ${current.toFixed(1)} ms)`);
          state.step = { dial: 'shed', from: step.from, to: step.to + 1, before: step.before, forCpu: step.forCpu, cpuBefore: step.cpuBefore };
          return state.scale;
        }
        state.shedIdleUntil = now + (step.before < mild ? mildIdle(state) : RESOLUTION_IDLE_MS);
        setShed(state, step.from, now, `restored passes: shedding them did not help (mean ${current.toFixed(1)} ms)`);
        return state.scale;
      }
      if (!shedding && current > step.before * (1 + STEP_MUST_NOT_HURT)) {
        noteFailed(state, shedKey(step.to), now, Math.max(MAX_FAILED_UPSHIFTS, (state.failedUpshifts.get(shedKey(step.to)) ?? 0) + 1));
        setShed(state, step.from, now, `shed pass ${step.from} again: it cost too much (mean ${current.toFixed(1)} ms)`);
        return state.scale;
      }
    } else {
      const down = step.to < step.from;
      const suspect = cpu !== undefined && cpu > target * CPU_SUSPECT_FRACTION;
      if (down && suspect && current > bad && current > step.before * (1 - STEP_MUST_HELP)) {
        state.resolutionIdleUntil = now + RESOLUTION_IDLE_MS;
        setScale(state, step.from, now, `back to ${step.from.toFixed(2)}: ${step.to.toFixed(2)} did not help (mean ${current.toFixed(1)} ms)`);
        return state.scale;
      }
      if (down && step.before < mild && current > bad && current > step.before * (1 - STEP_MUST_HELP)) {
        if (step.origin === undefined) {
          chain = { from: step.from, before: step.before };
        } else {
          state.resolutionIdleUntil = now + mildIdle(state);
          setScale(state, step.origin, now, `back to ${step.origin.toFixed(2)}: ${step.to.toFixed(2)} did not help a mild stumble (mean ${current.toFixed(1)} ms)`);
          return state.scale;
        }
      }
      if (!down && current > step.before * (1 + STEP_MUST_NOT_HURT)) {
        noteFailed(state, step.to, now, Math.max(MAX_FAILED_UPSHIFTS, (state.failedUpshifts.get(step.to) ?? 0) + 1));
        setScale(state, step.from, now, `back to ${step.from.toFixed(2)}: ${step.to.toFixed(2)} cost the GPU (mean ${current.toFixed(1)} ms)`);
        return state.scale;
      }
    }
  }

  if (state.aa && current > good) {
    state.goodSince = 0;
    setAa(state, false, now, `back to FXAA (mean ${current.toFixed(1)} ms${cpuText()})`);
    return state.scale;
  }

  if (current > bad) {
    state.goodSince = 0;
    if (!state.slowSince) state.slowSince = now;
    const patient = (now - state.slowSince >= SLOW_PATIENCE_MS || current > bad * 2) && recentMean(state, target) > good;
    const resolutionIdle = now < state.resolutionIdleUntil;
    const floor = state.fxaa ? FXAA_OFF_AT : MIN_SCALE;
    if (!cpuBound && !resolutionIdle && state.scale > floor) {
      if (!patient) return state.scale;
      const from = state.scale;
      const to = Math.max(floor, Math.round((from - STEP_DOWN) * 100) / 100);
      noteFailed(state, from, now);
      setScale(state, to, now, `down to ${to.toFixed(2)} (mean ${current.toFixed(1)} ms${cpuText()})`);
      state.step = { dial: 'scale', from, to, before: chain?.before ?? current, forCpu: false, origin: chain?.from };
      return state.scale;
    }
    if (!cpuBound && !resolutionIdle && state.fxaa) {
      if (!patient) return state.scale;
      noteFailed(state, FXAA_KEY, now);
      setFxaa(state, false, now, `FXAA off at ${state.scale.toFixed(2)} (mean ${current.toFixed(1)} ms${cpuText()})`);
      state.step = { dial: 'fxaa', from: 1, to: 0, before: current, forCpu: false };
      return state.scale;
    }
    if ((cpuBound || resolutionIdle) && !state.fxaa) {
      setFxaa(state, true, now, `FXAA on: not the pixels (mean ${current.toFixed(1)} ms${cpuText()})`);
      return state.scale;
    }
    if ((cpuBound || resolutionIdle) && state.scale < MAX_SCALE) {
      const from = state.scale;
      const to = Math.min(MAX_SCALE, Math.round((from + STEP_DOWN) * 100) / 100);
      if (!barred(state, to, now)) {
        setScale(state, to, now, `up to ${to.toFixed(2)}: not the pixels (mean ${current.toFixed(1)} ms${cpuText()})`);
        state.step = { dial: 'scale', from, to, before: current, forCpu: true };
        return state.scale;
      }
    }
    if (state.shed < state.maxShed && now >= state.shedIdleUntil) {
      if (!patient) return state.scale;
      const from = state.shed;
      setShed(state, from + 1, now, `shed pass ${from + 1} (mean ${current.toFixed(1)} ms${cpuText()})`);
      state.step = { dial: 'shed', from, to: from + 1, before: current, forCpu: cpuBound, cpuBefore: cpu };
      return state.scale;
    }
    if (!state.lastDecision.startsWith('holding')) {
      state.lastDecision = `holding ${state.scale.toFixed(2)}: ${cpuBound ? 'short of main thread' : 'at the floor'} (mean ${current.toFixed(1)} ms${cpuText()})`;
    }
    return state.scale;
  }
  state.slowSince = 0;

  if (current < good) {
    if (state.shed > 0) {
      if (!state.goodSince) state.goodSince = now;
      if (now - state.goodSince < UPSHIFT_PATIENCE_MS) return state.scale;
      const from = state.shed;
      if (barred(state, shedKey(from - 1), now, SHED_MEMORY_MS)) {
        if (!state.lastDecision.startsWith('holding')) state.lastDecision = `holding pass ${from} shed (it did not hold)`;
      } else {
        setShed(state, from - 1, now, `restored pass ${from} (mean ${current.toFixed(1)} ms)`);
        state.step = { dial: 'shed', from, to: from - 1, before: current, forCpu: false };
        return state.scale;
      }
    }
    if (!state.fxaa && state.scale >= FXAA_OFF_AT - 0.001) {
      if (!state.goodSince) state.goodSince = now;
      if (now - state.goodSince < UPSHIFT_PATIENCE_MS) return state.scale;
      if (barred(state, FXAA_KEY, now, SHED_MEMORY_MS)) {
        if (!state.lastDecision.startsWith('holding')) state.lastDecision = `holding ${state.scale.toFixed(2)} without FXAA (it did not hold)`;
        return state.scale;
      }
      setFxaa(state, true, now, `FXAA on (mean ${current.toFixed(1)} ms)`);
      state.step = { dial: 'fxaa', from: 0, to: 1, before: current, forCpu: false };
      return state.scale;
    }
    if (state.scale < MAX_SCALE) {
      if (!state.goodSince) state.goodSince = now;
      if (now - state.goodSince < UPSHIFT_PATIENCE_MS) return state.scale;
      const next = Math.min(state.fxaa ? MAX_SCALE : FXAA_OFF_AT, Math.round((state.scale + STEP_UP) * 100) / 100);
      if (barred(state, next, now)) {
        state.lastDecision = `holding ${state.scale.toFixed(2)} (${next.toFixed(2)} did not hold)`;
        return state.scale;
      }
      const from = state.scale;
      setScale(state, next, now, `up to ${next.toFixed(2)} (mean ${current.toFixed(1)} ms)`);
      state.step = { dial: 'scale', from, to: next, before: current, forCpu: false };
      return state.scale;
    }
    if (state.aaAllowed && !state.aa && refreshMs !== undefined && refreshMs > 0) {
      const room = current <= aaTarget(refreshMs) * AA_HOLD && (cpu === undefined || cpu < FRAME_60 * AA_CPU_FRACTION);
      if (!room) {
        state.goodSince = 0;
        return state.scale;
      }
      if (!state.goodSince) state.goodSince = now;
      if (now - state.goodSince < UPSHIFT_PATIENCE_MS) return state.scale;
      if (barred(state, AA_KEY, now, SHED_MEMORY_MS)) {
        if (!state.lastDecision.startsWith('holding')) state.lastDecision = 'holding FXAA (SMAA did not hold 60)';
        return state.scale;
      }
      setAa(state, true, now, `SMAA on (mean ${current.toFixed(1)} ms)`);
      state.step = { dial: 'aa', from: 0, to: 1, before: current, forCpu: false };
    }
    return state.scale;
  }

  state.goodSince = 0;
  return state.scale;
}

function legacyTick(state: GovernorState, current: number, now: number): number {
  if (current > BAD_MS && state.scale > MIN_SCALE) {
    const from = state.scale;
    const to = Math.max(MIN_SCALE, Math.round((state.scale - STEP_DOWN) * 100) / 100);
    state.failedUpshifts.set(from, (state.failedUpshifts.get(from) ?? 0) + 1);
    setScale(state, to, now, `down to ${to.toFixed(2)} (median ${current.toFixed(1)} ms)`);
    return state.scale;
  }

  if (current < GOOD_MS && state.scale < MAX_SCALE) {
    if (!state.goodSince) state.goodSince = now;
    if (now - state.goodSince < UPSHIFT_PATIENCE_MS) return state.scale;
    const next = Math.min(MAX_SCALE, Math.round((state.scale + STEP_UP) * 100) / 100);
    if ((state.failedUpshifts.get(next) ?? 0) >= MAX_FAILED_UPSHIFTS) {
      state.lastDecision = `holding ${state.scale.toFixed(2)} (${next.toFixed(2)} did not hold)`;
      return state.scale;
    }
    setScale(state, next, now, `up to ${next.toFixed(2)} (median ${current.toFixed(1)} ms)`);
    return state.scale;
  }

  if (current >= GOOD_MS) state.goodSince = 0;
  return state.scale;
}

export const GOVERNOR_LIMITS = { MIN_SCALE, MAX_SCALE, BAD_MS, GOOD_MS, PACED_BAD_MS, FXAA_OFF_AT, WINDOW, MIN_SAMPLES };
