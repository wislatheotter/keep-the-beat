declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(name: string, processor: unknown): void;

const SR = sampleRate;

const SILENT = 1e-4;
const SMOOTH = Math.exp(-1 / (0.008 * SR));

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

class PitchShifter {
  private buffer: Float32Array;
  private cursor = 0;
  private phase = 0;
  private step: number;
  private window: number;

  constructor(semitones: number, windowSeconds: number) {
    this.window = Math.max(64, Math.round(windowSeconds * SR));
    this.buffer = new Float32Array(this.window * 2 + 4);
    this.step = (Math.pow(2, semitones / 12) - 1) / this.window;
  }

  reset() {
    this.buffer.fill(0);
    this.cursor = 0;
    this.phase = 0;
  }

  private read(offset: number) {
    const size = this.buffer.length;
    const at = this.cursor - 1 - offset;
    const base = Math.floor(at);
    const frac = at - base;
    const i = ((base % size) + size) % size;
    const j = (i + 1) % size;
    return this.buffer[i]! * (1 - frac) + this.buffer[j]! * frac;
  }

  process(input: number) {
    this.buffer[this.cursor] = input;
    this.cursor = (this.cursor + 1) % this.buffer.length;

    let phase = this.phase + this.step;
    phase -= Math.floor(phase);
    this.phase = phase;

    const other = phase >= 0.5 ? phase - 0.5 : phase + 0.5;
    return this.read(this.window * (1 - phase)) * Math.sin(Math.PI * phase)
      + this.read(this.window * (1 - other)) * Math.sin(Math.PI * other);
  }
}

class Line {
  private buffer: Float32Array;
  private index = 0;

  constructor(seconds: number) {
    this.buffer = new Float32Array(Math.max(2, Math.ceil(seconds * SR)));
  }

  reset() { this.buffer.fill(0); this.index = 0; }

  read(delaySamples: number) {
    const size = this.buffer.length;
    const offset = Math.min(size - 1, Math.max(1, Math.round(delaySamples)));
    return this.buffer[(((this.index - offset) % size) + size) % size]!;
  }

  write(value: number) {
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % this.buffer.length;
  }

  process(input: number, delaySamples: number) {
    const out = this.read(delaySamples);
    this.write(input);
    return out;
  }
}

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const SPREAD = 23;
const ROOM_SIZE = 0.8;
const FEEDBACK = 0.667;
const DAMP = 0.5;
const PREDELAY_SECONDS = 0.06;
const SEND_HIGHPASS_HZ = 180;
const FIXED_GAIN = 0.015;
const WET_MAKEUP = 3.4;
const ALLPASS_G = 0.5;
const COMB_FEEDBACK = 0.7 + 0.28 * FEEDBACK;
const DAMP_COEFFICIENT = 0.85 * DAMP;
const ROOM_SCALE = 0.5 + ROOM_SIZE;
const rate = (samples: number) => Math.max(8, Math.round(samples * (SR / 44100)));

class Comb {
  private buffer: Float32Array;
  private index = 0;
  private store = 0;

  constructor(private readonly size: number) {
    this.buffer = new Float32Array(size);
  }

  reset() { this.buffer.fill(0); this.store = 0; this.index = 0; }

  process(input: number) {
    const out = this.buffer[this.index]!;
    this.store = out * (1 - DAMP_COEFFICIENT) + this.store * DAMP_COEFFICIENT;
    this.buffer[this.index] = input + this.store * COMB_FEEDBACK;
    this.index = (this.index + 1) % this.size;
    return out;
  }
}

class Allpass {
  private buffer: Float32Array;
  private index = 0;

  constructor(private readonly size: number) {
    this.buffer = new Float32Array(size);
  }

  reset() { this.buffer.fill(0); this.index = 0; }

  process(input: number) {
    const stored = this.buffer[this.index]!;
    this.buffer[this.index] = input + stored * ALLPASS_G;
    this.index = (this.index + 1) % this.size;
    return stored - input;
  }
}

class Freeverb {
  private combs: Comb[][] = [];
  private allpasses: Allpass[][] = [];
  private predelay = [new Line(0.5), new Line(0.5)];
  private predelaySamples = Math.round(PREDELAY_SECONDS * SR);
  private lowStore = [0, 0];
  private lowCoefficient = Math.exp((-2 * Math.PI * SEND_HIGHPASS_HZ) / SR);

  constructor() {
    for (let channel = 0; channel < 2; channel += 1) {
      const offset = channel * SPREAD;
      this.combs.push(COMB_TUNING.map((size) => new Comb(rate((size + offset) * ROOM_SCALE))));
      this.allpasses.push(ALLPASS_TUNING.map((size) => new Allpass(rate(size + offset))));
    }
  }

  reset() {
    for (const bank of this.combs) for (const comb of bank) comb.reset();
    for (const bank of this.allpasses) for (const allpass of bank) allpass.reset();
    for (const line of this.predelay) line.reset();
    this.lowStore = [0, 0];
  }

  process(input: number, channel: number) {
    const delayed = this.predelay[channel]!.process(input, this.predelaySamples);
    const low = this.lowStore[channel]! * this.lowCoefficient + delayed * (1 - this.lowCoefficient);
    this.lowStore[channel] = low;
    const send = (delayed - low) * FIXED_GAIN;

    let wet = 0;
    for (const comb of this.combs[channel]!) wet += comb.process(send);
    for (const allpass of this.allpasses[channel]!) wet = allpass.process(wet);
    return wet * WET_MAKEUP;
  }
}

const DETUNE_SEMITONES = 0.35;
const DETUNE_DELAY_MS = 14;
const DETUNE_WINDOW = 0.09;
const BASS_MONO_HZ = 300;
const MONO_MAKEUP = Math.SQRT2;

class Wide {
  private left = new PitchShifter(-DETUNE_SEMITONES, DETUNE_WINDOW);
  private right = new PitchShifter(DETUNE_SEMITONES, DETUNE_WINDOW);
  private haas = new Line(0.05);
  private haasSamples = Math.round((DETUNE_DELAY_MS / 1000) * SR);
  private coefficient = Math.exp((-2 * Math.PI * BASS_MONO_HZ) / SR);
  private low = [0, 0];
  private sideLow = [0, 0];

  reset() {
    this.left.reset();
    this.right.reset();
    this.haas.reset();
    this.low = [0, 0];
    this.sideLow = [0, 0];
  }

  private bass(input: number, channel: number) {
    const coefficient = this.coefficient;
    this.low[channel] = this.low[channel]! * coefficient + input * (1 - coefficient);
    return this.low[channel]!;
  }

  process(left: number, right: number, out: [number, number]) {
    const bassLeft = this.bass(left, 0);
    const bassRight = this.bass(right, 1);
    const bass = (bassLeft + bassRight) * 0.5;

    const l = this.left.process(left - bassLeft);
    const r = this.haas.process(this.right.process(right - bassRight), this.haasSamples);
    const mid = (l + r) * 0.5 * MONO_MAKEUP;
    let side = (l - r) * 0.5;

    const coefficient = this.coefficient;
    this.sideLow[0] = this.sideLow[0]! * coefficient + side * (1 - coefficient);
    side -= this.sideLow[0]!;
    this.sideLow[1] = this.sideLow[1]! * coefficient + side * (1 - coefficient);
    side -= this.sideLow[1]!;

    out[0] = bass + mid + side;
    out[1] = bass + mid - side;
  }
}

const PHASER_MIN_HZ = 240;
const PHASER_MAX_HZ = 3000;
const PHASER_RATE_HZ = 0.6;
const PHASER_FEEDBACK = 0.7;
const PHASER_STAGES = 6;
const PHASER_SPREAD = 0.25;

class Phaser {
  private phase = 0;
  private x = [new Float32Array(PHASER_STAGES), new Float32Array(PHASER_STAGES)];
  private y = [new Float32Array(PHASER_STAGES), new Float32Array(PHASER_STAGES)];
  private feedback = [0, 0];
  private a = [0, 0];
  private below = [0, 0];
  private within = [0, 0];
  private belowCoefficient = Math.exp((-2 * Math.PI * PHASER_MIN_HZ) / SR);
  private withinCoefficient = Math.exp((-2 * Math.PI * PHASER_MAX_HZ) / SR);

  reset() {
    for (const bank of this.x) bank.fill(0);
    for (const bank of this.y) bank.fill(0);
    this.feedback = [0, 0];
    this.below = [0, 0];
    this.within = [0, 0];
    this.phase = 0;
  }

  split(input: number, channel: number, out: [number, number]) {
    this.below[channel] = this.below[channel]! * this.belowCoefficient
      + input * (1 - this.belowCoefficient);
    const above = input - this.below[channel]!;
    this.within[channel] = this.within[channel]! * this.withinCoefficient
      + above * (1 - this.withinCoefficient);
    out[0] = this.within[channel]!;
    out[1] = this.below[channel]! + (above - this.within[channel]!);
  }

  step(frames: number) {
    this.phase = (this.phase + (PHASER_RATE_HZ * frames) / SR) % 1;
    for (let channel = 0; channel < 2; channel += 1) {
      const angle = (this.phase + channel * PHASER_SPREAD) * Math.PI * 2;
      const sweep = (Math.sin(angle) + 1) * 0.5;
      const hz = PHASER_MIN_HZ * Math.pow(PHASER_MAX_HZ / PHASER_MIN_HZ, sweep);
      const t = Math.tan((Math.PI * hz) / SR);
      this.a[channel] = (1 - t) / (1 + t);
    }
  }

  process(input: number, channel: number) {
    const a = this.a[channel]!;
    const x = this.x[channel]!;
    const y = this.y[channel]!;
    let signal = input + this.feedback[channel]! * PHASER_FEEDBACK;
    for (let stage = 0; stage < PHASER_STAGES; stage += 1) {
      const out = a * (signal + y[stage]!) - x[stage]!;
      x[stage] = signal;
      y[stage] = out;
      signal = out;
    }
    this.feedback[channel] = signal;
    return signal;
  }
}

const WARP_SEMITONES = 7;
const WARP_FEEDBACK = 0.666;
const WARP_WINDOW = 0.055;
const WARP_DAMP_HZ = 4500;
const WARP_MAX_SECONDS = 2;

class PitchDelay {
  private line = [new Line(WARP_MAX_SECONDS), new Line(WARP_MAX_SECONDS)];
  private shifter = [
    new PitchShifter(WARP_SEMITONES, WARP_WINDOW),
    new PitchShifter(WARP_SEMITONES, WARP_WINDOW),
  ];
  private damp = [0, 0];
  private coefficient = Math.exp((-2 * Math.PI * WARP_DAMP_HZ) / SR);

  reset() {
    for (const line of this.line) line.reset();
    for (const shifter of this.shifter) shifter.reset();
    this.damp = [0, 0];
  }

  process(input: number, channel: number, delaySamples: number) {
    const line = this.line[channel]!;
    const shifted = this.shifter[channel]!.process(line.read(delaySamples));
    const damped = this.damp[channel]! * this.coefficient + shifted * (1 - this.coefficient);
    this.damp[channel] = damped;
    line.write(input + damped * WARP_FEEDBACK);
    return shifted;
  }
}

type Machine = 'space' | 'wide' | 'swirl' | 'warp';
type Blend = { dry: number; wet: number };

const ORDER = ['swirl', 'warp', 'space', 'wide'] as const;

const SPACE_MIX = 0.3;
const WARP_MIX = 0.38;

const power = (mix: number): Blend => ({
  dry: Math.cos((mix * Math.PI) / 2),
  wet: Math.sin((mix * Math.PI) / 2),
});
const linear = (mix: number): Blend => ({ dry: 1 - mix, wet: mix });

function slide(gain: Blend, want: Blend) {
  gain.dry = want.dry + (gain.dry - want.dry) * SMOOTH;
  gain.wet = want.wet + (gain.wet - want.wet) * SMOOTH;
  return gain;
}

class MachineRackProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const amount = (name: string) => ({
      name, defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' as const,
    });
    return [
      amount('space'), amount('wide'), amount('swirl'), amount('warp'),
      {
        name: 'warpDelay',
        defaultValue: 0.375,
        minValue: 0.01,
        maxValue: WARP_MAX_SECONDS,
        automationRate: 'k-rate' as const,
      },
    ];
  }

  private space = new Freeverb();
  private wide = new Wide();
  private swirl = new Phaser();
  private warp = new PitchDelay();

  private gain: Record<Machine, Blend> = {
    space: { dry: 1, wet: 0 },
    warp: { dry: 1, wet: 0 },
    swirl: { dry: 1, wet: 0 },
    wide: { dry: 1, wet: 0 },
  };
  private live: Record<Machine, boolean> = { space: false, wide: false, swirl: false, warp: false };
  private pair: [number, number] = [0, 0];
  private band: [number, number] = [0, 0];

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const input = inputs[0];
    const output = outputs[0]!;
    const left = output[0]!;
    const right = output[1] ?? output[0]!;
    const frames = left.length;

    const want: Record<Machine, Blend> = {
      space: power(clamp01(parameters.space![0]!) * SPACE_MIX),
      warp: power(clamp01(parameters.warp![0]!) * WARP_MIX),
      swirl: linear(clamp01(parameters.swirl![0]!) * 0.5),
      wide: linear(clamp01(parameters.wide![0]!)),
    };
    for (const key of ORDER) if (want[key].wet > SILENT) this.live[key] = true;

    const silent = !input || input.length === 0 || (input[0]?.length ?? 0) === 0;
    if (silent && !ORDER.some((key) => this.live[key])) {
      left.fill(0);
      if (right !== left) right.fill(0);
      return true;
    }
    const inLeft = silent ? null : input![0]!;
    const inRight = silent ? null : (input![1] ?? input![0]!);

    if (this.live.swirl) this.swirl.step(frames);
    const warpSamples = Math.round(
      Math.min(WARP_MAX_SECONDS, Math.max(0.01, parameters.warpDelay![0]!)) * SR,
    );

    for (let i = 0; i < frames; i += 1) {
      let l = inLeft ? inLeft[i]! : 0;
      let r = inRight ? inRight[i]! : 0;

      if (this.live.swirl) {
        const gain = slide(this.gain.swirl, want.swirl);
        this.swirl.split(l, 0, this.band);
        l = this.band[1] + this.band[0] * gain.dry + this.swirl.process(this.band[0], 0) * gain.wet;
        this.swirl.split(r, 1, this.band);
        r = this.band[1] + this.band[0] * gain.dry + this.swirl.process(this.band[0], 1) * gain.wet;
      }
      if (this.live.warp) {
        const gain = slide(this.gain.warp, want.warp);
        l = l * gain.dry + this.warp.process(l, 0, warpSamples) * gain.wet;
        r = r * gain.dry + this.warp.process(r, 1, warpSamples) * gain.wet;
      }
      if (this.live.space) {
        const gain = slide(this.gain.space, want.space);
        l = l * gain.dry + this.space.process(l, 0) * gain.wet;
        r = r * gain.dry + this.space.process(r, 1) * gain.wet;
      }
      if (this.live.wide) {
        const gain = slide(this.gain.wide, want.wide);
        this.wide.process(l, r, this.pair);
        l = l * gain.dry + this.pair[0] * gain.wet;
        r = r * gain.dry + this.pair[1] * gain.wet;
      }

      left[i] = l;
      if (right !== left) right[i] = r;
    }

    this.settle('swirl', want.swirl.wet, this.swirl);
    this.settle('warp', want.warp.wet, this.warp);
    this.settle('space', want.space.wet, this.space);
    this.settle('wide', want.wide.wet, this.wide);
    return true;
  }

  private settle(key: Machine, wanted: number, unit: { reset: () => void }) {
    if (!this.live[key] || wanted > SILENT || this.gain[key].wet > SILENT) return;
    this.live[key] = false;
    this.gain[key].dry = 1;
    this.gain[key].wet = 0;
    unit.reset();
  }
}

registerProcessor('machine-rack', MachineRackProcessor);

export {};
