import { PRINT_ROOT } from './cues';

export type Foley =
  | 'take'
  | 'pickup'
  | 'floor'
  | 'throw'
  | 'seat'
  | 'land'
  | 'feed'
  | 'popout';

export const FOLEY: Foley[] = ['take', 'pickup', 'floor', 'throw', 'seat', 'land', 'feed', 'popout'];

export const LAND_DOWNBEAT = 0.45;

export const FOLEY_GAIN: Record<Foley, number> = {
  take: 0.075, pickup: 0.063, floor: 0.07, throw: 0.063, seat: 0.07, land: 0.35, feed: 0.063, popout: 0.075,
};

type Voice = (t: number, white: number) => number;
type Spec = { seconds: number; voice: (channel: number, rate: number) => Voice };

const E3 = PRINT_ROOT / 4;

function breath(base: number, glide: number, length: number, from: number, to: number): Spec['voice'] {
  return (channel, rate) => {
    const air = svf(rate);
    const root = triangle(rate);
    const fifth = triangle(rate);
    const soft = svf(rate);
    return (t, white) => {
      const p = Math.min(1, t / length);
      const pitch = base * glide ** smooth(p);
      const tone = soft.low(root(pitch * (channel ? 1.003 : 0.997)) + 0.8 * fifth(pitch * 1.5), 1400, 1.2);
      return (tone * 0.35 + air.band(white, from * (to / from) ** p, 1.1) * 0.9) * hump(t, length) ** 1.5;
    };
  };
}

const SPECS: Record<Foley, Spec> = {
  take: { seconds: 0.32, voice: breath(E3 * 2, 1.5, 0.3, 700, 2600) },
  pickup: { seconds: 0.27, voice: breath(E3, 2, 0.25, 600, 2000) },
  floor: {
    seconds: 0.34,
    voice: (channel, rate) => {
      const fall = breath(E3, 2 / 3, 0.3, 1200, 300)(channel, rate);
      const rest = sine(rate);
      return (t, white) => fall(t, white) + rest(62) * hit(t - 0.1, 0.03, 14) * 0.25;
    },
  },
  throw: {
    seconds: 0.6,
    voice: (channel, rate) => {
      const air = svf(rate);
      const root = triangle(rate);
      const fifth = triangle(rate);
      const soft = svf(rate);
      return (t, white) => {
        const swell = t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) * 6);
        const pitch = E3 * 2 ** smooth(t / 0.3);
        const tone = soft.low(root(pitch * (channel ? 1.003 : 0.997)) + 0.8 * fifth(pitch * 1.5), 900 + 2400 * swell, 1.2);
        return (tone * 0.4 + air.band(white, 1400 + 2600 * smooth(t / 0.25), 1) * 0.9) * swell;
      };
    },
  },
  seat: { seconds: 0.34, voice: breath(E3 * 2, 2 / 3, 0.32, 2600, 700) },
  land: {
    seconds: LAND_DOWNBEAT + 1.1,
    voice: (channel, rate) => {
      const rise = svf(rate);
      const climb = saws(rate, [1, 2], channel ? 5 : -5);
      const climbTone = svf(rate);
      const sub = sine(rate);
      const splash = onePole(rate);
      const stab = saws(rate, [1, 1.5, 2, 4], channel ? 6 : -6);
      const stabTone = svf(rate);
      return (t, white) => {
        if (t < LAND_DOWNBEAT) {
          const p = t / LAND_DOWNBEAT;
          const cut = Math.min(1, (LAND_DOWNBEAT - t) / 0.01);
          let sample = rise.band(white, 500 * 14 ** (p * p), 0.7) * p ** 2.5 * 0.55 * cut;
          sample += climbTone.low(climb(E3 / 2 * 2 ** p), 200 + 2300 * p * p, 0.6) * p ** 3 * 0.3 * cut;
          return sample;
        }
        const a = t - LAND_DOWNBEAT;
        let sample = sub(40 + 65 * Math.exp(-a * 12)) * hit(a, 0.002, 5.5) * 1;
        sample += splash(white, 1500 + 7500 * Math.exp(-a * 6)) * hit(a, 0.001, 5) * 0.45;
        sample += stabTone.low(stab(E3), 300 + 4700 * Math.exp(-a * 10), 0.5) * hit(a, 0.003, 3.5) * 0.5;
        return sample;
      };
    },
  },
  feed: { seconds: 0.32, voice: breath(E3 * 1.5, 0.5, 0.3, 2400, 600) },
  popout: { seconds: 0.37, voice: breath(E3 * 2, 2, 0.35, 700, 3200) },
};

export function makeFoley(context: BaseAudioContext, kind: Foley): AudioBuffer {
  const rate = context.sampleRate;
  const spec = SPECS[kind];
  const length = Math.ceil(rate * spec.seconds);
  const buffer = context.createBuffer(2, length, rate);
  let peak = 0;
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    const random = seeded(0x666f6c + channel * 7919 + FOLEY.indexOf(kind) * 131);
    const voice = spec.voice(channel, rate);
    for (let i = 0; i < length; i += 1) {
      data[i] = voice(i / rate, random() * 2 - 1);
      peak = Math.max(peak, Math.abs(data[i]!));
    }
  }
  const fade = Math.ceil(rate * 0.02);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) data[i]! *= (0.9 / peak) * Math.min(1, (length - 1 - i) / fade);
  }
  return buffer;
}

function hit(t: number, attack: number, decay: number) {
  if (t <= 0) return 0;
  return Math.min(1, t / attack) * Math.exp(-t * decay);
}

function hump(t: number, length: number) {
  return t <= 0 || t >= length ? 0 : Math.sin((Math.PI * t) / length);
}

function smooth(x: number) {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

function triangle(rate: number) {
  let phase = 0;
  return (freq: number) => {
    phase = (phase + freq / rate) % 1;
    return 1 - 4 * Math.abs(phase - 0.5);
  };
}

function sine(rate: number) {
  let phase = 0;
  return (freq: number) => {
    phase += (2 * Math.PI * freq) / rate;
    return Math.sin(phase);
  };
}

function saws(rate: number, multiples: number[], cents: number) {
  const phases = multiples.map((_, index) => index * 0.31);
  const detune = 2 ** (cents / 1200);
  return (freq: number) => {
    let sample = 0;
    multiples.forEach((multiple, index) => {
      phases[index] = (phases[index]! + (freq * multiple * detune) / rate) % 1;
      sample += (2 * phases[index]! - 1) / (index + 1);
    });
    return sample / multiples.length;
  };
}

function onePole(rate: number) {
  let state = 0;
  return (input: number, cutoff: number) => {
    state += (1 - Math.exp((-2 * Math.PI * cutoff) / rate)) * (input - state);
    return state;
  };
}

function svf(rate: number) {
  let low = 0;
  let band = 0;
  const step = (input: number, cutoff: number, damping: number) => {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoff, rate / 6)) / rate);
    low += f * band;
    band += f * (input - low - damping * band);
  };
  return {
    band: (input: number, cutoff: number, damping: number) => { step(input, cutoff, damping); return band; },
    low: (input: number, cutoff: number, damping: number) => { step(input, cutoff, damping); return low; },
  };
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
