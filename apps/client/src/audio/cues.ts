export type CueKind =
  | 'insert'
  | 'special'
  | 'armed'
  | 'finish'
  | 'reward'
  | 'tick'
  | 'alarm';

export const CUE_GAIN: Record<CueKind, number> = {
  insert: 0.32, special: 0.36, armed: 0.3, finish: 0.4,
  reward: 0.24, tick: 0.2, alarm: 0.3,
};

type Swept = { duration: number; from: number; to: number; decay: number; noise: number; curve: number; steps?: number[] };

const SPEC: Record<CueKind, Swept> = {
  insert: { duration: 0.2, from: 760, to: 280, decay: 16, noise: 0.16, curve: 1 },
  special: { duration: 0.5, from: 520, to: 1560, decay: 5, noise: 0.05, curve: 0.45 },
  armed: { duration: 0.42, from: 420, to: 150, decay: 7, noise: 0.12, curve: 1.5 },
  finish: { duration: 0.5, from: 520, to: 190, decay: 5, noise: 0.08, curve: 1.6 },
  reward: { duration: 0.2, from: 1320, to: 1980, decay: 14, noise: 0, curve: 1, steps: [1320, 1980] },
  tick: { duration: 0.05, from: 1900, to: 1700, decay: 70, noise: 0.2, curve: 1 },
  alarm: { duration: 0.45, from: 330, to: 250, decay: 3.5, noise: 0.06, curve: 1 },
};

export function makeCue(context: BaseAudioContext, kind: CueKind): AudioBuffer {
  const spec = SPEC[kind];
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * spec.duration), context.sampleRate);
  const data = buffer.getChannelData(0);
  let phase = 0;
  let low = 0;
  for (let i = 0; i < data.length; i += 1) {
    const t = i / context.sampleRate;
    const progress = Math.min(1, t / spec.duration);
    const freq = spec.steps
      ? spec.steps[Math.min(spec.steps.length - 1, Math.floor(progress * spec.steps.length * 1.6))]!
      : spec.from + (spec.to - spec.from) * Math.pow(progress, spec.curve);
    phase += (2 * Math.PI * freq) / context.sampleRate;
    const white = Math.random() * 2 - 1;
    low += 0.12 * (white - low);
    const envelope = Math.min(1, t * 240) * Math.exp(-t * spec.decay);
    data[i] = (Math.sin(phase) * (1 - spec.noise) + (white - low) * spec.noise) * envelope * 0.8;
  }
  return buffer;
}

export const OPENING_DOWNBEAT = 1.9;

export function makeOpening(context: BaseAudioContext): AudioBuffer {
  const rate = context.sampleRate;
  const rise = OPENING_DOWNBEAT;
  const length = Math.ceil(rate * (rise + 2.2));
  const buffer = context.createBuffer(2, length, rate);
  const bell = [1, 1.5, 2, 3];
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    const random = seeded(0x6b7462 + channel * 7919);
    let band = 0;
    let low = 0;
    let tail = 0;
    let tone = 0;
    let boom = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / rate;
      const white = random() * 2 - 1;
      let sample = 0;
      if (t < rise) {
        const p = t / rise;
        const cutoff = 220 * Math.pow(6500 / 220, p * p);
        const f = 2 * Math.sin((Math.PI * Math.min(cutoff, rate / 6)) / rate);
        low += f * band;
        band += f * (white - low - 0.55 * band);
        const swell = Math.pow(p, 2.4) * Math.min(1, (rise - t) / 0.015);
        tone += (2 * Math.PI * 220 * Math.pow(4, p * p)) / rate;
        sample += band * 0.42 * swell + Math.sin(tone + channel * 0.3) * 0.14 * Math.pow(p, 3) * Math.min(1, (rise - t) / 0.015);
      } else {
        const a = t - rise;
        boom += (2 * Math.PI * (42 + 70 * Math.exp(-a * 9))) / rate;
        sample += Math.sin(boom) * Math.min(1, a * 500) * Math.exp(-a * 5) * 0.75;
        sample += white * Math.exp(-a * 90) * 0.22;
        tail += (0.08 + 0.3 * Math.exp(-a * 4)) * (white - tail);
        sample += tail * Math.exp(-a * 2.6) * 0.3;
        for (let note = 0; note < bell.length; note += 1) {
          const age = a - note * 0.018;
          if (age <= 0) continue;
          const freq = 660 * bell[note]!;
          const side = (note % 2 === channel ? 1 : 0.6);
          const envelope = Math.min(1, age * 340) * Math.exp(-age * (1.9 + note * 0.45));
          sample += (Math.sin(age * 2 * Math.PI * freq) + (0.2 / bell[note]!) * Math.sin(age * 4 * Math.PI * freq))
            * envelope * side * 0.2;
        }
      }
      data[i] = sample;
    }
  }
  return finish(buffer);
}

export const PRINT_ROOT = 660;
const PRINT_LADDER = [1, 1.5, 2, 2.5, 3, 4];

export function makePrint(context: BaseAudioContext, level: number): AudioBuffer {
  const rate = context.sampleRate;
  const count = Math.max(2, Math.min(PRINT_LADDER.length, 2 + level));
  const spacing = 0.06;
  const length = Math.ceil(rate * ((count - 1) * spacing + 2.4));
  const buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    const random = seeded(0x707274 + channel * 7919);
    let boom = 0;
    let air = 0;
    let airBand = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / rate;
      const white = random() * 2 - 1;
      let sample = Math.sin(boom) * Math.min(1, t * 500) * Math.exp(-t * 6) * 0.7;
      boom += (2 * Math.PI * (44 + 80 * Math.exp(-t * 10))) / rate;
      sample += white * Math.exp(-t * 80) * 0.2;
      const f = 2 * Math.sin((Math.PI * (4000 + 3000 * Math.exp(-t * 2))) / rate);
      air += f * airBand;
      airBand += f * (white - air - 0.7 * airBand);
      sample += airBand * Math.min(1, t * 30) * Math.exp(-t * 2.4) * 0.12;
      for (let note = 0; note < count; note += 1) {
        const age = t - note * spacing;
        if (age <= 0) continue;
        const partial = PRINT_LADDER[note]!;
        const freq = PRINT_ROOT * partial;
        const decay = note === count - 1 ? 2.2 : 7;
        const side = note % 2 === channel ? 1 : 0.6;
        const shine = 0.25 / partial;
        const envelope = Math.min(1, age * 340) * Math.exp(-age * decay);
        sample += (Math.sin(age * 2 * Math.PI * freq) + shine * Math.sin(age * 4 * Math.PI * freq)) * envelope * side * 0.24;
      }
      data[i] = sample;
    }
  }
  return finish(buffer);
}

function finish(buffer: AudioBuffer): AudioBuffer {
  const length = buffer.length;
  const fade = Math.ceil(buffer.sampleRate * 0.05);
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < fade; i += 1) data[length - 1 - i]! *= i / fade;
    for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(data[i]!));
  }
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) data[i]! *= 0.9 / peak;
  }
  return buffer;
}

export function makeNoise(context: BaseAudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seeded(0x6e6f69);
  for (let i = 0; i < data.length; i += 1) data[i] = random() * 2 - 1;
  return buffer;
}

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
